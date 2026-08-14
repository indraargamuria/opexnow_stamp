import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setToken } from "../lib/api";
import type { ConsoleUser } from "../lib/types";

interface AuthCtx {
  user: ConsoleUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function toConsoleUser(
  u: { id: string; email: string; role: string },
  t: { id: string; name: string } | null
): ConsoleUser {
  return { id: u.id, name: u.email, email: u.email, role: u.role, tenant_id: t?.id ?? "", tenant_name: t?.name ?? "" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ConsoleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fix: Add user refresh function
  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api<{ user: { id: string; email: string; role: string }; tenant: { id: string; name: string } | null }>("/console/me");
      setUser(toConsoleUser(res.user, res.tenant));
      setError(null);
    } catch (err) {
      console.error("Failed to refresh user:", err);
      setError("Failed to authenticate");
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api<{ user: { id: string; email: string; role: string }; tenant: { id: string; name: string } | null }>("/console/me")
      .then((r) => setUser(toConsoleUser(r.user, r.tenant)))
      .catch((err) => {
        // Fix: Better error handling with logging
        console.error("Auth check failed:", err);
        setError("Session expired");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const res = await api<{
        token: string;
        user: { id: string; email: string; role: string };
        tenant: { id: string; name: string } | null;
      }>("/console/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      setToken(res.token);
      setUser(toConsoleUser(res.user, res.tenant));
      setError(null);

      // Fix: Handle post-login redirect using window.location
      setTimeout(() => {
        const redirectPath = sessionStorage.getItem("redirectAfterLogin");
        if (redirectPath) {
          sessionStorage.removeItem("redirectAfterLogin");
          window.location.href = redirectPath;
        }
      }, 100);
    } catch (err) {
      // Fix: Better error handling for login failures
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/console/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout failed:", err);
      /* ignore - continue with local cleanup */
    }
    setToken(null);
    setUser(null);
    setError(null);
    // Fix: Use window.location.href for complete page reload on logout
    window.location.href = "/login";
  }, []);

  const value = useMemo(() => ({ user, loading, error, login, logout, refreshUser }), [user, loading, error, login, logout, refreshUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
