import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useEnv } from "../lib/env";
import { PageHeader, StatusBadge, EmptyState } from "../components/Bits";
import { fmtTime, shortId } from "../lib/format";
import type { JobSummary } from "../lib/types";

type SortKey = "created_at" | "status" | "invoice_number";

export function JobsPage() {
  const navigate = useNavigate();
  const { target } = useEnv();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: "100" });
      if (status) q.set("status", status);
      const res = await api<{ jobs: JobSummary[]; total: number }>(`/jobs?${q}`);
      setJobs(res.jobs ?? []);
      setTotal(res.total ?? 0);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const sorted = useMemo(() => {
    if (!jobs) return jobs;
    const arr = [...jobs];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [jobs, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "created_at" ? "desc" : "asc");
    }
  }

  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  const counts = useMemo(() => {
    if (!jobs) return { total, failed: 0, pending: 0, signed: 0 };
    return {
      total,
      failed: jobs.filter((j) => j.status === "failed" || j.status === "rejected").length,
      pending: jobs.filter((j) => j.status !== "signed" && j.status !== "failed" && j.status !== "rejected").length,
      signed: jobs.filter((j) => j.status === "signed").length,
    };
  }, [jobs, total]);

  return (
    <div className="stack">
      <PageHeader title="Jobs ledger" kicker="Stamping history" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { v: "", label: `All (${counts.total})` },
          { v: "pending_anchor", label: `In progress (${counts.pending})` },
          { v: "signed", label: `Signed (${counts.signed})` },
          { v: "failed", label: `Failed (${counts.failed})` },
        ].map((f) => (
          <button
            key={f.v}
            className="btn btn-ghost btn-sm"
            style={status === f.v ? { borderColor: "var(--ink-navy)", background: "var(--ink-navy)", color: "#fff" } : undefined}
            onClick={() => setStatus(f.v)}
          >
            {f.label}
          </button>
        ))}
        <span className="small faint" style={{ alignSelf: "center", marginLeft: "auto" }}>
          {loading ? "loading…" : ""}
        </span>
      </div>

      {sorted && sorted.length === 0 ? (
        <EmptyState
          title="No jobs here"
          body="The ledger is empty for this filter. Stamping happens from the Stamp page, or over the API."
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort("created_at")}>When{arrow("created_at")}</th>
                <th>Job</th>
                <th className="sortable" onClick={() => toggleSort("invoice_number")}>Invoice{arrow("invoice_number")}</th>
                <th>Template</th>
                <th>Env</th>
                <th>Serial</th>
                <th className="sortable" onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted?.map((j) => (
                <tr key={j.job_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/jobs/${j.job_id}`)}>
                  <td className="small muted">{fmtTime(j.created_at)}</td>
                  <td className="chip">{shortId(j.job_id)}</td>
                  <td>{j.invoice_number ?? <span className="faint">—</span>}</td>
                  <td className="small muted">{j.template_name ?? "—"}</td>
                  <td>
                    <span className={`chip${j.stamp_target === "production" ? " chip-brass" : ""}`}>{j.stamp_target}</span>
                  </td>
                  <td>{j.serial_number ? <span className="chip chip-brass">{j.serial_number}</span> : <span className="faint small">—</span>}</td>
                  <td><StatusBadge status={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
