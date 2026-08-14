import { Hono } from "hono";
import type { AppBindings } from "./lib/auth";
import { bodyParser } from "./lib/auth";
import { AppError } from "./lib/errors";
import type { Env, QueueMessage } from "./lib/env";
import { processJob, isRetryableError } from "./lib/pipeline";
import { markJobFailed } from "./routes/stamp";

import templates from "./routes/templates";
import stamp from "./routes/stamp";
import jobs from "./routes/jobs";
import tenants from "./routes/tenants";
import authtoken from "./routes/authtoken";
import consoleRoutes from "./routes/console";
import download from "./routes/download";

export { StagingQuotaDO } from "./do/quota";
export { JwtCacheDO } from "./do/jwtcache";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory per isolate; separate from the staging quota).
// ---------------------------------------------------------------------------

const limiter = new Map<string, { start: number; count: number }>();

function checkRate(ip: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  if (limiter.size > 10_000) {
    for (const [k, v] of limiter) if (now - v.start > 120_000) limiter.delete(k);
  }
  const entry = limiter.get(ip);
  if (!entry || now - entry.start > windowMs) {
    limiter.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  const path = c.req.path;
  const sensitive = path === "/console/login" || path === "/auth/token";
  if (!checkRate(ip, 60_000, sensitive ? 15 : 300)) {
    throw AppError.tooMany("Rate limit exceeded. Slow down and retry.", undefined);
  }
  await next();
});

app.use("*", async (c, next) => {
  const allowed = ["http://localhost:5173", "http://127.0.0.1:5173"];
  const origin = c.req.header("Origin");
  if (origin && allowed.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Timestamp, X-Signature");
    c.header("Access-Control-Expose-Headers", "X-Staging-Quota-Remaining");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.use("*", bodyParser);

// Browser page navigations (refresh / typed URL) send `Accept: text/html`;
// fetch()-based API calls never do. Client routes like /templates, /jobs and
// /templates/:id also match API GET routes, so without this the console shows
// raw JSON instead of the app. Serve the SPA shell for HTML navigations and
// let React Router render the matching page.
app.use("*", async (c, next) => {
  const accept = c.req.header("Accept") ?? "";
  if ((c.req.method === "GET" || c.req.method === "HEAD") && accept.includes("text/html") && !c.req.path.startsWith("/download")) {
    if (c.env.ASSETS) {
      const res = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
      if (res.status !== 404) return res;
    }
  }
  await next();
});

app.get("/", (c) =>
  c.json({
    service: "opexnow-stamp",
    version: "0.1.0",
    environment: c.env.ENVIRONMENT,
    mock_peruri: c.env.MOCK_PERURI === "true",
    time: new Date().toISOString(),
  }),
);

app.route("/auth", authtoken);
app.route("/console", consoleRoutes);
app.route("/templates", templates);
app.route("/stamp", stamp);
app.route("/jobs", jobs);
app.route("/tenants", tenants);
app.route("/download", download);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          stage: err.stage,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.status as 400,
    );
  }
  console.error("unhandled error", err instanceof Error ? err.message : err);
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404) {
      return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
    }
    return res;
  }
  return c.json({ error: { code: "not_found", message: "Route not found" } }, 404);
});

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch, env: Env) {
    for (const msg of batch.messages) {
      const m = msg.body as QueueMessage;
      if (m.type !== "stamp") {
        msg.ack();
        continue;
      }
      try {
        await processJob(env, m.job_id);
        msg.ack();
      } catch (err) {
        if (isRetryableError(err)) {
          console.error(`job ${m.job_id} transient failure, scheduling retry`, (err as Error).message);
          msg.retry();
        } else {
          const stage = err instanceof AppError ? (err.stage ?? "unknown") : "unknown";
          await markJobFailed(env, m.job_id, stage, err instanceof Error ? err.message : String(err));
          msg.ack();
        }
      }
    }
  },
};
