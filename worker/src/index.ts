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
// Note: For production, consider using Cloudflare Workers KV or Durable Objects
// for distributed rate limiting across multiple isolates.
// ---------------------------------------------------------------------------

const limiter = new Map<string, { start: number; count: number }>();

// Fix: Add cleanup interval for old entries
const CLEANUP_INTERVAL = 60_000; // 1 minute
const MAX_ENTRIES = 10_000;

function cleanupLimiter(): void {
  const now = Date.now();
  const cutoff = now - 120_000; // 2 minutes
  let cleaned = 0;

  for (const [key, value] of limiter) {
    if (value.start < cutoff) {
      limiter.delete(key);
      cleaned++;
      if (cleaned >= 1000) break; // Limit cleanup batch size
    }
  }
}

// Run cleanup periodically
setInterval(cleanupLimiter, CLEANUP_INTERVAL);

function checkRate(ip: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  // Fix: Add proactive cleanup before checking
  if (limiter.size > MAX_ENTRIES) {
    cleanupLimiter();
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
  // Fix: Better IP address extraction with multiple X-Forwarded-For handling
  const cfIp = c.req.header("cf-connecting-ip");
  const xff = c.req.header("x-forwarded-for");
  let ip = "local";

  if (cfIp) {
    ip = cfIp;
  } else if (xff) {
    // Take the first IP from X-Forwarded-For (original client)
    const ips = xff.split(",").map(s => s.trim());
    ip = ips[0] ?? "local";
  }

  const path = c.req.path;
  const sensitive = path === "/console/login" || path === "/auth/token";
  if (!checkRate(ip, 60_000, sensitive ? 15 : 300)) {
    throw AppError.tooMany("Rate limit exceeded. Slow down and retry.", undefined);
  }
  await next();
});

app.use("*", async (c, next) => {
  // Fix: Environment-aware CORS configuration
  const env = c.env.ENVIRONMENT ?? "development";
  const allowed = env === "production"
    ? [] // In production, configure proper allowed origins
    : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"];

  const origin = c.req.header("Origin");
  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Timestamp, X-Signature");
    c.header("Access-Control-Expose-Headers", "X-Staging-Quota-Remaining");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Max-Age", "86400"); // 24 hours
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

// Fix: Add health check endpoint for monitoring
app.get("/health", (c) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT ?? "unknown",
    checks: {
      database: "unknown", // Would need actual DB ping
      storage: "unknown",  // Would need actual R2 ping
      durable_objects: "unknown" // Would need actual DO ping
    }
  };

  return c.json(health);
});

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

  // Fix: Better error logging with context
  const requestId = crypto.randomUUID();
  const errorContext = {
    requestId,
    path: c.req.path,
    method: c.req.method,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    timestamp: new Date().toISOString()
  };

  console.error("unhandled error", JSON.stringify(errorContext));
  return c.json({
    error: {
      code: "internal_error",
      message: "Internal server error",
      request_id: requestId
    }
  }, 500);
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

      // Fix: Add message validation
      if (!m || typeof m !== "object") {
        console.error("Invalid queue message format:", JSON.stringify(m));
        msg.ack();
        continue;
      }

      if (m.type !== "stamp") {
        msg.ack();
        continue;
      }

      // Fix: Validate job_id format
      if (!m.job_id || typeof m.job_id !== "string" || !m.job_id.startsWith("job_")) {
        console.error("Invalid job_id in queue message:", JSON.stringify(m));
        msg.ack();
        continue;
      }

      try {
        await processJob(env, m.job_id);
        msg.ack();
      } catch (err) {
        // Fix: Better error logging with job context
        const errorContext = {
          job_id: m.job_id,
          error_type: err instanceof Error ? err.constructor.name : typeof err,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString()
        };

        if (isRetryableError(err)) {
          console.error(`job ${m.job_id} transient failure, scheduling retry:`, JSON.stringify(errorContext));
          msg.retry();
        } else {
          const stage = err instanceof AppError ? (err.stage ?? "unknown") : "unknown";
          await markJobFailed(env, m.job_id, stage, err instanceof Error ? err.message : String(err));
          console.error(`job ${m.job_id} permanent failure:`, JSON.stringify(errorContext));
          msg.ack();
        }
      }
    }
  },
};
