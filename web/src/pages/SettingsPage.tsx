import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Bits";
import { fmtClock, fmtNumber } from "../lib/format";

interface QuotaRes {
  staging: { limit: number; used: number; remaining: number; reset_at: string | null; allowed: boolean };
  production: { enabled: boolean; identity: { nama_dipungut?: string; no_identitas?: string } | null };
}

export function SettingsPage() {
  const [quota, setQuota] = useState<QuotaRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  // production form
  const [showForm, setShowForm] = useState(false);
  const [nama, setNama] = useState("");
  const [noId, setNoId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [validating, setValidating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      setQuota(await api<QuotaRes>("/tenants/me/quota"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProduction() {
    setValidating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ status: string; production_enabled: boolean }>("/tenants/me/settings", {
        method: "PUT",
        body: {
          peruri_identity: { nama_dipungut: nama.trim(), no_identitas: noId.trim() },
          peruri_username: username,
          peruri_password: password,
        },
      });
      if (res.production_enabled) {
        setShowForm(false);
        setPassword("");
        setNotice("Production stamping enabled. Credentials validated against Peruri.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Production setup failed");
    } finally {
      setValidating(false);
    }
  }

  async function clearProduction() {
    if (!window.confirm("Disable production stamping and remove stored credentials?")) return;
    try {
      await api("/tenants/me/settings", { method: "PUT", body: { clear: true } });
      setShowForm(false);
      setNotice("Production stamping disabled. Credentials removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable production");
    }
  }

  const staging = quota?.staging;
  const prod = quota?.production;

  return (
    <div className="stack">
      <PageHeader title="Settings" kicker="Environments & credentials" />
      {error && <div className="alert alert-rust">{error}</div>}
      {notice && <div className="alert alert-green">{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="display h2">Staging environment</h2>
            <span className="chip">staging</span>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Shared mock gateway for integration testing. No real e-meterai serials are consumed; quota is simulated per day.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
            <div>
              <div className="label">Daily limit</div>
              <div className="display h3" style={{ marginTop: 4 }}>{staging ? fmtNumber(staging.limit) : "…"}</div>
            </div>
            <div>
              <div className="label">Used today</div>
              <div className="display h3" style={{ marginTop: 4 }}>{staging ? fmtNumber(staging.used) : "…"}</div>
            </div>
            <div>
              <div className="label">Remaining</div>
              <div className="display h3" style={{ marginTop: 4, color: "var(--seal-brass)" }}>
                {staging ? fmtNumber(staging.remaining) : "…"}
              </div>
            </div>
            <div>
              <div className="label">Resets</div>
              <div className="small" style={{ marginTop: 6 }}>{staging?.reset_at ? fmtClock(staging.reset_at) : "—"}</div>
            </div>
          </div>
          <div className="small faint" style={{ marginTop: 14 }}>
            {staging?.allowed
              ? "Stamp requests to staging are permitted."
              : "Staging quota exhausted for today — resets at the time above."}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="display h2">Production environment</h2>
            <span className="chip chip-brass">production</span>
          </div>

          {prod?.enabled ? (
            <div style={{ marginTop: 12 }}>
              <div className="alert alert-green" style={{ marginBottom: 12 }}>
                Production stamping is enabled and credentials are validated.
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                <div><span className="faint">Collecting party: </span>{prod.identity?.nama_dipungut ?? "—"}</div>
                <div style={{ marginTop: 2 }}><span className="faint">NPWP: </span>{prod.identity?.no_identitas ?? "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(true); setNotice(null); }}>
                  Edit credentials
                </button>
                <button className="btn btn-danger btn-sm" onClick={clearProduction}>Disable production</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p className="small muted">
                Production stamping issues real e-meterai serial numbers. Configure your Peruri
                credentials to enable it. Credentials are encrypted before storage.
              </p>
              {!showForm && (
                <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowForm(true)}>
                  Set up production
                </button>
              )}
            </div>
          )}

          {showForm && (
            <div className="stack" style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="s-nama">Collecting party name (nama dipungut)</label>
                <input id="s-nama" className="input" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="PT Contoh Karya Bersama" />
              </div>
              <div className="field">
                <label htmlFor="s-noid">Collecting party NPWP</label>
                <input id="s-noid" className="input" value={noId} onChange={(e) => setNoId(e.target.value)} placeholder="00.000.000.0-000.000" />
              </div>
              <div className="field">
                <label htmlFor="s-user">Peruri username</label>
                <input id="s-user" className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="s-pass">Peruri password</label>
                <input id="s-pass" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={saveProduction} disabled={validating || !nama || !noId || !username || !password}>
                  {validating && <span className="loader" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />}
                  {validating ? "Validating with Peruri…" : "Validate & enable"}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowForm(false); setNotice(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
