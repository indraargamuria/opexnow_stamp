import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { requireAuth, readJson } from "../lib/auth";
import { AppError } from "../lib/errors";
import { ids, generateSecret } from "../lib/ids";
import { sha256Hex, aesGcmEncrypt } from "../lib/crypto";
import { validateProductionCredentials } from "../lib/peruri";
import type { ApiKeyRow, TenantRow } from "../lib/db";

const tenants = new Hono<AppBindings>();
tenants.use("*", requireAuth);

tenants.get("/me", async (c) => {
  const tenant = c.get("tenant");
  return c.json({
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    production_enabled: tenant.production_enabled === 1,
    staging_daily_limit: tenant.staging_daily_limit,
    peruri_identity: tenant.peruri_identity ? JSON.parse(tenant.peruri_identity) : null,
    created_at: tenant.created_at,
  });
});

tenants.get("/me/quota", async (c) => {
  const tenant = c.get("tenant");
  const stub = c.env.STAGING_QUOTA.get(c.env.STAGING_QUOTA.idFromName(tenant.id));
  const staging = await stub.peek(tenant.id, tenant.staging_daily_limit);
  return c.json({
    staging: {
      limit: staging.limit,
      used: staging.used,
      remaining: staging.remaining,
      reset_at: staging.reset_at,
      allowed: staging.allowed,
    },
    production: {
      enabled: tenant.production_enabled === 1,
      identity: tenant.peruri_identity ? JSON.parse(tenant.peruri_identity) : null,
    },
  });
});

tenants.put("/me/settings", async (c) => {
  const tenant = c.get("tenant");
  const body = readJson<{
    clear?: boolean;
    peruri_identity?: { nama_dipungut?: string; no_identitas?: string };
    peruri_username?: string;
    peruri_password?: string;
  }>(c);

  if (body.clear) {
    await c.env.DB.prepare("UPDATE tenants SET production_enabled = 0, peruri_credentials_encrypted = NULL, peruri_identity = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), tenant.id)
      .run();
    return c.json({ status: "cleared", production_enabled: false });
  }

  const identity = body.peruri_identity;
  const username = body.peruri_username;
  const password = body.peruri_password;
  if (!identity?.nama_dipungut || !identity.no_identitas) {
    throw AppError.badRequest("peruri_identity requires nama_dipungut and no_identitas (NPWP)");
  }
  if (!username || !password) {
    throw AppError.badRequest("peruri_username and peruri_password are required for production setup");
  }

  const creds = { username, password };
  const ok = await validateProductionCredentials(c.env, creds);
  if (!ok) {
    throw new AppError(400, "peruri_auth_failed", "Peruri rejected these credentials. Check username and password and try again.", "peruri_auth");
  }

  const encrypted = await aesGcmEncrypt(JSON.stringify(creds), c.env.STAMP_CREDENTIAL_ENCRYPTION_KEY, tenant.id);
  await c.env.DB.prepare(
    "UPDATE tenants SET production_enabled = 1, peruri_credentials_encrypted = ?, peruri_identity = ?, updated_at = ? WHERE id = ?",
  )
    .bind(encrypted, JSON.stringify(identity), new Date().toISOString(), tenant.id)
    .run();

  return c.json({ status: "verified", production_enabled: true, peruri_identity: identity });
});

tenants.get("/me/keys", async (c) => {
  const tenant = c.get("tenant");
  const rows = await c.env.DB.prepare("SELECT id, name, created_at, last_used_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC")
    .bind(tenant.id)
    .all<ApiKeyRow>();
  return c.json({ keys: rows.results.map((r) => ({ id: r.id, name: r.name, created_at: r.created_at, last_used_at: r.last_used_at })) });
});

tenants.post("/me/keys", async (c) => {
  const tenant = c.get("tenant");
  const body = readJson<{ name?: string }>(c);
  const name = (body.name ?? "Default key").trim() || "Default key";
  const id = ids.apiKey();
  const secret = generateSecret();
  const secretHash = await sha256Hex(secret);
  const secretEncrypted = await aesGcmEncrypt(secret, c.env.STAMP_CREDENTIAL_ENCRYPTION_KEY, id);
  await c.env.DB.prepare("INSERT INTO api_keys (id, tenant_id, name, secret_hash, secret_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, tenant.id, name, secretHash, secretEncrypted, new Date().toISOString())
    .run();
  return c.json(
    {
      id,
      name,
      api_key: id,
      api_secret: secret,
      warning: "This secret will not be shown again. Copy it now.",
    },
    201,
  );
});

tenants.delete("/me/keys/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM api_keys WHERE id = ? AND tenant_id = ?").bind(id, tenant.id).first<ApiKeyRow>();
  if (!row) throw AppError.notFound("API key not found");
  await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE subject = ? AND kind = 'api'").bind(id).run();
  return c.json({ deleted: id });
});

export default tenants;
