import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiBlob, fileToBase64 } from "../lib/api";
import { useEnv } from "../lib/env";
import { PageHeader, StatusBadge } from "../components/Bits";
import { SealBadge } from "../components/SealBadge";
import { downloadBlob, fmtClock, shortId } from "../lib/format";
import type { AnchorInfo, TemplateSummary } from "../lib/types";

interface PreparedFile {
  file: File;
  b64: string;
}

interface StampResponse {
  job_id: string;
  status: string;
  serial_number: string | null;
  template_version: number | null;
  stamped_document_url: string | null;
  anchor_match: AnchorInfo | null;
  quota_remaining: number | null;
  job: unknown;
}

export function StampPage() {
  const { target } = useEnv();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [batch, setBatch] = useState(false);

  const [invoice, setInvoice] = useState("");
  const [identityType, setIdentityType] = useState("NPWP");
  const [identityNumber, setIdentityNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StampResponse | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[] | null>(null);

  useEffect(() => {
    api<{ templates: TemplateSummary[] }>("/templates")
      .then((r) => {
        setTemplates(r.templates ?? []);
        if (r.templates?.[0]) setTemplateId(r.templates[0].id);
      })
      .catch(() => setTemplates([]));
  }, []);

  const meta = useMemo(
    () => ({
      invoice_number: invoice.trim(),
      identity_type: identityType,
      identity_number: identityNumber.trim(),
      document_date: docDate,
      notes: notes.trim(),
    }),
    [invoice, identityType, identityNumber, docDate, notes]
  );

  async function onFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    setError(null);
    const prepared: PreparedFile[] = [];
    for (const f of Array.from(fl)) {
      try {
        prepared.push({ file: f, b64: await fileToBase64(f) });
      } catch {
        /* skip unreadable */
      }
    }
    setFiles((prev) => [...prev, ...prepared]);
  }

  async function stamp() {
    setBusy(true);
    setError(null);
    setResult(null);
    setQueuedIds(null);
    try {
      if (batch) {
        if (files.length === 0) throw new Error("Choose at least one PDF document");
        const res = await api<{ job_ids: string[] }>("/stamp", {
          method: "POST",
          body: {
            stamp_target: target,
            mode: "async",
            documents: files.map((f) => ({
              template_id: templateId,
              document_base64: f.b64,
              document_metadata: { ...meta, file_name: f.file.name },
            })),
          },
        });
        setQueuedIds(res.job_ids);
      } else {
        if (files.length === 0) throw new Error("Choose a PDF document");
        const res = await api<StampResponse>("/stamp", {
          method: "POST",
          body: {
            template_id: templateId,
            stamp_target: target,
            document_base64: files[0].b64,
            document_metadata: { ...meta, file_name: files[0].file.name },
          },
        });
        setResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stamping failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadSigned() {
    if (!result?.stamped_document_url) return;
    const blob = await apiBlob(result.stamped_document_url);
    downloadBlob(blob, `stamped-${result.job_id}.pdf`);
  }

  return (
    <div className="stack">
      <PageHeader title="Stamp a document" kicker={`Target: ${target} environment`} />

      {error && <div className="alert alert-rust">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)", gap: 18, alignItems: "start" }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="label" style={{ marginBottom: 12 }}>Document & metadata</div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="tpl">Template</label>
            {templates === null ? (
              <span className="small faint">Loading templates…</span>
            ) : templates.length === 0 ? (
              <div className="small muted">
                No templates yet. <Link to="/templates/new">Create one first</Link>.
              </div>
            ) : (
              <select id="tpl" className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="docs">PDF {batch ? "documents" : "document"}</label>
            <input id="docs" type="file" accept="application/pdf" multiple onChange={(e) => void onFiles(e.target.files)} />
            {files.length > 0 && (
              <div className="small mono" style={{ marginTop: 6, color: "var(--indigo)" }}>
                {files.map((f, i) => (
                  <div key={i}>
                    {f.file.name} ({Math.round(f.file.size / 1024)} KB)
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="inv">Invoice / reference number</label>
              <input id="inv" className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="INV-2026-0142" />
            </div>
            <div className="field">
              <label htmlFor="ddate">Document date</label>
              <input id="ddate" className="input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="itype">Identity type</label>
              <select id="itype" className="select" value={identityType} onChange={(e) => setIdentityType(e.target.value)}>
                <option>NPWP</option>
                <option>NIK</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="inum">Identity number</label>
              <input id="inum" className="input" value={identityNumber} onChange={(e) => setIdentityNumber(e.target.value)} placeholder="XX.XXX.XXX.X-XXX.XXX" />
            </div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={stamp} disabled={busy || files.length === 0 || templates?.length === 0}>
              {busy && <span className="loader" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />}
              {busy ? "Stamping…" : batch ? "Queue batch" : "Stamp document"}
            </button>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} />
              Batch (queue asynchronously)
            </label>
          </div>
        </div>

        <div className="stack">
          {result && (
            <div className="card" style={{ padding: 20, textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 12 }}>Stamp result</div>
              {result.status === "signed" && result.serial_number ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <SealBadge serial={result.serial_number} />
                  <div className="small muted" style={{ marginTop: 8 }}>
                    E-meterai serial issued and applied
                  </div>
                </div>
              ) : (
                <div className="stack" style={{ alignItems: "center" }}>
                  <StatusBadge status={result.status} />
                  <div className="small muted">Document {shortId(result.job_id)}</div>
                </div>
              )}
              {result.quota_remaining !== null && (
                <div className="small faint" style={{ marginTop: 10 }}>
                  Quota remaining: {result.quota_remaining}
                </div>
              )}
              {result.anchor_match && (
                <div className="small muted" style={{ marginTop: 4 }}>
                  Seal placed by <span className="chip chip-brass">{result.anchor_match.keyword ?? "default position"}</span> on page {result.anchor_match.page}
                </div>
              )}
              {result.status === "signed" && result.stamped_document_url && (
                <button className="btn btn-brass" style={{ marginTop: 16, width: "100%", justifyContent: "center" }} onClick={downloadSigned}>
                  Download stamped PDF
                </button>
              )}
              <Link to={`/jobs/${result.job_id}`} className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>
                Open job ledger entry
              </Link>
            </div>
          )}

          {queuedIds && (
            <div className="card" style={{ padding: 20 }}>
              <div className="label" style={{ marginBottom: 10 }}>Queued for stamping</div>
              <div className="alert alert-brass" style={{ marginBottom: 12 }}>
                {queuedIds.length} document{queuedIds.length > 1 ? "s" : ""} added to the stamping queue. Refresh the jobs ledger to follow progress.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {queuedIds.map((jid) => (
                  <Link key={jid} to={`/jobs/${jid}`} className="chip" style={{ alignSelf: "flex-start" }}>
                    {shortId(jid)} →
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div className="label" style={{ marginBottom: 8 }}>What happens</div>
            <ol className="small muted stack" style={{ listStylePosition: "inside" }}>
              <li>The document is anchored to the template layout and the seal box is drawn.</li>
              <li>A serial number is requested from the stamp authority ({target === "staging" ? "mock gateway" : "Peruri production"}).</li>
              <li>The e-meterai seal with QR code is applied and the PDF is signed.</li>
              <li>The signed original is archived; you can download it from the ledger.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
