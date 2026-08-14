import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { EnvSwitcher } from "./EnvSwitcher";
import { SealMark } from "./CenterSplash";
import { cn } from "../lib/utils";
import { components } from "../lib/styles";

interface NavItem {
  to: string;
  label: string;
  icon?: React.ReactNode;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Overview", end: true },
  { to: "/templates", label: "Templates" },
  { to: "/stamp", label: "Stamp document" },
  { to: "/jobs", label: "Jobs" },
  { to: "/settings", label: "Settings" },
  { to: "/keys", label: "API keys" },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
      setIsLoggingOut(false);
    }
  };

  const getPageLabel = (pathname: string) => {
    if (pathname === "/") return "Overview";
    if (pathname.startsWith("/templates")) return "Templates";
    if (pathname.startsWith("/stamp")) return "Stamp document";
    if (pathname.startsWith("/jobs")) return "Jobs";
    if (pathname.startsWith("/settings")) return "Settings";
    if (pathname.startsWith("/keys")) return "API keys";
    return "Overview";
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-sidebar border-r bg-card">
        {/* Logo Section */}
        <div className="flex items-center gap-3 p-6 border-b">
          <span className="text-brand-brass">
            <SealMark size={28} />
          </span>
          <div>
            <h1 className="font-display text-lg font-semibold text-foreground">
              OpexNow Stamp
            </h1>
            <p className="text-xs text-muted-foreground">E-meterai registry</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.to ||
              (item.to !== "/" && location.pathname.startsWith(item.to));

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User Section */}
        <div className="p-4 border-t space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{user?.tenant_name}</p>
          </div>
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={cn(
              components.button.base,
              components.button.variants.ghost,
              "w-full justify-start",
              isLoggingOut && "opacity-50 cursor-not-allowed"
            )}
          >
            {isLoggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <span className="text-brand-brass">
            <SealMark size={24} />
          </span>
          <span className="font-display text-base font-semibold">OpexNow Stamp</span>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-2">
          <EnvSwitcher />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-md hover:bg-accent"
            aria-label="Toggle menu"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-background">
          <div className="flex flex-col h-full p-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <span className="text-brand-brass">
                  <SealMark size={24} />
                </span>
                <span className="font-display text-base font-semibold">OpexNow Stamp</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-md hover:bg-accent"
                aria-label="Close menu"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-2">
              {NAV_ITEMS.map((item) => {
                const isActive = location.pathname === item.to ||
                  (item.to !== "/" && location.pathname.startsWith(item.to));

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>

            <div className="pt-4 border-t space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{user?.tenant_name}</p>
              </div>
              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                disabled={isLoggingOut}
                className={cn(
                  components.button.base,
                  components.button.variants.ghost,
                  "w-full justify-start",
                  isLoggingOut && "opacity-50 cursor-not-allowed"
                )}
              >
                {isLoggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between px-6 py-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Registry workspace</span>
            <span className="text-border">/</span>
            <span className="font-medium text-foreground">{getPageLabel(location.pathname)}</span>
          </div>
          <EnvSwitcher />
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-8 max-w-container mx-auto w-full">
          <Outlet />
        </main>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
