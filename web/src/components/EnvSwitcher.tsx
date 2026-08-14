import { useState } from "react";
import { useEnv } from "../lib/env";
import type { Target } from "../lib/env";

export function EnvSwitcher() {
  const { target, setTarget } = useEnv();
  const [pendingTarget, setPendingTarget] = useState<Target | null>(null);

  // Fix: Add confirmation for production environment changes
  const handleTargetChange = (newTarget: Target) => {
    if (newTarget === target) return;

    if (newTarget === "production") {
      // Confirm before switching to production
      if (confirm("Switch to production environment? This will use real Peruri API credentials and consume production quota.")) {
        setTarget(newTarget);
      }
    } else {
      // No confirmation needed for staging
      setTarget(newTarget);
    }
  };

  return (
    <div
      role="group"
      aria-label="Stamp target environment"
      style={{
        display: "inline-flex",
        border: "1px solid var(--rule)",
        borderRadius: 999,
        background: "var(--paper-dim)",
        padding: 2,
      }}
    >
      {(["staging", "production"] as Target[]).map((t) => {
        const active = target === t;
        const isProduction = t === "production";

        return (
          <button
            key={t}
            onClick={() => handleTargetChange(t)}
            aria-pressed={active}
            title={isProduction ? "Production: Uses real Peruri API and consumes production quota" : "Staging: Test environment with mock Peruri"}
            style={{
              border: "none",
              background: active ? "var(--ink-navy)" : "transparent",
              color: active ? "#fff" : "var(--ink-grey)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "5px 12px",
              borderRadius: 999,
              transition: "background 120ms ease, color 120ms ease",
              cursor: "pointer",
              position: "relative",
            }}
          >
            {t}
            {/* Fix: Add visual indicator for production */}
            {isProduction && (
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: active ? "var(--accent)" : "rgba(255,165,0,0.5)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
