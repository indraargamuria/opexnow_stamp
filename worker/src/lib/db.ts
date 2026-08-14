export interface TenantRow {
  id: string;
  name: string;
  status: string;
  production_enabled: number;
  peruri_identity: string | null;
  peruri_credentials_encrypted: string | null;
  staging_daily_limit: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  anchors: string;
  box: string;
  default_position: string;
  sample_storage_key: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  tenant_id: string;
  template_id: string | null;
  stamp_target: string;
  status: string;
  serial_number: string | null;
  qr_storage_key: string | null;
  unsigned_storage_key: string;
  signed_storage_key: string | null;
  error: string | null;
  anchor_match: string | null;
  document_metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyRow {
  id: string;
  tenant_id: string;
  name: string;
  secret_hash: string;
  secret_encrypted: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ConsoleUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  tenant_id: string;
  subject: string;
  kind: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface TemplateConfig {
  anchors: { keyword: string; dx_pt: number; dy_pt: number }[];
  box: { width_pt: number; height_pt: number };
  default_position: { x: number; y: number; page: number };
}

export function parseConfig(row: TemplateRow): TemplateConfig {
  return {
    anchors: JSON.parse(row.anchors),
    box: JSON.parse(row.box),
    default_position: JSON.parse(row.default_position),
  };
}

export function rowToJob(row: JobRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    template_id: row.template_id,
    stamp_target: row.stamp_target,
    status: row.status,
    serial_number: row.serial_number,
    qr_storage_key: row.qr_storage_key,
    unsigned_storage_key: row.unsigned_storage_key,
    signed_storage_key: row.signed_storage_key,
    error: row.error ? JSON.parse(row.error) : null,
    anchor_match: row.anchor_match ? JSON.parse(row.anchor_match) : null,
    document_metadata: row.document_metadata ? JSON.parse(row.document_metadata) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** UI/API-facing job summary with friendly aliases and metadata extracted. */
export function rowToJobSummary(row: JobRow & { template_name?: string | null }) {
  const job = rowToJob(row);
  const meta = (job.document_metadata ?? {}) as Record<string, unknown>;
  return {
    job_id: job.id,
    template_id: job.template_id,
    template_name: row.template_name ?? null,
    stamp_target: job.stamp_target,
    status: job.status,
    serial_number: job.serial_number,
    sn: job.serial_number,
    anchor_match: job.anchor_match,
    anchor: job.anchor_match,
    error: job.error,
    document_metadata: job.document_metadata,
    created_at: job.created_at,
    updated_at: job.updated_at,
    invoice_number: typeof meta.invoice_number === "string" ? meta.invoice_number : null,
    file_name: typeof meta.file_name === "string" ? meta.file_name : null,
  };
}

export function rowToTemplate(row: TemplateRow) {
  const cfg = parseConfig(row);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    anchors: cfg.anchors,
    box: cfg.box,
    default_position: cfg.default_position,
    sample_storage_key: row.sample_storage_key,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
