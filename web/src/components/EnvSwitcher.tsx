import { useEnv } from "../lib/env";
import type { Target } from "../lib/env";

export function EnvSwitcher() {
  const { target, setTarget } = useEnv();
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
        return (
          <button
            key={t}
            onClick={() => setTarget(t)}
            aria-pressed={active}
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
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
