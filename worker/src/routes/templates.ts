import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { requireAuth, readJson } from "../lib/auth";
import { AppError } from "../lib/errors";
import { ids } from "../lib/ids";
import { base64ToBytes, isPdf, downloadUrl } from "../lib/http";
import { extractTextLayers } from "../lib/pdf";
import type { ExtractedDocument } from "../lib/pdf";
import { resolveAnchor, CM_TO_PT } from "../lib/anchor";
import type { AnchorResolution } from "../lib/anchor";
import { R2_PATHS, STAMP_BOX_DEFAULT_PT } from "../lib/pipeline";
import type { TemplateRow } from "../lib/db";
import { rowToTemplate, parseConfig } from "../lib/db";
import type { Env } from "../lib/env";

interface TemplateCandidate {
  keyword: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function docToCandidates(doc: ExtractedDocument): TemplateCandidate[] {
  // Fix: Add better validation and text processing
  return doc.lines
    .filter(l => l.text && l.text.trim().length > 0) // Filter empty lines
    .map((l) => ({
      keyword: l.text.trim().slice(0, 100), // Fix: Reduce to 100 chars and trim
      page: l.page,
      x: Math.round(l.x * 10) / 10,
      y: Math.round(l.y * 10) / 10,
      width: Math.round(l.width * 10) / 10,
      height: Math.round(l.height * 10) / 10,
    }))
    .filter(c => c.keyword.length > 1); // Filter very short keywords
}

async function templatePreview(
  env: Env,
  row: TemplateRow,
): Promise<{ candidates: TemplateCandidate[]; preview_anchor: AnchorResolution | null }> {
  if (!row.sample_storage_key) return { candidates: [], preview_anchor: null };
  const sample = await env.DOCS.get(row.sample_storage_key);
  if (!sample) return { candidates: [], preview_anchor: null };
  const bytes = new Uint8Array(await sample.arrayBuffer());
  try {
    const doc = await extractTextLayers(bytes);
    return {
      candidates: docToCandidates(doc),
      preview_anchor: resolveAnchor(parseConfig(row), doc),
    };
  } catch {
    return { candidates: [], preview_anchor: null };
  }
}

const templates = new Hono<AppBindings>();
templates.use("*", requireAuth);

templates.get("/", async (c) => {
  const tenant = c.get("tenant");
  const rows = await c.env.DB.prepare(
    `SELECT t.*,
            (SELECT MAX(j.created_at) FROM stamp_jobs j WHERE j.template_id = t.id) AS last_used_at,
            (SELECT COUNT(*) FROM stamp_jobs j WHERE j.template_id = t.id) AS job_count
     FROM templates t WHERE t.tenant_id = ? ORDER BY t.updated_at DESC`,
  )
    .bind(tenant.id)
    .all<TemplateRow & { last_used_at: string | null; job_count: number }>();
  return c.json({
    templates: rows.results.map((r) => ({
      ...rowToTemplate(r),
      last_used_at: r.last_used_at,
      job_count: r.job_count,
    })),
  });
});

templates.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = readJson<{ name?: string; document_base64?: string; filename?: string }>(c);
  const name = (body.name ?? "").trim();
  if (!name) throw AppError.badRequest("Template name is required");
  if (!body.document_base64) throw AppError.badRequest("document_base64 is required");

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(body.document_base64);
  } catch {
    throw AppError.badRequest("document_base64 is not valid base64");
  }
  if (!isPdf(bytes)) throw AppError.badRequest("Uploaded sample is not a PDF");

  const doc = await extractTextLayers(bytes);

  const id = ids.template();
  const now = new Date().toISOString();
  const box = STAMP_BOX_DEFAULT_PT;
  const page1 = doc.pages[0] ?? { width: 595, height: 842 };
  const default_position = {
    x: Math.max(0, (page1.width - box.width_pt) / 2),
    y: Math.min(page1.height, (page1.height + box.height_pt) / 2),
    page: 1,
  };

  const sampleKey = R2_PATHS.templateSample(tenant.id, id);
  await c.env.DOCS.put(sampleKey, bytes, { httpMetadata: { contentType: "application/pdf" } });

  await c.env.DB.prepare(
    `INSERT INTO templates (id, tenant_id, name, version, anchors, box, default_position, sample_storage_key, source, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, tenant.id, name, JSON.stringify([]), JSON.stringify(box), JSON.stringify(default_position), sampleKey, "ui", now, now)
    .run();

  const candidates = docToCandidates(doc);

  // Fix: Limit candidates to reasonable size and add metadata
  const MAX_CANDIDATES = 200;
  const displayedCandidates = candidates.slice(0, MAX_CANDIDATES);

  return c.json(
    {
      template_id: id,
      version: 1,
      name,
      page_count: doc.pageCount,
      lines_count: doc.lines.length,
      candidates: displayedCandidates,
      total_candidates: candidates.length,
      candidates_truncated: candidates.length > MAX_CANDIDATES,
      box_pt: box,
      default_position_pt: default_position,
      sample_url: downloadUrl(sampleKey),
    },
    201,
  );
});

templates.get("/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ? AND tenant_id = ?").bind(id, tenant.id).first<TemplateRow>();
  if (!row) throw AppError.notFound("Template not found");

  const { candidates, preview_anchor } = await templatePreview(c.env, row);
  return c.json({
    ...rowToTemplate(row),
    sample_url: row.sample_storage_key ? downloadUrl(row.sample_storage_key) : null,
    candidates: candidates.slice(0, 400),
    preview_anchor,
  });
});

templates.put("/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ? AND tenant_id = ?").bind(id, tenant.id).first<TemplateRow>();
  if (!row) throw AppError.notFound("Template not found");

  const body = readJson<{
    name?: string;
    anchors?: { keyword?: string; dx_cm?: number; dy_cm?: number }[];
    box?: { width_cm?: number; height_cm?: number };
    default_position?: { x_cm?: number; y_cm?: number; page?: number };
  }>(c);

  const anchors = (body.anchors ?? [])
    .filter((a) => (a.keyword ?? "").trim().length > 0)
    .map((a) => ({
      keyword: a.keyword!.trim(),
      dx_pt: Math.round((a.dx_cm ?? 0) * CM_TO_PT * 100) / 100,
      dy_pt: Math.round((a.dy_cm ?? 0) * CM_TO_PT * 100) / 100,
    }));
  if (anchors.length === 0) throw AppError.badRequest("At least one anchor keyword is required");

  const box = {
    width_pt: Math.round((body.box?.width_cm ?? 4.5) * CM_TO_PT * 100) / 100,
    height_pt: Math.round((body.box?.height_cm ?? 4.5) * CM_TO_PT * 100) / 100,
  };

  let default_position: { x: number; y: number; page: number };
  if (body.default_position) {
    default_position = {
      x: Math.round((body.default_position.x_cm ?? 0) * CM_TO_PT * 100) / 100,
      y: Math.round((body.default_position.y_cm ?? 0) * CM_TO_PT * 100) / 100,
      page: body.default_position.page ?? 1,
    };
  } else {
    // Fix: Add error handling for JSON parsing
    try {
      default_position = JSON.parse(row.default_position);
    } catch (parseErr) {
      console.error(`Failed to parse default_position for template ${id}:`, parseErr instanceof Error ? parseErr.message : parseErr);
      throw AppError.badRequest("Invalid template default_position data");
    }
  }

  const name = (body.name ?? row.name).trim();
  const now = new Date().toISOString();
  const version = row.version + 1;

  await c.env.DB.prepare(
    `UPDATE templates SET name = ?, version = ?, anchors = ?, box = ?, default_position = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(name, version, JSON.stringify(anchors), JSON.stringify(box), JSON.stringify(default_position), now, id)
    .run();

  let preview: AnchorResolution = {
    matched: false,
    keyword: null,
    used_default: true,
    page: default_position.page,
    x: default_position.x,
    y: default_position.y,
    confidence: "low",
  };
  if (row.sample_storage_key) {
    const sample = await c.env.DOCS.get(row.sample_storage_key);
    if (sample) {
      const bytes = new Uint8Array(await sample.arrayBuffer());
      try {
        const doc = await extractTextLayers(bytes);
        preview = resolveAnchor({ anchors, box, default_position }, doc);
      } catch (previewErr) {
        console.warn(`Failed to generate preview for template ${id}:`, previewErr instanceof Error ? previewErr.message : previewErr);
        /* preview best-effort */
      }
    }
  }

  // Fix: Add error handling for fresh query
  const fresh = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first<TemplateRow>();
  if (!fresh) {
    throw AppError.notFound("Template not found after update");
  }

  return c.json({
    ...rowToTemplate(fresh),
    preview_anchor: preview,
    sample_url: row.sample_storage_key ? downloadUrl(row.sample_storage_key) : null,
  });
});

templates.delete("/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ? AND tenant_id = ?").bind(id, tenant.id).first<TemplateRow>();
  if (!row) throw AppError.notFound("Template not found");
  await c.env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
  if (row.sample_storage_key) await c.env.DOCS.delete(row.sample_storage_key);
  return c.json({ deleted: id });
});

export default templates;
