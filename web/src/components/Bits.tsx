import type { ReactNode } from "react";

export function StatusBadge({ status }: { status: string }) {
  const s = status.replace(/^job_/, "");
  const map: Record<string, string> = {
    pending_anchor: "pending",
    pending_sn: "pending",
    sn_issued: "issued",
    signing: "signing",
    signed: "signed",
    failed: "failed",
    rejected: "rejected",
    queued: "queued",
  };
  const cls = map[s] ?? "queued";
  const label = s.replace(/_/g, " ");
  const pulse = s === "pending_anchor" || s === "pending_sn" || s === "signing" || s === "queued";
  return (
    <span className={`status status-${cls}`}>
      <span className={`dot${pulse ? " pulse" : ""}`} />
      {label}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
      <div className="display h2">{title}</div>
      {body && <div className="small muted" style={{ marginTop: 8, maxWidth: 420, marginInline: "auto" }}>{body}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

export function PageHeader({ title, kicker, actions }: { title: string; kicker?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        {kicker && <div className="label" style={{ marginBottom: 6 }}>{kicker}</div>}
        <h1 className="display h1">{title}</h1>
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
