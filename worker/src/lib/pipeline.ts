import type { Env } from "./env";
import { AppError } from "./errors";
import { extractTextLayers } from "./pdf";
import { resolveAnchor, CM_TO_PT, MM_TO_PT } from "./anchor";
import { signWithAdapter } from "./stamp";
import { buildGateway, detectImageMime, type DocumentMetadata } from "./peruri";
import type { JobRow, TemplateRow, TenantRow } from "./db";
import { rowToJob, parseConfig } from "./db";
import type { AnchorResolution } from "./anchor";

export const STAMP_BOX_DEFAULT_PT = { width_pt: Math.round(4.5 * CM_TO_PT), height_pt: Math.round(4.5 * CM_TO_PT) };

export interface CreateJobInput {
  template_id: string | null;
  stamp_target: "staging" | "production";
  document: Uint8Array;
  document_metadata: DocumentMetadata;
}

export const R2_PATHS = {
  templateSample: (tenantId: string, templateId: string) => `tenants/${tenantId}/templates/${templateId}/sample.pdf`,
  unsigned: (tenantId: string, jobId: string) => `tenants/${tenantId}/jobs/${jobId}/unsigned.pdf`,
  qr: (tenantId: string, jobId: string) => `tenants/${tenantId}/jobs/${jobId}/qr.png`,
  signed: (tenantId: string, jobId: string) => `tenants/${tenantId}/jobs/${jobId}/signed.pdf`,
};

