export interface TemplateSummary {
  id: string;
  name: string;
  version: number;
  anchors: { keyword: string; dx_pt: number; dy_pt: number }[];
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  job_count: number;
}

export interface AnchorInfo {
  keyword: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: "keyword" | "default";
}

export interface AnchorCandidate {
  keyword: string;
  page: number;
  x: number;
  y: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface JobSummary {
  job_id: string;
  template_id: string | null;
  template_name: string | null;
  stamp_target: "staging" | "production";
  status: string;
  serial_number: string | null;
  sn: string | null;
  anchor_match: AnchorInfo | null;
  anchor: AnchorInfo | null;
  error: { stage?: string; message?: string } | string | null;
  document_metadata: Record<string, unknown>;
  invoice_number: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobDetail extends JobSummary {
  unsigned_storage_key: string | null;
  signed_storage_key: string | null;
  stamped_document_url?: string | null;
  unsigned_download_url?: string | null;
}

export interface TenantSettings {
  tenant_id: string;
  tenant_name: string;
  production_enabled: boolean;
  staging_shared: boolean;
  sender_npwp: string | null;
  sender_name: string | null;
  settlement_reference: string | null;
  updated_at: string;
}

export interface ApiKeyInfo {
  key_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface StagingCredentials {
  username: string;
  password: string;
}

export interface ProductionStatus {
  configured: boolean;
  username: string | null;
  npwp: string | null;
  identity_type: "npwp" | "nik" | null;
  validated: boolean;
}

export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
}

export interface ConsoleMe {
  user: { id: string; email: string; role: string };
  tenant: { id: string; name: string; status: string };
}

export interface StampResult {
  job: JobDetail;
  signed_url: string | null;
}

export const JOB_STEPS = [
  "pending_anchor",
  "pending_sn",
  "sn_issued",
  "signing",
  "signed",
] as const;

export const TERMINAL_STATES = new Set(["signed", "failed", "rejected"]);

export function jobStepIndex(status: string): number {
  const i = JOB_STEPS.indexOf(status as (typeof JOB_STEPS)[number]);
  return i === -1 ? 0 : i;
}
