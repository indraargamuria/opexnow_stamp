import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { TemplateSummary } from "../lib/types";
import { fmtTime, shortId } from "../lib/format";
import { PageHeader, EmptyState } from "../components/Bits";

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ templates: TemplateSummary[] }>("/templates");
      setTemplates(res.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const remove = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`Delete template "${name}"? Documents already stamped keep their archived signed copies.`)) return;
      try {
        await api(`/templates/${id}`, { method: "DELETE" });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    },
    []
  );

  return (
    <div className="stack">
      <PageHeader
        title="Templates"
        kicker="Layouts & anchor points"
        actions={
          <Link to="/templates/new" className="btn btn-primary">
            New template
          </Link>
        }
      />

      {error && <div className="alert alert-rust">{error}</div>}

      {templates === null ? (
        <div className="center-splash" style={{ minHeight: 240 }}><span className="loader" /></div>
      ) : templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="A template captures where the e-meterai seal should sit on your document type. Upload a sample PDF; the registry proposes anchor points from the printed text."
          action={
            <Link to="/templates/new" className="btn btn-primary">Create your first template</Link>
          }
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Anchor keywords</th>
                <th>Anchor match</th>
                <th>Stamps</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/templates/${t.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.name}</div>
                    <div className="small faint mono">{shortId(t.id)}</div>
                  </td>
                  <td className="mono">v{t.version}</td>
                  <td>
                    {t.anchors.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {t.anchors.map((a) => (
                          <span key={a.keyword} className="chip">{a.keyword}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="faint small">none — default position</span>
                    )}
                  </td>
                  <td>
                    {t.anchors.length > 0 ? (
                      <span className="chip chip-brass">keyword</span>
                    ) : (
                      <span className="faint small">—</span>
                    )}
                  </td>
                  <td>{t.job_count}</td>
                  <td className="small muted">{fmtTime(t.updated_at)}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(t.id, t.name);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
