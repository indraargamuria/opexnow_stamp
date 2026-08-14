import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setToken } from "../lib/api";
import type { ConsoleUser } from "../lib/types";

interface AuthCtx {
  user: ConsoleUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: { id: string; email: string; role: string }; tenant: { id: string; name: string } | null }>("/console/me")
      .then((r) => setUser(toConsoleUser(r.user, r.tenant)))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
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
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/console/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    location.href = "/login";
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