const RETRYABLE_STAGES = new Set(["peruri_auth", "peruri_api", "signing"]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export function isRetryableError(err: unknown): boolean {
  return err instanceof AppError && err.stage !== null && RETRYABLE_STAGES.has(err.stage);
}

export async function loadTenant(env: Env, tenantId: string): Promise<TenantRow> {
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first<TenantRow>();
  if (!row) throw AppError.notFound("Tenant not found");
  if (row.status !== "active") throw AppError.forbidden("Tenant is suspended");
  return row;
}

export async function loadTemplate(env: Env, tenantId: string, templateId: string): Promise<TemplateRow> {
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ? AND tenant_id = ?").bind(templateId, tenantId).first<TemplateRow>();
  if (!row) throw AppError.notFound("Template not found");
  return row;
}

async function setJobStatus(env: Env, jobId: string, status: string, fields?: Record<string, unknown>): Promise<void> {
  const cols: string[] = ["status = ?", "updated_at = ?"];
  const vals: unknown[] = [status, new Date().toISOString()];
  for (const [k, v] of Object.entries(fields ?? {})) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(jobId);
  await env.DB.prepare(`UPDATE stamp_jobs SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Exponential backoff delay calculation
 */
function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Insert a stamp job and stage the unsigned document in R2.
 */
export async function createJob(env: Env, tenantId: string, input: CreateJobInput): Promise<JobRow> {
  const now = new Date().toISOString();
  const job = {
    id: `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    tenant_id: tenantId,
    template_id: input.template_id,
    stamp_target: input.stamp_target,
    status: "pending_anchor",
    unsigned_storage_key: "",
    created_at: now,
    updated_at: now,
  };
  const unsignedKey = R2_PATHS.unsigned(tenantId, job.id);
  await env.DOCS.put(unsignedKey, input.document, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare(
    `INSERT INTO stamp_jobs (id, tenant_id, template_id, stamp_target, status, unsigned_storage_key, document_metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(job.id, job.tenant_id, job.template_id, job.stamp_target, job.status, unsignedKey, JSON.stringify(input.document_metadata ?? {}), now, now)
    .run();
  return job as unknown as JobRow;
}

async function quotaStub(env: Env, tenantId: string) {
  return env.STAGING_QUOTA.get(env.STAGING_QUOTA.idFromName(tenantId));
}

/**
 * Run the stamp job state machine:
 *   pending_anchor → pending_sn → sn_issued → signing → signed
 *
 * Anchor resolution completes (and is validated) BEFORE any Peruri quota is
 * spent. Staging quota is deducted only on a successful `stampv2` call.
 * On failure, throws AppError; status is left at the last reached stage so
 * the caller can decide to retry or mark failed.
 */
export async function processJob(env: Env, jobId: string): Promise<{ job: ReturnType<typeof rowToJob>; anchor: AnchorResolution; template_version: number; quota_remaining: number | null }> {
  const jobRow = await env.DB.prepare("SELECT * FROM stamp_jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!jobRow) throw AppError.notFound("Job not found");
  if (jobRow.status === "signed") {
    // Fix: Use safe JSON parsing and provide proper fallback
    return {
      job: rowToJob(jobRow),
      anchor: safeJsonParse(jobRow.anchor_match, { matched: false, keyword: null, used_default: true, page: 1, x: 0, y: 0, confidence: "low" }),
      template_version: 0,
      quota_remaining: null
    };
  }

  // Fix: Add validation for terminal states to prevent processing completed/failed jobs
  if (jobRow.status === "failed") {
    throw new AppError(400, "job_failed", "Cannot process a job that has already failed", "job");
  }

  const tenant = await loadTenant(env, jobRow.tenant_id);
  const template = jobRow.template_id ? await loadTemplate(env, jobRow.tenant_id, jobRow.template_id) : null;
  if (!template) throw new AppError(400, "template_required", "A template is required to stamp a document", "template");

  // ---- stage 1: anchor resolution (costs nothing) --------------------------
  let anchor: AnchorResolution;
  if (jobRow.status === "pending_anchor" || !jobRow.anchor_match) {
    await setJobStatus(env, jobId, "pending_anchor");
    const unsigned = await env.DOCS.get(jobRow.unsigned_storage_key);
    if (!unsigned) throw new AppError(500, "unsigned_missing", "Unsigned document missing from storage", "storage");
    const pdfBytes = new Uint8Array(await unsigned.arrayBuffer());
    const doc = await extractTextLayers(pdfBytes);
    const cfg = parseConfig(template);

    // Fix: Add better error handling for anchor resolution
    try {
      anchor = resolveAnchor(cfg, doc);
      if (doc.lines.length === 0) {
        // No text layer — scanned/flattened document. OCR fallback is a separate
        // compute-tier concern; flag low confidence and use the default position.
        anchor = {
          matched: false,
          keyword: null,
          used_default: true,
          page: cfg.default_position.page,
          x: cfg.default_position.x,
          y: cfg.default_position.y,
          confidence: "low"
        };
      }
    } catch (anchorErr) {
      // Log error but continue with default position
      console.warn(`Anchor resolution failed for job ${jobId}:`, anchorErr instanceof Error ? anchorErr.message : anchorErr);
      anchor = {
        matched: false,
        keyword: null,
        used_default: true,
        page: cfg.default_position.page,
        x: cfg.default_position.x,
        y: cfg.default_position.y,
        confidence: "low"
      };
    }

    await setJobStatus(env, jobId, "pending_sn", { anchor_match: JSON.stringify(anchor) });
  } else {
    // Fix: Use safe JSON parsing with proper fallback
    anchor = safeJsonParse(jobRow.anchor_match, {
      matched: false,
      keyword: null,
      used_default: true,
      page: 1,
      x: 0,
      y: 0,
      confidence: "low"
    });
  }

  // ---- stage 2: peruri stampv2 (THIS is where staging quota is spent) ------
  const cfg = parseConfig(template);

  let quota_remaining: number | null = null;
  if (jobRow.stamp_target === "staging") {
    const stub = await quotaStub(env, jobRow.tenant_id);
    const peek = await stub.peek(jobRow.tenant_id, tenant.staging_daily_limit);
    if (peek.remaining <= 0) {
      throw AppError.tooMany(
        "Staging quota exhausted for today. It resets at UTC midnight.",
        peek.reset_at,
        { reset_at: peek.reset_at, limit: peek.limit },
      );
    }
  }

  if (!refreshed!.serial_number) {
    const gateway = await buildGateway(env, jobRow.stamp_target as "staging" | "production", tenant);
    const metadata: DocumentMetadata = refreshed!.document_metadata ? JSON.parse(refreshed!.document_metadata) : {};
    const result = await gateway.stampV2({
      identity: jobRow.stamp_target === "production" ? (tenant.peruri_identity ? JSON.parse(tenant.peruri_identity) : null) : null,
      metadata,
      documentHash: await sha256HexShort(env, jobRow.unsigned_storage_key),
    });
    await setJobStatus(env, jobId, "sn_issued", { serial_number: result.serial_number });
    await env.DOCS.put(R2_PATHS.qr(jobRow.tenant_id, jobId), result.qr_png, { httpMetadata: { contentType: detectImageMime(result.qr_png) } });
    await setJobStatus(env, jobId, "sn_issued", { qr_storage_key: R2_PATHS.qr(jobRow.tenant_id, jobId) });

    if (jobRow.stamp_target === "staging") {
      const stub = await quotaStub(env, jobRow.tenant_id);
      const inc = await stub.increment(jobRow.tenant_id, tenant.staging_daily_limit);
      quota_remaining = inc.remaining;
    }
  }

  // ---- stage 3: signing via signadapter (retryable, no re-spend) -----------
  // Fix: Fetch job state once to avoid redundant database queries
  const currentJob = await env.DB.prepare("SELECT * FROM stamp_jobs WHERE id = ?").bind(jobId).first<JobRow>();
  const serialNumber = currentJob!.serial_number;
  if (!serialNumber) throw new AppError(500, "missing_sn", "Job reached signing without a serial number", "signing");

  await setJobStatus(env, jobId, "signing");
  const unsignedObj = await env.DOCS.get(jobRow.unsigned_storage_key);
  if (!unsignedObj) throw new AppError(500, "unsigned_missing", "Unsigned document missing from storage", "storage");
  const pdfBytes = new Uint8Array(await unsignedObj.arrayBuffer());

  const box = cfg.box;
  const placement = {
    x: anchor.x,
    y: anchor.y,
    page: anchor.page,
    width_pt: box.width_pt,
    height_pt: box.height_pt,
  };

  let signed: Uint8Array | null = null;
  // Fix: Use exponential backoff and max retries constant
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const qrObj = await env.DOCS.get(R2_PATHS.qr(jobRow.tenant_id, jobId));
      signed = await signWithAdapter({
        originalPdf: pdfBytes,
        serialNumber,
        placement,
        qr: qrObj
          ? { bytes: new Uint8Array(await qrObj.arrayBuffer()), mime: qrObj.httpMetadata?.contentType ?? "image/png" }
          : undefined,
      });
      break;
    } catch (err) {
      if (attempt >= MAX_RETRIES - 1) throw err;
      // Fix: Use exponential backoff instead of fixed delay
      const delay = getBackoffDelay(attempt);
      await new Promise((r) => setTimeout(r, delay));
      console.warn(`Signing attempt ${attempt + 1} failed for job ${jobId}, retrying in ${delay}ms...`);
    }
  }
  if (!signed) throw new AppError(500, "sign_failed", "Signing failed after retries", "signing");

  const signedKey = R2_PATHS.signed(jobRow.tenant_id, jobId);
  await env.DOCS.put(signedKey, signed, { httpMetadata: { contentType: "application/pdf" } });
  await setJobStatus(env, jobId, "signed", { signed_storage_key: signedKey });
  await env.DB.prepare("UPDATE templates SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), template.id).run();

  const final = await env.DB.prepare("SELECT * FROM stamp_jobs WHERE id = ?").bind(jobId).first<JobRow>();
  return {
    job: rowToJob(final!),
    anchor,
    template_version: template.version,
    quota_remaining,
  };
}

async function sha256HexShort(env: Env, key: string): Promise<string> {
  try {
    const obj = await env.DOCS.get(key);
    if (!obj) {
      // Fix: Throw proper error instead of returning "missing" string
      throw new AppError(500, "storage_missing", `Document not found in storage: ${key}`, "storage");
    }
    const buf = await obj.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest.slice(0, 8)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (err) {
    // Fix: Proper error handling for hash computation
    if (err instanceof AppError) throw err;
    throw new AppError(500, "hash_failed", `Failed to compute document hash: ${err instanceof Error ? err.message : err}`, "hash");
  }
}
