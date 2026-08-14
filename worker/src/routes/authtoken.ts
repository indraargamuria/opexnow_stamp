import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { bodyParser, readJson } from "../lib/auth";
import { AppError } from "../lib/errors";
import { ids } from "../lib/ids";
import { sha256Hex, aesGcmDecrypt } from "../lib/crypto";
import type { ApiKeyRow } from "../lib/db";

const authtoken = new Hono<AppBindings>();

/** Exchange an API key + secret for a short-lived bearer token. */
authtoken.post("/token", bodyParser, async (c) => {
  const body = readJson<{ api_key?: string; api_secret?: string }>(c);
  const apiKey = body.api_key;
  const apiSecret = body.api_secret;
  if (!apiKey || !apiSecret) throw AppError.badRequest("api_key and api_secret are required");

  const row = await c.env.DB.prepare("SELECT * FROM api_keys WHERE id = ?").bind(apiKey).first<ApiKeyRow>();
  if (!row) throw AppError.unauthorized("Unknown API key");

  const expectedHash = await sha256Hex(apiSecret);
  if (expectedHash !== row.secret_hash) throw AppError.unauthorized("Invalid API secret");

  const ttl = Math.max(60, Number(c.env.SESSION_TTL_SECONDS ?? 86400));
  const token = `opx_sess_${crypto.getRandomValues(new Uint32Array(4)).join("")}_${ids.session()}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, tenant_id, subject, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, 'api', ?, ?, ?)",
  )
    .bind(ids.session(), row.tenant_id, row.id, tokenHash, expiresAt, new Date().toISOString())
    .run();

  return c.json({ token, token_type: "bearer", expires_at: expiresAt, tenant_id: row.tenant_id });
});

export default authtoken;
