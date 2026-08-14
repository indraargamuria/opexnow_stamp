import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { requireAuth, readJson } from "../lib/auth";
import { AppError } from "../lib/errors";
import { base64ToBytes, isPdf, downloadUrl } from "../lib/http";
import { createJob, processJob } from "../lib/pipeline";
import type { JobRow } from "../lib/db";
import { rowToJob } from "../lib/db";

const stamp = new Hono<AppBindings>();
stamp.use("*", requireAuth);

export async function markJobFailed(env: AppBindings["Bindings"], jobId: string, stage: string, message: string): Promise<void> {
  await env.DB.prepare("UPDATE stamp_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify({ stage, message }), new Date().toISOString(), jobId)
    .run();
}

stamp.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = readJson<{
    template_id?: string;
    stamp_target?: string;
    document_base64?: string;
    document_metadata?: Record<string, unknown>;
    mode?: "sync" | "async";
    documents?: { template_id?: string; document_base64?: string; document_metadata?: Record<string, unknown> }[];
  }>(c);

  const target = body.stamp_target;
  if (target !== "staging" && target !== "production") {
    throw AppError.badRequest("stamp_target must be 'staging' or 'production'");
  }
  if (body.documents && body.documents.length > 0) {
    const mode = body.mode ?? "async";
    const jobs: string[] = [];
    for (const d of body.documents) {
      if (!d.document_base64 || !d.template_id) throw AppError.badRequest("Each document needs template_id and document_base64");
      const bytes = base64ToBytes(d.document_base64);
      if (!isPdf(bytes)) throw AppError.badRequest("A document in the batch is not a valid PDF");
      const job = await createJob(c.env, tenant.id, {
        template_id: d.template_id,
        stamp_target: target as "staging" | "production",
        document: bytes,
        document_metadata: d.document_metadata ?? {},
      });
      jobs.push(job.id);
      await c.env.STAMP_QUEUE.send({ type: "stamp", job_id: job.id, tenant_id: tenant.id });
    }
    return c.json({ status: "queued", job_ids: jobs, poll: "/jobs", mode }, 202);
  }

  const single = body.documents?.[0];
  const templateId = body.template_id ?? single?.template_id;
  const b64 = body.document_base64 ?? single?.document_base64;
  const meta = body.document_metadata ?? single?.document_metadata ?? {};
  if (!templateId) throw AppError.badRequest("template_id is required");
  if (!b64) throw AppError.badRequest("document_base64 is required");

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    throw AppError.badRequest("document_base64 is not valid base64");
  }
  if (!isPdf(bytes)) throw AppError.badRequest("Uploaded document is not a valid PDF");

  const job = await createJob(c.env, tenant.id, {
    template_id: templateId,
    stamp_target: target as "staging" | "production",
    document: bytes,
    document_metadata: meta,
  });

  if ((body.mode ?? "sync") === "async") {
    await c.env.STAMP_QUEUE.send({ type: "stamp", job_id: job.id, tenant_id: tenant.id });
    return c.json({ status: "queued", job_id: job.id, poll: `/jobs/${job.id}`, mode: "async" }, 202);
  }

  try {
    const result = await processJob(c.env, job.id);
    if (target === "staging" && result.quota_remaining !== null) {
      c.header("X-Staging-Quota-Remaining", String(result.quota_remaining));
    }
    return c.json({
      job_id: result.job.id,
      status: result.job.status,
      serial_number: result.job.serial_number,
      template_version: result.template_version,
      stamped_document_url: result.job.signed_storage_key ? downloadUrl(result.job.signed_storage_key) : null,
      anchor_match: result.anchor,
      quota_remaining: result.quota_remaining,
      job: result.job,
    });
  } catch (err) {
    if (err instanceof AppError) {
      await markJobFailed(c.env, job.id, err.stage ?? "unknown", err.message);
      throw err;
    }
    throw err;
  }
});

stamp.get("/:id", async (c) => {
  const tenant = c.get("tenant");
  const row = await c.env.DB.prepare("SELECT * FROM stamp_jobs WHERE id = ? AND tenant_id = ?")
    .bind(c.req.param("id"), tenant.id)
    .first<JobRow>();
  if (!row) throw AppError.notFound("Job not found");
  const job = rowToJob(row);
  return c.json({
    ...job,
    stamped_document_url: job.signed_storage_key ? downloadUrl(job.signed_storage_key) : null,
  });
});

export default stamp;
