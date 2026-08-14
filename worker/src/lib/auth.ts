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
    // Fix: Properly handle cookie parsing according to RFC 6265
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      // Handle quoted values
      if (value.startsWith('"') && value.endsWith('"')) {
        out[name] = value.slice(1, -1);
      } else {
        out[name] = decodeURIComponent(value);
      }
    } catch {
      // If decoding fails, use raw value
      out[name] = value;
    }
  }
  return out;
}

async function verifySessionToken(env: Env, token: string): Promise<AuthContext> {
  // Fix: Validate token format before processing
  if (!token || token.length < 10) {
    throw AppError.unauthorized("Invalid token format");
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind(tokenHash).first<SessionRow>();
  if (!row) throw AppError.unauthorized("Invalid session token");

  // Fix: Better session expiration handling
  let expiresAt: Date;
  try {
    expiresAt = new Date(row.expires_at);
  } catch {
    throw AppError.unauthorized("Invalid session expiration");
  }

  // Fix: Check if date is valid before comparison
  if (isNaN(expiresAt.getTime())) {
    throw AppError.unauthorized("Invalid session expiration");
  }

  if (expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized("Session expired");
  }

  const tenant = await loadTenant(env, row.tenant_id);
  return { tenant, sessionId: row.id, kind: row.kind as AuthContext["kind"], subject: row.subject };
}

async function verifyHmac(c: Context<AppBindings>, env: Env): Promise<AuthContext> {
  const apiKey = c.req.header("x-api-key");
  const ts = c.req.header("x-timestamp");
  const sig = c.req.header("x-signature");

  if (!apiKey || !ts || !sig) {
    throw AppError.unauthorized("Missing HMAC authentication headers");
  }

  // Fix: Better timestamp validation with improved error messages
  const tsNum = Number(ts);
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    throw AppError.unauthorized("Invalid timestamp format");
  }

  const timeDiff = Math.abs(now - tsNum);
  const MAX_TIME_SKEW = 300; // 5 minutes

  if (timeDiff > MAX_TIME_SKEW) {
    throw AppError.unauthorized(`Request timestamp is too old or too new (skew: ${timeDiff}s, max: ${MAX_TIME_SKEW}s)`);
  }

  // Fix: Validate API key format
  if (!apiKey || apiKey.length < 5) {
    throw AppError.unauthorized("Invalid API key format");
  }

  const keyRow = await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?").bind(apiKey).first<ApiKeyRow>();
  if (!keyRow) {
    throw AppError.unauthorized("Unknown API key");
  }

  // Check if API key belongs to active tenant
  const tenant = await loadTenant(env, keyRow.tenant_id);

  let secret: string;
  try {
    secret = await aesGcmDecrypt(keyRow.secret_encrypted, env.STAMP_CREDENTIAL_ENCRYPTION_KEY, keyRow.id);
  } catch (decryptErr) {
    console.error(`Failed to decrypt API key ${apiKey}:`, decryptErr instanceof Error ? decryptErr.message : decryptErr);
    throw AppError.unauthorized("Could not decrypt API key");
  }

  // Fix: Validate signature format
  if (!sig || sig.length < 10) {
    throw AppError.unauthorized("Invalid signature format");
  }

  const bodyHash = await sha256Hex(c.get("rawBody") ?? "");
  const message = `${ts}\n${c.req.method}\n${c.req.path}\n${bodyHash}`;
  const expected = await hmacSha256(new TextEncoder().encode(secret), message);

  // Fix: Case-insensitive signature comparison
  if (expected.toLowerCase() !== sig.toLowerCase()) {
    throw AppError.unauthorized("Invalid signature");
  }

  // Fix: Handle database update failure gracefully
  try {
    await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), keyRow.id)
      .run();
  } catch (dbErr) {
    console.warn(`Failed to update last_used_at for API key ${apiKey}:`, dbErr instanceof Error ? dbErr.message : dbErr);
    // Continue anyway - this is not critical
  }

  return { tenant, sessionId: null, kind: "hmac", subject: keyRow.id };
}

export async function authenticate(c: Context<AppBindings>, env: Env): Promise<AuthContext> {
  const bearer = c.req.header("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    // Fix: Better bearer token parsing with multiple spaces handling
    const token = bearer.slice(7).trim();
    if (!token) {
      throw AppError.unauthorized("Bearer token is empty");
    }
    return verifySessionToken(env, token);
  }

  const cookies = parseCookies(c.req.header("cookie"));
  if (cookies.opex_session) {
    return verifySessionToken(env, cookies.opex_session);
  }

  return verifyHmac(c, env);
}

/** Requires a valid tenant session (bearer token, console cookie, or HMAC). */
export const requireAuth: MiddlewareHandler<AppBindings> = createMiddleware(async (c, next) => {
  try {
    const auth = await authenticate(c, c.env as Env);
    c.set("auth", auth);
    c.set("tenant", auth.tenant);
    await next();
  } catch (err) {
    // Fix: Better error handling in middleware
    if (err instanceof AppError) {
      throw err;
    }
    console.error("Authentication error:", err instanceof Error ? err.message : err);
    throw AppError.unauthorized("Authentication failed");
  }
});

/** Reads and caches the raw request body (needed for HMAC verification). */
export const bodyParser: MiddlewareHandler<AppBindings> = createMiddleware(async (c, next) => {
  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH" || c.req.method === "DELETE") {
    try {
      const text = await c.req.text();
      c.set("rawBody", text);
    } catch (readErr) {
      console.error("Failed to read request body:", readErr instanceof Error ? readErr.message : readErr);
      c.set("rawBody", "");
    }
  } else {
    c.set("rawBody", "");
  }
  await next();
});

export function readJson<T = Record<string, unknown>>(c: Context<AppBindings>): T {
  const raw = c.get("rawBody");
  // Fix: Handle undefined rawBody properly
  if (raw === undefined || raw === null || raw === "") {
    return {} as T;
  }
  if (typeof raw !== "string") {
    throw AppError.badRequest("Invalid request body type");
  }
  try {
    return JSON.parse(raw) as T;
  } catch (parseErr) {
    throw AppError.badRequest("Request body is not valid JSON");
  }
}
