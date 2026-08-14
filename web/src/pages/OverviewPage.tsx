import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { JobSummary } from "../lib/types";
import { fmtNumber, fmtTime, shortId } from "../lib/format";
import { useEnv } from "../lib/env";
import { PageHeader, StatusBadge, EmptyState } from "../components/Bits";
import { EnvSwitcher } from "../components/EnvSwitcher";

export function OverviewPage() {
  const navigate = useNavigate();
  const { target } = useEnv();
  const [quota, setQuota] = useState<{ limit: number; used: number; remaining: number; reset_at: string | null } | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [templates, setTemplates] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [q, j, t] = await Promise.all([
          api<{ staging: { limit: number; used: number; remaining: number; reset_at: string | null } }>("/tenants/me/quota"),
          api<{ jobs: JobSummary[] }>("/jobs?limit=8"),
          api<{ templates: unknown[] }>("/templates"),
        ]);
        if (!alive) return;
        setQuota(q.staging);
        setJobs(j.jobs ?? []);
        setTemplates(t.templates?.length ?? 0);
      } catch {
        /* keep defaults */
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const stuck = jobs.filter(
    (j) =>
      j.status === "failed" ||
      j.status === "rejected" ||
      (j.status !== "signed" && Date.now() - new Date(j.created_at).getTime() > 2 * 60_000)
  );
  const pct = quota && quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 0;

  return (
    <div className="stack">
      <PageHeader
        title="Good day, registry"
        kicker="Overview"
        actions={<EnvSwitcher />}
      />

      {stuck.length > 0 && (
        <div className="alert alert-rust">
          <strong style={{ whiteSpace: "nowrap" }}>{stuck.length} job{stuck.length > 1 ? "s" : ""} need attention.</strong>
          <span>
            {stuck.length === 1
              ? `Job ${shortId(stuck[0].job_id)} is ${stuck[0].status.replace(/_/g, " ")}.`
              : `Open the jobs ledger to review failed or stalled stamping work.`}{" "}
            <Link to="/jobs">Open jobs →</Link>
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="label">Daily quota remaining</div>
          <div className="display h1" style={{ marginTop: 8, color: "var(--seal-brass)" }}>
            {quota ? fmtNumber(quota.remaining) : loading ? "…" : "—"}
          </div>
          <div className="small muted">
            {quota ? `${fmtNumber(quota.used)} of ${fmtNumber(quota.limit)} used today` : "No quota info"}
          </div>
          {quota && (
            <div style={{ marginTop: 12, height: 6, background: "var(--paper-dim)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: "var(--seal-brass)", borderRadius: 999 }} />
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="label">Templates</div>
          <div className="display h1" style={{ marginTop: 8 }}>
            {templates !== null ? fmtNumber(templates) : loading ? "…" : "—"}
          </div>
          <div className="small muted">managed signature layouts</div>
          <Link to="/templates" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
            Open templates
          </Link>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="label">Today's stamps</div>
          <div className="display h1" style={{ marginTop: 8 }}>
            {quota ? fmtNumber(quota.used) : loading ? "…" : "—"}
          </div>
          <div className="small muted">{target} environment</div>
          <Link to="/stamp" className="btn btn-brass btn-sm" style={{ marginTop: 12 }}>
            Stamp a document
          </Link>
        </div>
      </div>

      <div className="stack" style={{ marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 className="display h2">Recent jobs</h2>
          <Link to="/jobs" className="small" style={{ fontWeight: 500 }}>View all →</Link>
        </div>
        {jobs.length === 0 ? (
          <EmptyState
            title="No documents stamped yet"
            body="Create a template, then stamp your first document. The registry will place the e-meterai seal, obtain a serial number, and archive the signed PDF."
            action={
              <button className="btn btn-primary" onClick={() => navigate("/stamp")}>
                Stamp your first document
              </button>
            }
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Invoice</th>
                  <th>Template</th>
                  <th>Serial</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/jobs/${j.job_id}`)}>
                    <td className="chip">{shortId(j.job_id)}</td>
                    <td>{j.invoice_number ?? "—"}</td>
                    <td className="small muted">{j.template_name ?? "—"}</td>
                    <td>{j.sn ? <span className="chip chip-brass">{j.sn}</span> : <span className="faint small">—</span>}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td className="small muted">{fmtTime(j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
