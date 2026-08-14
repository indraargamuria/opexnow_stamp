import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Target = "staging" | "production";

const KEY = "opex_target";

interface EnvCtx {
  target: Target;
  setTarget: (t: Target) => void;
}

const Ctx = createContext<EnvCtx | null>(null);

export function EnvProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<Target>(() => {
    const v = localStorage.getItem(KEY);
    return v === "production" ? "production" : "staging";
  });

  useEffect(() => {
    localStorage.setItem(KEY, target);
  }, [target]);

  const value = useMemo(() => ({ target, setTarget: setTargetState }), [target]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEnv(): EnvCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEnv outside EnvProvider");
  return v;
}
