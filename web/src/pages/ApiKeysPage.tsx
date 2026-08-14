import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, EmptyState } from "../components/Bits";
import { fmtTime, shortId } from "../lib/format";

interface KeyInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreateRes {
  id: string;
  name: string;
  api_key: string;
  api_secret: string;
  warning: string;
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<CreateRes | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ keys: KeyInfo[] }>("/tenants/me/keys");
      setKeys(res.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await api<CreateRes>("/tenants/me/keys", { method: "POST", body: { name: name.trim() || "Default key" } });
      setRevealed(res);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this API key? Any service using it will stop working immediately.")) return;
    try {
      await api(`/tenants/me/keys/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="stack">
      <PageHeader
        title="API keys"
        kicker="Server-to-server access"
        actions={
          <button className="btn btn-primary" onClick={create} disabled={creating}>
            {creating ? "Creating…" : "Create API key"}
          </button>
        }
      />

      {error && <div className="alert alert-rust">{error}</div>}

      <div className="card" style={{ padding: 18 }}>
        <div className="label" style={{ marginBottom: 8 }}>Create a key</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 240px" }}
            placeholder="Key name (e.g. invoicing-svc)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <button className="btn btn-ghost" onClick={create} disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        <p className="small faint" style={{ marginTop: 8 }}>
          Use the API key and secret with HMAC-SHA256 signatures against <code>/stamp</code> and <code>/templates</code>.
        </p>
      </div>

      {revealed && (
        <div className="card" style={{ padding: 18, borderColor: "var(--seal-brass)" }}>
          <div className="alert alert-brass" style={{ marginBottom: 12 }}>
            <strong>Copy this secret now.</strong> It is shown only once — the registry stores only a hash.
          </div>
          {[
            { what: "key", label: "API key", val: revealed.api_key },
            { what: "secret", label: "API secret", val: revealed.api_secret },
          ].map((r) => (
            <div key={r.what} style={{ marginBottom: 10 }}>
              <div className="label" style={{ marginBottom: 4 }}>{r.label}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ flex: 1, background: "var(--paper-dim)", padding: "8px 10px", borderRadius: 4, fontSize: 12.5, wordBreak: "break-all" }}>
                  {r.val}
                </code>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(r.val, r.what)}>
                  {copied === r.what ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setRevealed(null)} style={{ marginTop: 4 }}>
            Close
          </button>
        </div>
      )}

      {keys === null ? (
        <div className="center-splash" style={{ minHeight: 200 }}><span className="loader" /></div>
      ) : keys.length === 0 ? (
        <EmptyState title="No API keys yet" body="Create a key to authenticate machine-to-machine stamping requests." />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="chip">{shortId(k.id)}</td>
                  <td style={{ fontWeight: 500 }}>{k.name}</td>
                  <td className="small muted">{fmtTime(k.created_at)}</td>
                  <td className="small muted">{k.last_used_at ? fmtTime(k.last_used_at) : "never"}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => void remove(k.id)}>Delete</button>
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
