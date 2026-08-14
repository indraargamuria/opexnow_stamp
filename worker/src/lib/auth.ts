import { createMiddleware } from "hono/factory";
import type { Context, Env as HonoEnv, MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { AppError } from "./errors";
import { sha256Hex, hmacSha256, aesGcmDecrypt } from "./crypto";
import type { ApiKeyRow, SessionRow, TenantRow } from "./db";
import { loadTenant } from "./pipeline";

export interface AuthContext {
  tenant: TenantRow;
  sessionId: string | null;
  kind: "console" | "api" | "hmac";
  subject: string | null;
}

export interface AppBindings extends HonoEnv {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
    tenant: TenantRow;
    rawBody: string;
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function verifySessionToken(env: Env, token: string): Promise<AuthContext> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind(tokenHash).first<SessionRow>();
  if (!row) throw AppError.unauthorized();
  if (new Date(row.expires_at).getTime() < Date.now()) throw AppError.unauthorized("Session expired");
  const tenant = await loadTenant(env, row.tenant_id);
  return { tenant, sessionId: row.id, kind: row.kind as AuthContext["kind"], subject: row.subject };
}

async function verifyHmac(c: Context<AppBindings>, env: Env): Promise<AuthContext> {
  const apiKey = c.req.header("x-api-key");
  const ts = c.req.header("x-timestamp");
  const sig = c.req.header("x-signature");
  if (!apiKey || !ts || !sig) throw AppError.unauthorized("Missing HMAC authentication headers");
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
    throw AppError.unauthorized("Request timestamp is too old or invalid");
  }
  const keyRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?").bind(apiKey).first<ApiKeyRow>();
  if (!keyRow) throw AppError.unauthorized("Unknown API key");
  let secret: string;
  try {
    secret = await aesGcmDecrypt(keyRow.secret_encrypted, env.STAMP_CREDENTIAL_ENCRYPTION_KEY, keyRow.id);
  } catch {
    throw AppError.unauthorized("Could not decrypt API key");
  }
  const bodyHash = await sha256Hex(c.get("rawBody") ?? "");
  const message = `${ts}\n${c.req.method}\n${c.req.path}\n${bodyHash}`;
  const expected = await hmacSha256(new TextEncoder().encode(secret), message);
  if (expected !== sig.toLowerCase()) throw AppError.unauthorized("Invalid signature");
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), keyRow.id).run();
  const tenant = await loadTenant(env, keyRow.tenant_id);
  return { tenant, sessionId: null, kind: "hmac", subject: keyRow.id };
}

export async function authenticate(c: Context<AppBindings>, env: Env): Promise<AuthContext> {
  const bearer = c.req.header("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) return verifySessionToken(env, bearer.slice(7).trim());
  const cookies = parseCookies(c.req.header("cookie"));
  if (cookies.opex_session) return verifySessionToken(env, cookies.opex_session);
  return verifyHmac(c, env);
}

/** Requires a valid tenant session (bearer token, console cookie, or HMAC). */
export const requireAuth: MiddlewareHandler<AppBindings> = createMiddleware(async (c, next) => {
  const auth = await authenticate(c, c.env as Env);
  c.set("auth", auth);
  c.set("tenant", auth.tenant);
  await next();
});

/** Reads and caches the raw request body (needed for HMAC verification). */
export const bodyParser: MiddlewareHandler<AppBindings> = createMiddleware(async (c, next) => {
  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH" || c.req.method === "DELETE") {
    const text = await c.req.text();
    c.set("rawBody", text);
  } else {
    c.set("rawBody", "");
  }
  await next();
});

export function readJson<T = Record<string, unknown>>(c: Context<AppBindings>): T {
  const raw = c.get("rawBody") ?? "";
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw AppError.badRequest("Request body is not valid JSON");
  }
}
