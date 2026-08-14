import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const wrangler = path.resolve(root, "wrangler.jsonc");

function readDevVars() {
  const file = path.join(root, ".dev.vars");
  if (!fs.existsSync(file)) {
    console.error("Missing worker/.dev.vars — copy .dev.vars.example first.");
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (line.trim() && idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function aesGcmEncrypt(plaintext, keyB64, aad) {
  const key = Buffer.from(keyB64, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function pbkdf2Hash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  return `pbkdf2$100000$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function generateSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function q(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const vars = readDevVars();
const KEY = vars.STAMP_CREDENTIAL_ENCRYPTION_KEY;
if (!KEY) {
  console.error("STAMP_CREDENTIAL_ENCRYPTION_KEY missing from .dev.vars");
  process.exit(1);
}

const now = new Date().toISOString();
const tenantId = "ten_demo";
const tenantName = "Demo ERP Co.";
const adminEmail = process.env.SEED_EMAIL ?? "admin@demo.local";
const adminPassword = process.env.SEED_PASSWORD ?? "opex-demo-2026";
const keyId = "opx_demo";
const keyName = "Demo integration key";

const apiSecret = generateSecret();
const secretEncrypted = aesGcmEncrypt(apiSecret, KEY, keyId);
const secretHash = sha256Hex(apiSecret);

const stmts = [
  `INSERT OR IGNORE INTO tenants (id, name, status, production_enabled, staging_daily_limit, created_at, updated_at)
   VALUES (${q(tenantId)}, ${q(tenantName)}, 'active', 0, 20, ${q(now)}, ${q(now)})`,
  `INSERT OR IGNORE INTO api_keys (id, tenant_id, name, secret_hash, secret_encrypted, created_at)
   VALUES (${q(keyId)}, ${q(tenantId)}, ${q(keyName)}, ${q(secretHash)}, ${q(secretEncrypted)}, ${q(now)})`,
  `INSERT OR IGNORE INTO console_users (id, tenant_id, email, password_hash, role, created_at)
   VALUES ('usr_demo', ${q(tenantId)}, ${q(adminEmail)}, ${q(pbkdf2Hash(adminPassword))}, 'admin', ${q(now)})`,
];

const sql = stmts.join("; ");
const tmp = path.join(here, ".seed-tmp.sql");
fs.writeFileSync(tmp, sql);

try {
  execSync(`npx wrangler d1 execute stampdb --local --file="${tmp}"`, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
} finally {
  fs.rmSync(tmp, { force: true });
}

console.log("\nSeeded demo tenant:");
console.log("  Tenant id   :", tenantId);
console.log("  Console URL : http://localhost:8787/");
console.log("  Console login:", adminEmail, "/", adminPassword);
console.log("\n  API key      :", keyId);
console.log("  API secret   :", apiSecret);
console.log("  (HMAC with X-API-Key / X-Timestamp / X-Signature, or POST /auth/token for a bearer token)");
