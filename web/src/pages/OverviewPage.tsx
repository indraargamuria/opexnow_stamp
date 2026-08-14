import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { JobSummary } from "../lib/types";
import { fmtNumber, fmtTime, shortId } from "../lib/format";
import { useEnv } from "../lib/env";
import { StatusBadge } from "../components/Bits";
import { EnvSwitcher } from "../components/EnvSwitcher";
import { cn } from "../lib/utils";
import { components, statuses } from "../lib/styles";
import { animations } from "../lib/styles";

// Loading skeleton component
function MetricCardSkeleton() {
  return (
    <div className={cn(components.card, "p-6 space-y-4")}>
      <div className="space-y-2">
        <div className="h-4 bg-muted w-20 animate-pulse rounded" />
        <div className="h-8 bg-muted w-16 animate-pulse rounded" />
      </div>
    </div>
  );
}

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
  const quotaPercentage = Math.min(100, Math.max(0, pct));

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Good day, registry
          </h1>
          <p className="text-sm text-muted-foreground">Overview of your e-meterai operations</p>
        </div>
        <EnvSwitcher />
      </div>

      {/* Stuck Jobs Alert */}
      {stuck.length > 0 && (
        <div className={cn("flex items-center gap-3 p-4 rounded-md text-sm", statuses.error)} role="alert">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 01-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <strong className="block font-medium">{stuck.length} job{stuck.length > 1 ? "s" : ""} need attention.</strong>
            <span className="block text-sm mt-1">
              {stuck.length === 1
                ? `Job ${shortId(stuck[0].job_id)} is ${stuck[0].status.replace(/_/g, " ")}.`
                : `Open the jobs ledger to review failed or stalled stamping work.`}{" "}
              <Link to="/jobs" className="font-medium underline">Open jobs →</Link>
            </span>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Quota Card */}
        {loading ? (
          <MetricCardSkeleton />
        ) : (
          <div className={cn(components.card, "p-6")}>
            <div className="flex items-center justify-between mb-2">
              <div className="label">Daily quota remaining</div>
              <svg className="w-5 h-5 text-brand-brass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012-2V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2m14 0a2 2 0 012-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v14a2 2 0 01-2 2h5a2 2 0 002-2v-4" />
              </svg>
            </div>
            <div className="font-display text-2xl font-semibold text-brand-brass mt-2">
              {quota ? fmtNumber(quota.remaining) : "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {quota ? `${fmtNumber(quota.used)} of ${fmtNumber(quota.limit)} used today` : "No quota info"}
            </div>
            {quota && (
              <div className="mt-4 space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{quotaPercentage}% used</span>
                  <span>{quota.reset_at ? `Resets ${new Date(quota.reset_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ""}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-brass transition-all duration-500"
                    style={{ width: `${quotaPercentage}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Templates Card */}
        {loading ? (
          <MetricCardSkeleton />
        ) : (
          <div className={cn(components.card, "p-6")}>
            <div className="flex items-center justify-between mb-2">
              <div className="label">Templates</div>
              <svg className="w-5 h-5 text-brand-brass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.5a2 2 0 012 2V5a2 2 0 01-2 2H9a2 2 0 00-2-2v-4" />
              </svg>
            </div>
            <div className="font-display text-2xl font-semibold text-foreground mt-2">
              {templates !== null ? fmtNumber(templates) : "—"}
            </div>
            <div className="text-sm text-muted-foreground">managed signature layouts</div>
            <Link
              to="/templates"
              className={cn(
                components.button.base,
                components.button.variants.ghost,
                "w-full mt-4 justify-start"
              )}
            >
              Open templates
            </Link>
          </div>
        )}

        {/* Today's Stamps Card */}
        {loading ? (
          <MetricCardSkeleton />
        ) : (
          <div className={cn(components.card, "p-6")}>
            <div className="flex items-center justify-between mb-2">
              <div className="label">Today's stamps</div>
              <svg className="w-5 h-5 text-brand-brass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="font-display text-2xl font-semibold text-brand-brass mt-2">
              {quota ? fmtNumber(quota.used) : "—"}
            </div>
            <div className="text-sm text-muted-foreground">{target} environment</div>
            <Link
              to="/stamp"
              className={cn(
                components.button.base,
                components.button.variants.secondary,
                "w-full mt-4 justify-start"
              )}
            >
              Stamp a document
            </Link>
          </div>
        )}
      </div>

      {/* Recent Jobs Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">Recent jobs</h2>
          <Link to="/jobs" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            View all →
          </Link>
        </div>

        {jobs.length === 0 ? (
          <div className={cn(components.card, "p-12 text-center")}>
            <svg
              className="w-12 h-12 mx-auto mb-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3 0v6m-3-6h.01M9 17h.01M15 10l-5 5m0 0l5-5M15 15v6" />
            </svg>
            <h3 className="font-display text-lg font-semibold text-foreground mb-2">No documents stamped yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Create a template, then stamp your first document. The registry will place the e-meterai seal, obtain a serial number, and archive the signed PDF.
            </p>
            <button
              onClick={() => navigate("/stamp")}
              className={cn(
                components.button.base,
                components.button.variants.default,
                "mx-auto"
              )}
            >
              Stamp your first document
            </button>
          </div>
        ) : (
          <div className={cn(
            components.card,
            "overflow-hidden p-0"
          )}>
            <div className="overflow-x-auto">
              <table className={cn(components.table, "w-full")}>
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
                  {jobs.map((j, index) => (
                    <tr
                      key={j.job_id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/jobs/${j.job_id}`)}
                    >
                      <td className="font-mono text-xs">{shortId(j.job_id)}</td>
                      <td>{j.invoice_number ?? "—"}</td>
                      <td className="text-sm text-muted-foreground">{j.template_name ?? "—"}</td>
                      <td>
                        {j.sn ? (
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono", "bg-brand-brass/10 text-brand-brass")}>
                            {j.sn}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td><StatusBadge status={j.status} /></td>
                      <td className="text-sm text-muted-foreground">{fmtTime(j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
