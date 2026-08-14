import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiBlob, fileToBase64 } from "../lib/api";
import { PdfPreview } from "../components/PdfPreview";
import type { OverlayBox } from "../components/PdfPreview";
import { PageHeader } from "../components/Bits";

const CM_TO_PT = 28.3465;
const PT_TO_CM = 1 / CM_TO_PT;

interface Candidate {
  keyword: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnchorRow {
  keyword: string;
  dx_cm: number;
  dy_cm: number;
}

interface PreviewAnchor {
  matched: boolean;
  keyword: string | null;
  page: number;
  x: number;
  y: number;
  confidence: "high" | "low";
  used_default: boolean;
}

interface TemplateView {
  name: string;
  version: number;
  anchors: { keyword: string; dx_pt: number; dy_pt: number }[];
  box: { width_pt: number; height_pt: number };
  default_position: { x: number; y: number; page: number };
  sample_storage_key?: string | null;
  sample_url?: string | null;
  preview_anchor?: PreviewAnchor | null;
  candidates?: Candidate[];
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [name, setName] = useState("");
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [anchors, setAnchors] = useState<AnchorRow[]>([]);
  const [boxW, setBoxW] = useState(4.5);
  const [boxH, setBoxH] = useState(4.5);
  const [defX, setDefX] = useState(6);
  const [defY, setDefY] = useState(8);
  const [defPage, setDefPage] = useState(1);
  const [preview, setPreview] = useState<PreviewAnchor | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadExisting = useCallback(
    async (templateId: string) => {
      try {
        const t = await api<TemplateView>(`/templates/${templateId}`);
        setName(t.name);
        setAnchors(
          t.anchors.map((a) => ({
            keyword: a.keyword,
            dx_cm: Math.round(a.dx_pt * PT_TO_CM * 100) / 100,
            dy_cm: Math.round(a.dy_pt * PT_TO_CM * 100) / 100,
          }))
        );
        setBoxW(Math.round(t.box.width_pt * PT_TO_CM * 100) / 100);
        setBoxH(Math.round(t.box.height_pt * PT_TO_CM * 100) / 100);
        setDefX(Math.round(t.default_position.x * PT_TO_CM * 100) / 100);
        setDefY(Math.round(t.default_position.y * PT_TO_CM * 100) / 100);
        setDefPage(t.default_position.page);
        setPreview(t.preview_anchor ?? null);
        setCandidates(t.candidates ?? []);
        if (t.sample_url) {
          const blob = await apiBlob(t.sample_url);
          setDocBytes(new Uint8Array(await blob.arrayBuffer()));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load template");
      }
    },
    []
  );

  useEffect(() => {
    if (editing && id) void loadExisting(id);
  }, [editing, id, loadExisting]);

  async function handleUpload(f: File) {
    setUploading(true);
    setError(null);
    try {
      const b64 = await fileToBase64(f);
      const res = await api<{
        template_id: string;
        name: string;
        candidates: Candidate[];
        box_pt: { width_pt: number; height_pt: number };
        default_position_pt: { x: number; y: number; page: number };
      }>("/templates", {
        method: "POST",
        body: { name: name.trim() || f.name.replace(/\.[^.]+$/, ""), document_base64: b64, filename: f.name },
      });
      setCandidates(res.candidates ?? []);
      setBoxW(Math.round(res.box_pt.width_pt * PT_TO_CM * 100) / 100);
      setBoxH(Math.round(res.box_pt.height_pt * PT_TO_CM * 100) / 100);
      setDefX(Math.round(res.default_position_pt.x * PT_TO_CM * 100) / 100);
      setDefY(Math.round(res.default_position_pt.y * PT_TO_CM * 100) / 100);
      setDefPage(res.default_position_pt.page);
      const buf = await f.arrayBuffer();
      setDocBytes(new Uint8Array(buf));
      navigate(`/templates/${res.template_id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    if (!id) {
      setError("Template not created yet — please upload a sample PDF first.");
      setBusy(false);
      return;
    }
    try {
      const res = await api<TemplateView>(`/templates/${id}`, {
        method: "PUT",
        body: {
          name: name.trim(),
          anchors: anchors.map((a) => ({ keyword: a.keyword, dx_cm: a.dx_cm, dy_cm: a.dy_cm })),
          box: { width_cm: boxW, height_cm: boxH },
          default_position: { x_cm: defX, y_cm: defY, page: defPage },
        },
      });
      setPreview(res.preview_anchor ?? null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const boxPt = useMemo(
    () => ({ width_pt: boxW * CM_TO_PT, height_pt: boxH * CM_TO_PT }),
    [boxW, boxH]
  );

  const overlay = useMemo<OverlayBox[]>(() => {
    // Live local preview: matches the worker's resolveAnchor logic exactly, so
    // the box moves as the user edits keyword offsets, box size or default
    // position — no save round-trip needed.
    const boxes: OverlayBox[] = [];
    for (const a of anchors) {
      const kw = normalizeText(a.keyword);
      if (!kw) continue;
      for (const cand of candidates) {
        if (normalizeText(cand.keyword).includes(kw)) {
          boxes.push({
            page: cand.page,
            x: cand.x + cand.width + a.dx_cm * CM_TO_PT,
            y: cand.y - a.dy_cm * CM_TO_PT,
            w: boxPt.width_pt,
            h: boxPt.height_pt,
            label: a.keyword,
            matched: true,
          });
          break;
        }
      }
    }
    if (boxes.length > 0) return boxes;
    // No candidates available client-side (e.g. sample read failed) — fall
    // back to the last server-resolved preview if there is one.
    if (preview) {
      return [
        {
          page: preview.page,
          x: preview.x,
          y: preview.y,
          w: boxPt.width_pt,
          h: boxPt.height_pt,
          label: preview.matched ? preview.keyword ?? "anchor" : "default position",
          matched: preview.matched,
        },
      ];
    }
    return [
      {
        page: defPage,
        x: defX * CM_TO_PT,
        y: defY * CM_TO_PT,
        w: boxPt.width_pt,
        h: boxPt.height_pt,
        label: "default position",
        matched: false,
      },
    ];
  }, [preview, anchors, candidates, boxPt, defX, defY, defPage]);

  function addAnchorFromCandidate(c: Candidate) {
    setAnchors((prev) => {
      const exists = prev.find((a) => a.keyword.toLowerCase() === c.keyword.toLowerCase());
      if (exists) return prev;
      return [...prev, { keyword: c.keyword, dx_cm: 0, dy_cm: 0 }];
    });
  }

  const ptHint = (v: number) => `${Math.round(v * CM_TO_PT)} pt`;

  return (
    <div className="stack">
      <PageHeader
        title={editing ? name || "Template" : "New template"}
        kicker={editing ? "Template editor" : "Create template"}
        actions={
          <button className="btn btn-primary" onClick={save} disabled={busy || !docBytes || anchors.length === 0}>
            {busy && <span className="loader" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />}
            {busy ? "Saving…" : savedFlash ? "Saved" : "Save template"}
          </button>
        }
      />

      {error && <div className="alert alert-rust">{error}</div>}
      {savedFlash && <div className="alert alert-green">Template saved. The seal box is drawn in the preview.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(300px, 1fr)", gap: 18, alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Document preview</div>
          {!docBytes ? (
            <label
              style={{
                display: "grid",
                placeItems: "center",
                height: 260,
                border: "2px dashed var(--rule)",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <div>
                <div className="display h3">Upload a sample PDF</div>
                <div className="small faint" style={{ marginTop: 6 }}>
                  {uploading ? "Analyzing…" : "The registry reads printed text lines to propose anchor points."}
                </div>
              </div>
              <input
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
              />
            </label>
          ) : (
            <PdfPreview bytes={docBytes} boxes={overlay} />
          )}
        </div>

        <div className="stack">
          <div className="card" style={{ padding: 16 }}>
            <div className="label" style={{ marginBottom: 10 }}>Template</div>
            <div className="field">
              <label htmlFor="tname">Name</label>
              <input id="tname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice, Receipt, Contract…" />
            </div>
            {editing && (
              <div className="small muted" style={{ marginTop: 8 }}>
                Sample document remains the one uploaded at creation.
              </div>
            )}
            {!editing && !docBytes && (
              <label
                className="btn btn-ghost"
                style={{ marginTop: 12, display: "inline-flex", cursor: "pointer" }}
                htmlFor="file-input-2"
              >
                {uploading ? "Analyzing…" : "Choose sample PDF"}
                <input id="file-input-2" type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />
              </label>
            )}
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="label" style={{ marginBottom: 10 }}>Anchor keywords</div>
            <div className="stack">
              {anchors.length === 0 && (
                <div className="small muted">
                  No keywords yet. Pick lines from the text extraction below, or add one manually. The first matching line wins; the seal box sits to the right of the line, offset by dx/dy.
                </div>
              )}
              {anchors.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center" }}>
                  <input
                    className="input"
                    value={a.keyword}
                    placeholder="Keyword"
                    onChange={(e) =>
                      setAnchors((prev) => prev.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))
                    }
                  />
                  <div className="small faint" style={{ whiteSpace: "nowrap" }}>dx</div>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={a.dx_cm}
                    style={{ width: 76 }}
                    title="Horizontal offset, cm"
                    onChange={(e) =>
                      setAnchors((prev) => prev.map((x, j) => (j === i ? { ...x, dx_cm: Number(e.target.value) } : x)))
                    }
                  />
                  <div className="small faint" style={{ whiteSpace: "nowrap" }}>dy</div>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={a.dy_cm}
                    style={{ width: 76 }}
                    title="Vertical offset, cm (positive moves the seal down)"
                    onChange={(e) =>
                      setAnchors((prev) => prev.map((x, j) => (j === i ? { ...x, dy_cm: Number(e.target.value) } : x)))
                    }
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAnchors((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setAnchors((prev) => [...prev, { keyword: "", dx_cm: 0, dy_cm: 0 }])}
              >
                + Add keyword
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="label" style={{ marginBottom: 10 }}>Seal box & default position</div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="bw">Width (cm)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="bw" className="input" type="number" step="0.1" min="1" value={boxW} onChange={(e) => setBoxW(Number(e.target.value))} />
                  <span className="small faint mono">{ptHint(boxW)}</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="bh">Height (cm)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="bh" className="input" type="number" step="0.1" min="1" value={boxH} onChange={(e) => setBoxH(Number(e.target.value))} />
                  <span className="small faint mono">{ptHint(boxH)}</span>
                </div>
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="dpx">Default X from left (cm)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="dpx" className="input" type="number" step="0.1" value={defX} onChange={(e) => setDefX(Number(e.target.value))} />
                  <span className="small faint mono">{ptHint(defX)}</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="dpy">Default Y from top (cm)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="dpy" className="input" type="number" step="0.1" value={defY} onChange={(e) => setDefY(Number(e.target.value))} />
                  <span className="small faint mono">{ptHint(defY)}</span>
                </div>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="dpg">Default page</label>
              <input id="dpg" className="input" type="number" step="1" min="1" value={defPage} onChange={(e) => setDefPage(Math.max(1, Number(e.target.value)))} />
            </div>
            <div className="small faint" style={{ marginTop: 10 }}>
              Used when no keyword is found in the stamped document.
            </div>
          </div>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Detected text lines — click to add as anchor keyword</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflow: "auto" }}>
            {candidates.slice(0, 200).map((c, i) => (
              <button
                key={i}
                className="chip"
                style={{ cursor: "pointer", fontSize: 11.5 }}
                title={`Page ${c.page} · x ${c.x} · y ${c.y}`}
                onClick={() => addAnchorFromCandidate(c)}
              >
                {c.keyword.length > 48 ? `${c.keyword.slice(0, 48)}…` : c.keyword}
                <span className="faint" style={{ marginLeft: 6 }}>p{c.page}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
