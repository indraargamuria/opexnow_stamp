import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { SealMark } from "../components/CenterSplash";
import { cn } from "../lib/utils";
import { components } from "../lib/styles";
import { animations } from "../lib/styles";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get demo credentials from environment variable
  const demoEmail = import.meta.env.VITE_DEMO_EMAIL ?? "admin@demo.local";
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD ?? "demo";

  async function submit(e: FormEvent) {
    e.preventDefault();

    // Form validation
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
      setBusy(false);
    }
  }

  function fillDemoCredentials() {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError(null);
  }

  return (
    <div
      className={cn(
        "min-h-screen flex items-center justify-center p-4",
        "bg-background radial-gradient background-pattern"
      )}
      style={{
        backgroundImage: "radial-gradient(rgba(28, 37, 65, 0.035) 1px, transparent 1.4px)",
        backgroundSize: "16px 16px",
      }}
    >
      <div
        className={cn(
          "w-full max-w-md",
          animations["fade-in"],
          components.card,
          "p-8 space-y-6"
        )}
      >
        {/* Logo and Header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-brand-brass">
            <SealMark size={36} />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">
              OpexNow Stamp
            </h1>
            <p className="text-sm text-muted-foreground">E-meterai registry desk</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          Sign in with your registry console credentials to manage templates,
          stamp documents, and review the day's work.
        </p>

        {/* Error Alert */}
        {error && (
          <div
            className={cn(
              "flex items-center gap-2 p-4 rounded-md text-sm",
              statuses.error
            )}
            role="alert"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 01-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={submit} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Email
            </label>
            <input
              id="email"
              className={cn(
                components.input,
                "h-10"
              )}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@your-tenant.local"
              disabled={busy}
            />
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Password
            </label>
            <input
              id="password"
              className={cn(
                components.input,
                "h-10"
              )}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="•••••••••"
              disabled={busy}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className={cn(
              components.button.base,
              components.button.variants.default,
              "w-full h-10",
              busy && "opacity-50 cursor-not-allowed"
            )}
            disabled={busy}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-0V0a5 5 0 00-5 5h14a5 5 0 005-5v0a8 8 0 01-8 0z"
                  />
                </svg>
                Signing in…
              </span>
            ) : (
              "Sign in to registry"
            )}
          </button>
        </form>

        {/* Demo Credentials */}
        <div className="pt-4 text-center">
          <p className="text-xs text-muted-foreground">
            Demo tenant: <span className="font-mono text-brand-brass">{demoEmail}</span>
            <button
              type="button"
              onClick={fillDemoCredentials}
              className="text-accent hover:underline ml-1"
              disabled={busy}
            >
              (Auto-fill)
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
