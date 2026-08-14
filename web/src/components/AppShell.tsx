import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EnvSwitcher } from "./EnvSwitcher";
import { SealMark } from "./CenterSplash";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/templates", label: "Templates", end: false },
  { to: "/stamp", label: "Stamp document", end: false },
  { to: "/jobs", label: "Jobs", end: false },
  { to: "/settings", label: "Settings", end: false },
  { to: "/keys", label: "API keys", end: false },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 224,
          flex: "none",
          background: "var(--ink-navy)",
          color: "#e8eaf0",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.09)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--seal-brass-soft)" }}>
              <SealMark size={26} />
            </span>
            <div>
              <div className="display" style={{ fontSize: 16, lineHeight: 1.1 }}>
                OpexNow Stamp
              </div>
              <div className="label" style={{ color: "rgba(232,234,240,0.55)", fontSize: 9 }}>
                E-meterai registry
              </div>
            </div>
          </div>
        </div>

        <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                display: "block",
                padding: "9px 12px",
                borderRadius: 5,
                color: isActive ? "#fff" : "rgba(232,234,240,0.72)",
                background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                borderLeft: isActive ? "3px solid var(--seal-brass)" : "3px solid transparent",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.09)", fontSize: 12.5 }}>
          <div style={{ color: "rgba(232,234,240,0.9)", fontWeight: 500 }}>{user?.name}</div>
          <div className="mono" style={{ color: "rgba(232,234,240,0.5)", fontSize: 11, marginTop: 1 }}>
            {user?.tenant_name}
          </div>
          <button
            onClick={logout}
            style={{
              marginTop: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#e8eaf0",
              borderRadius: 5,
              padding: "6px 10px",
              fontSize: 12.5,
              width: "100%",
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(6px)",
            borderBottom: "1px solid var(--rule)",
            padding: "12px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div className="label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Registry workspace</span>
            <span style={{ color: "var(--rule)" }}>/</span>
            <span style={{ color: "var(--ink-navy)" }}>{location.pathname === "/" ? "Overview" : NAV.find((n) => n.to !== "/" && location.pathname.startsWith(n.to))?.label}</span>
          </div>
          <EnvSwitcher />
        </header>

        <main style={{ padding: "28px", maxWidth: 1080, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
