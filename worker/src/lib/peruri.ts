import type { Env } from "./env";
import { AppError } from "./errors";
import { qrModules, qrPng } from "./qr";
import { aesGcmDecrypt } from "./crypto";
import type { TenantRow } from "./db";

export interface PeruriIdentity {
  nama_dipungut: string;
  no_identitas: string;
}

export interface DocumentMetadata {
  invoice_number?: string;
  value?: number;
  identity_type?: string;
  identity_number?: string;
  document_date?: string;
  [k: string]: unknown;
}

export interface StampV2Result {
  serial_number: string;
  qr_png: Uint8Array;
}

export interface JwtCache {
  get(): Promise<string | null>;
  set(token: string, ttlSeconds: number): Promise<void>;
}

export interface PeruriGateway {
  /** Returns a JWT for this gateway's account (cached). */
  login(): Promise<string>;
  /** Issues a serial number + QR image. THIS is where quota is spent. */
  stampV2(params: { identity: PeruriIdentity | null; metadata: DocumentMetadata; documentHash: string }): Promise<StampV2Result>;
  /** Validates stored credentials without spending quota. */
  validateCredentials(): Promise<boolean>;
}

export class PeruriAuthError extends AppError {
  constructor(message: string, status = 502) {
    super(status, "peruri_auth_failed", message, "peruri_auth");
  }
}

export class PeruriApiError extends AppError {
  constructor(message: string, status = 502) {
    super(status, "peruri_api_error", message, "peruri_api");
  }
}

function mockSerialNumber(): string {
  let digits = "2";
  for (let i = 0; i < 9; i++) digits += Math.floor(Math.random() * 10);
  return digits;
}

export function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return "image/png";
}

/** Simulates the Peruri cloud: login + stampv2 + (signing handled by adapter). */
export class MockPeruriGateway implements PeruriGateway {
  constructor(private env: Env) {}
  async login(): Promise<string> {
    return "mock-jwt-" + this.env.ENVIRONMENT;
  }
  async validateCredentials(): Promise<boolean> {
    return true;
  }
  async stampV2(): Promise<StampV2Result> {
    const serialNumber = mockSerialNumber();
    return { serial_number: serialNumber, qr_png: qrPng(qrModules(serialNumber), 8) };
  }
}

interface Credentials {
  username: string;
  password: string;
}

function extractToken(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const data = (typeof p.data === "object" && p.data) ? (p.data as Record<string, unknown>) : p;
    const t = data.token ?? data.access_token ?? data.jwt ?? p.token ?? p.access_token ?? p.jwt;
    if (typeof t === "string" && t.length > 0) return t;
  }
  throw new PeruriAuthError("Peruri login succeeded but no token was returned");
}

async function postJson(url: string, token: string | null, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const status = res.status;
    const message =
      payload && typeof payload === "object"
        ? String((payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error ?? res.statusText)
        : `Peruri API error (HTTP ${status})`;
    throw new PeruriApiError(message, status >= 500 ? status : status === 401 ? 401 : status);
  }
  return payload;
}

/** Real HTTP integration. Contract mirrors the reference integration doc; defensive parsing. */
export class RealPeruriClient implements PeruriGateway {
  constructor(
    private baseUrl: string,
    private stampBaseUrl: string,
    private credentials: Credentials,
    private jwt: JwtCache,
    private identity: PeruriIdentity | null,
  ) {}

