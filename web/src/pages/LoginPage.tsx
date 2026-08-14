import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { SealMark } from "../components/CenterSplash";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fix: Get demo credentials from environment variable
  const demoEmail = import.meta.env.VITE_DEMO_EMAIL ?? "admin@demo.local";
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD ?? "demo";

  async function submit(e: FormEvent) {
    e.preventDefault();

    // Fix: Add form validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address");
      return;
    }
    if (!password) {
      setError("Please enter your password");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await login(trimmedEmail, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
      setBusy(false); // Fix: Keep error state visible
    }
  }

  // Fix: Add quick-fill demo credentials function
  function fillDemoCredentials() {
    setEmail(demoEmail);
    setPassword(demoPassword);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--paper)",
        backgroundImage: "radial-gradient(rgba(28,37,65,0.035) 1px, transparent 1.4px)",
        backgroundSize: "16px 16px",
      }}
    >
      <div className="card" style={{ width: 380, maxWidth: "100%", padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--seal-brass)" }}>
            <SealMark size={34} />
          </span>
          <div>
            <div className="display h2">OpexNow Stamp</div>
            <div className="label" style={{ marginTop: 2 }}>E-meterai registry desk</div>
          </div>
        </div>
        <p className="small muted" style={{ margin: "14px 0 22px" }}>
          Sign in with your registry console credentials to manage templates, stamp documents, and review the day's work.
        </p>

        {error && <div className="alert alert-rust" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={submit} className="stack">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@your-tenant.local"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 6, justifyContent: "center" }}>
            {busy && <span className="loader" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />}
            {busy ? "Signing in…" : "Sign in to registry"}
          </button>
        </form>

        <div className="small faint" style={{ marginTop: 20, textAlign: "center" }}>
          Demo tenant: {demoEmail}{" "}
          <button
            type="button"
            onClick={fillDemoCredentials}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
              fontSize: "inherit",
              font: "inherit"
            }}
          >
            (Auto-fill)
          </button>
        </div>
      </div>
    </div>
  );
}
