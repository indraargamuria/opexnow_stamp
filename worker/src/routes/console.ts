import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { bodyParser, requireAuth, readJson } from "../lib/auth";
import { AppError } from "../lib/errors";
import { ids } from "../lib/ids";
import { sha256Hex, pbkdf2Verify } from "../lib/crypto";
import type { ConsoleUserRow, TenantRow } from "../lib/db";

const consoleRoutes = new Hono<AppBindings>();

function setSessionCookie(c: { header: (n: string, v: string) => void }, token: string, ttlSeconds: number, secure: boolean) {
  const parts = [`opex_session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${ttlSeconds}`];
  if (secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(c: { header: (n: string, v: string) => void }) {
  c.header("Set-Cookie", "opex_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

consoleRoutes.post("/login", bodyParser, async (c) => {
  const body = readJson<{ email?: string; password?: string }>(c);
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) throw AppError.badRequest("Email and password are required");

  const user = await c.env.DB.prepare("SELECT * FROM console_users WHERE email = ?").bind(email).first<ConsoleUserRow>();
  if (!user) throw AppError.unauthorized("Invalid email or password");
  const ok = await pbkdf2Verify(password, user.password_hash);
  if (!ok) throw AppError.unauthorized("Invalid email or password");

  const ttl = Math.max(60, Number(c.env.SESSION_TTL_SECONDS ?? 86400));
  const token = `sess_${crypto.getRandomValues(new Uint32Array(4)).join("")}_${ids.session()}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, tenant_id, subject, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, 'console', ?, ?, ?)",
  )
    .bind(ids.session(), user.tenant_id, user.id, tokenHash, expiresAt, new Date().toISOString())
    .run();

  const tenant = await c.env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(user.tenant_id).first<TenantRow>();
  const secure = c.env.ENVIRONMENT !== "local";
  setSessionCookie(c, token, ttl, secure);

  return c.json({
    token,
    expires_at: expiresAt,
    user: { id: user.id, email: user.email, role: user.role },
    tenant: tenant ? { id: tenant.id, name: tenant.name, status: tenant.status } : null,
  });
});

consoleRoutes.post("/logout", async (c) => {
  const bearer = c.req.header("authorization");
  const cookies = c.req.header("cookie") ?? "";
  const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : parseCookieValue(cookies, "opex_session");
  if (token) {
    const tokenHash = await sha256Hex(token);
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

consoleRoutes.get("/me", requireAuth, async (c) => {
  const auth = c.get("auth");
  const user = await c.env.DB.prepare("SELECT id, email, role, created_at FROM console_users WHERE id = ?").bind(auth.subject).first();
  const tenant = c.get("tenant");
  if (!user) throw AppError.unauthorized();
  return c.json({
    user: { ...user },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      production_enabled: tenant.production_enabled === 1,
      staging_daily_limit: tenant.staging_daily_limit,
      peruri_identity: tenant.peruri_identity ? JSON.parse(tenant.peruri_identity) : null,
    },
  });
});

function parseCookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export default consoleRoutes;
