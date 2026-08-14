import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { requireAuth } from "../lib/auth";
import { AppError } from "../lib/errors";
import { downloadUrl } from "../lib/http";
import type { JobRow } from "../lib/db";
import { rowToJob, rowToJobSummary } from "../lib/db";

const jobs = new Hono<AppBindings>();
jobs.use("*", requireAuth);

jobs.get("/", async (c) => {
  const tenant = c.get("tenant");
  const status = c.req.query("status");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));

  let sql =
    "SELECT j.*, t.name AS template_name FROM stamp_jobs j LEFT JOIN templates t ON t.id = j.template_id WHERE j.tenant_id = ?";
  const params: unknown[] = [tenant.id];
  if (status) {
    sql += " AND j.status = ?";
    params.push(status);
  }
  sql += " ORDER BY j.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = await c.env.DB.prepare(sql).bind(...params).all<JobRow & { template_name: string | null }>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM stamp_jobs WHERE tenant_id = ?")
    .bind(tenant.id)
    .first<{ n: number }>();

  return c.json({
    jobs: rows.results.map((r) => rowToJobSummary(r)),
    total: total?.n ?? 0,
    limit,
    offset,
  });
});

jobs.get("/:id", async (c) => {
  const tenant = c.get("tenant");
  const row = await c.env.DB.prepare(
    "SELECT j.*, t.name AS template_name FROM stamp_jobs j LEFT JOIN templates t ON t.id = j.template_id WHERE j.id = ? AND j.tenant_id = ?",
  )
    .bind(c.req.param("id"), tenant.id)
    .first<JobRow & { template_name: string | null }>();
  if (!row) throw AppError.notFound("Job not found");
  const job = rowToJob(row);
  return c.json({
    ...rowToJobSummary(row),
    unsigned_storage_key: job.unsigned_storage_key,
    signed_storage_key: job.signed_storage_key,
    stamped_document_url: job.signed_storage_key ? downloadUrl(job.signed_storage_key) : null,
    unsigned_download_url: downloadUrl(job.unsigned_storage_key),
  });
});

export default jobs;
