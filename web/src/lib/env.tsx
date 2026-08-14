import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";

export type Target = "staging" | "production";

const KEY = "opex_target";

interface EnvCtx {
  target: Target;
  setTarget: (t: Target) => void;
  isValidTarget: (t: string) => t is Target;
}

const Ctx = createContext<EnvCtx | null>(null);

// Fix: Safe localStorage operations with error handling
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn("localStorage read failed:", err);
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn("localStorage write failed:", err);
    return false;
  }
}

// Fix: Add validation function
function isValidTarget(t: string): t is Target {
  return t === "staging" || t === "production";
}

export function EnvProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<Target>(() => {
    // Fix: Use safe localStorage with fallback
    const v = safeGetItem(KEY);
    return isValidTarget(v) ? v : "staging";
  });

  // Fix: Add localStorage sync with error handling
  useEffect(() => {
    safeSetItem(KEY, target);
  }, [target]);

  // Fix: Add validation to setTarget
  const setTarget = useCallback((t: Target) => {
    if (isValidTarget(t)) {
      setTargetState(t);
    } else {
      console.warn(`Invalid target: ${t}. Must be 'staging' or 'production'.`);
    }
  }, []);

  const value = useMemo(() => ({ target, setTarget, isValidTarget }), [target, setTarget]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEnv(): EnvCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEnv outside EnvProvider");
  return v;
}
