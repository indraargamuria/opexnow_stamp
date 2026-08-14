import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiBlob } from "../lib/api";
import { PageHeader, StatusBadge } from "../components/Bits";
import { SealBadge } from "../components/SealBadge";
import { downloadBlob, fmtClock, shortId } from "../lib/format";
import { JOB_STEPS, TERMINAL_STATES, jobStepIndex } from "../lib/types";
import type { JobDetail } from "../lib/types";

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [urls, setUrls] = useState<{ stamped?: string | null; unsigned?: string | null }>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    async function load() {
      if (!id) return;
      try {
        const res = await api<JobDetail>(`/jobs/${id}`);
        if (!alive) return;
        setJob(res);
        setUrls({ stamped: res.stamped_document_url, unsigned: res.unsigned_download_url });
        if (!TERMINAL_STATES.has(res.status)) {
          timer = window.setTimeout(load, 2200);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not load job");
      }
    }
    void load();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [id]);

  async function download(url: string, name: string) {
    const blob = await apiBlob(url);
    downloadBlob(blob, name);
  }

  if (error) return <div className="alert alert-rust">{error}</div>;
  if (!job) return <div className="center-splash" style={{ minHeight: 300 }}><span className="loader" /></div>;

  const idx = jobStepIndex(job.status);
  const stepIdx = job.status === "signed" ? JOB_STEPS.length - 1 : idx;
  const meta = (job.document_metadata ?? {}) as Record<string, string>;

  return (
    <div className="stack">
      <PageHeader
        title="Job entry"
        kicker="Ledger detail"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            {urls.stamped && (
              <button className="btn btn-brass" onClick={() => void download(urls.stamped!, `stamped-${job.job_id}.pdf`)}>
                Download signed PDF
              </button>
            )}
            {urls.unsigned && (
              <button className="btn btn-ghost" onClick={() => void download(urls.unsigned!, `original-${job.job_id}.pdf`)}>
                Original PDF
              </button>
            )}
            <Link to="/jobs" className="btn btn-ghost">Back to ledger</Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(300px, 0.9fr)", gap: 18, alignItems: "start" }}>
        <div className="stack">
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <StatusBadge status={job.status} />
              <span className="chip">{shortId(job.job_id)}</span>
              <span className={`chip${job.stamp_target === "production" ? " chip-brass" : ""}`}>{job.stamp_target}</span>
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="label" style={{ marginBottom: 10 }}>Stamping progress</div>
              <div style={{ display: "flex", gap: 0 }}>
                {JOB_STEPS.map((s, i) => {
                  const done = i <= stepIdx;
                  const current = i === stepIdx && !TERMINAL_STATES.has(job.status);
                  return (
                    <div key={s} style={{ flex: 1, display: "flex", alignItems: "center" }}>
                      <div style={{ textAlign: "center", flex: 1 }}>
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            margin: "0 auto",
                            borderRadius: "50%",
                            border: "2px solid",
                            borderColor: done ? "var(--seal-brass)" : "var(--rule)",
                            background: done ? "var(--seal-brass)" : "transparent",
                            position: "relative",
                          }}
                        >
                          {current && <span className="dot pulse" style={{ position: "absolute", inset: 2, borderRadius: "50%", background: "var(--seal-brass-soft)" }} />}
                        </div>
                        <div className="small faint" style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.2, padding: "0 2px" }}>
                          {s.replace(/_/g, " ")}
                        </div>
                      </div>
                      {i < JOB_STEPS.length - 1 && (
                        <div style={{ height: 2, flex: 1, background: done ? "var(--seal-brass)" : "var(--rule)", margin: "0 -1px", marginBottom: 22 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {job.status === "signed" && job.sn && (
              <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
                <SealBadge serial={job.sn} />
              </div>
            )}

            {job.error && (
              <div className="alert alert-rust" style={{ marginTop: 16 }}>
                <strong>Error:</strong>
                <span>{typeof job.error === "string" ? job.error : job.error.message}</span>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="label" style={{ marginBottom: 10 }}>Document metadata</div>
            <table className="tbl" style={{ fontSize: 13 }}>
              <tbody>
                {[
                  ["Invoice / reference", meta.invoice_number],
                  ["File name", meta.file_name],
                  ["Identity", meta.identity_type ? `${meta.identity_type} ${meta.identity_number ?? ""}` : null],
                  ["Document date", meta.document_date],
                  ["Notes", meta.notes],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <tr key={k as string}>
                      <td className="faint" style={{ width: 180 }}>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card" style={{ padding: 18 }}>
            <div className="label" style={{ marginBottom: 10 }}>Ledger fields</div>
            <table className="tbl" style={{ fontSize: 13 }}>
              <tbody>
                <tr>
                  <td className="faint">Job ID</td>
                  <td className="mono">{job.job_id}</td>
                </tr>
                <tr>
                  <td className="faint">Status</td>
                  <td>{job.status}</td>
                </tr>
                <tr>
                  <td className="faint">Serial number</td>
                  <td>{job.sn ? <span className="chip chip-brass">{job.sn}</span> : "—"}</td>
                </tr>
                <tr>
                  <td className="faint">Template</td>
                  <td>{job.template_name ?? "—"}</td>
                </tr>
                <tr>
                  <td className="faint">Anchor</td>
                  <td>
                    {job.anchor ? (
                      <span>
                        {job.anchor.keyword ?? "default"} · page {job.anchor.page} · confidence {job.anchor.confidence}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="faint">Created</td>
                  <td>{fmtClock(job.created_at)}</td>
                </tr>
                <tr>
                  <td className="faint">Updated</td>
                  <td>{fmtClock(job.updated_at)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