  private async ensureToken(): Promise<string> {
    const cached = await this.jwt.get();
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/api/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: this.credentials.username, password: this.credentials.password }),
    });
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* not json */
    }
    if (!res.ok || !payload) {
      const detail = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).message ?? "") : "";
      throw new PeruriAuthError(`Peruri login failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
    }
    const token = extractToken(payload);
    await this.jwt.set(token, 3600);
    return token;
  }

  async login(): Promise<string> {
    return this.ensureToken();
  }

  async validateCredentials(): Promise<boolean> {
    const token = await this.ensureToken();
    return token.length > 0;
  }

  async stampV2(params: { identity: PeruriIdentity | null; metadata: DocumentMetadata; documentHash: string }): Promise<StampV2Result> {
    const token = await this.ensureToken();
    const identity = this.identity ?? params.identity;
    const pick = (...vals: unknown[]): string => {
      for (const v of vals) if (typeof v === "string" && v.trim().length > 0) return v;
      return "";
    };
    const m = params.metadata;
    const body = {
      isUpload: false,
      namadoc: String(m.document_type ?? m.namadoc ?? "2"),
      namafile: String(m.filename ?? "document.pdf"),
      nilaidoc: String(m.value ?? m.nilaidoc ?? "10000"),
      namejidentitas: pick(m.identity_type, m.namejidentitas, "KTP"),
      noidentitas: pick(m.identity_number, m.noidentitas, identity?.no_identitas),
      namedipungut: pick(identity?.nama_dipungut, m.namedipungut),
      snOnly: false,
      nodoc: String(m.invoice_number ?? m.nodoc ?? ""),
      tgldoc: String(m.document_date ?? m.tgldoc ?? new Date().toISOString().slice(0, 10)),
    };
    const payload = await postJson(`${this.stampBaseUrl}/chanel/stampv2`, token, body);
    const root = (payload ?? {}) as Record<string, unknown>;
    if (root.statusCode && root.statusCode !== "00") {
      const result = (typeof root.result === "object" && root.result) ? (root.result as Record<string, unknown>) : {};
      const detail = typeof result.err === "string" ? result.err : "";
      throw new PeruriApiError(`Peruri stampv2 rejected (${String(root.statusCode)})${detail ? `: ${detail}` : ""}`);
    }
    const data = (
      (typeof root.data === "object" && root.data) ? root.data
        : (typeof root.result === "object" && root.result) ? root.result
          : root
    ) as Record<string, unknown>;
    const serialNumber = String(data.serial_number ?? data.sn ?? data.no_seri ?? "");
    let qrBase64 = String(data.qr_code ?? data.qr_image ?? data.image ?? data.qr_base64 ?? data.qr ?? data.qrcode ?? "");
    if (!serialNumber || !qrBase64) throw new PeruriApiError("stampv2 response missing serial number or QR image");
    if (qrBase64.includes(",")) qrBase64 = qrBase64.split(",").pop() ?? qrBase64;
    let qrBytes: Uint8Array;
    try {
      const bin = atob(qrBase64);
      qrBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) qrBytes[i] = bin.charCodeAt(i);
    } catch {
      throw new PeruriApiError("Could not decode QR image returned by Peruri");
    }
    return { serial_number: serialNumber, qr_png: qrBytes };
  }
}

/** Live-validate candidate production credentials without persisting them. */
export async function validateProductionCredentials(env: Env, creds: { username: string; password: string }): Promise<boolean> {
  if (env.MOCK_PERURI === "true") return true;
  const client = new RealPeruriClient(
    env.PERURI_PROD_BASE_URL,
    env.PERURI_PROD_STAMP_BASE_URL,
    creds,
    { get: async () => null, set: async () => {} },
    null,
  );
  return client.validateCredentials();
}

export async function buildGateway(
  env: Env,
  target: "staging" | "production",
  tenant: TenantRow | null,
): Promise<PeruriGateway> {
  if (env.MOCK_PERURI === "true") return new MockPeruriGateway(env);

  const makeJwtCache = (key: string): JwtCache => {
    const id = env.JWT_CACHE.idFromName(key);
    const stub = env.JWT_CACHE.get(id);
    return {
      async get() {
        return stub.get();
      },
      async set(token: string, ttl: number) {
        await stub.set(token, ttl);
      },
    };
  };

  if (target === "staging") {
    return new RealPeruriClient(
      env.PERURI_STAGING_BASE_URL,
      env.PERURI_STAGING_STAMP_BASE_URL,
      { username: env.STAGING_PERURI_USERNAME, password: env.STAGING_PERURI_PASSWORD },
      makeJwtCache("platform"),
      null,
    );
  }

  if (!tenant?.peruri_credentials_encrypted || !tenant.peruri_identity) {
    throw new AppError(400, "production_not_configured", "Production credentials not configured. Set them in Settings first.", "tenant");
  }
  const blob = await aesGcmDecrypt(tenant.peruri_credentials_encrypted, env.STAMP_CREDENTIAL_ENCRYPTION_KEY, tenant.id);
  const creds = JSON.parse(blob) as Credentials;
  const identity = JSON.parse(tenant.peruri_identity) as PeruriIdentity;
  return new RealPeruriClient(env.PERURI_PROD_BASE_URL, env.PERURI_PROD_STAMP_BASE_URL, creds, makeJwtCache(tenant.id), identity);
}
