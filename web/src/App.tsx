import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { AppShell } from "./components/AppShell";
import { OverviewPage } from "./pages/OverviewPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { TemplateEditorPage } from "./pages/TemplateEditorPage";
import { StampPage } from "./pages/StampPage";
import { JobsPage } from "./pages/JobsPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { CenterSplash } from "./components/CenterSplash";

// Fix: Add protected route component for better auth handling
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, error } = useAuth();

  if (loading) return <CenterSplash />;
  if (error) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

// Fix: Add component for preserving redirect destination
function LoginRedirect() {
  const location = useLocation();
  // Fix: Store intended destination for post-login redirect
  sessionStorage.setItem("redirectAfterLogin", location.pathname + location.search + location.hash);
  return <Navigate to="/login" replace />;
}

export function App() {
  const { user, loading } = useAuth();

  // Fix: Add error handling for loading state
  if (loading) return <CenterSplash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<LoginRedirect />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/new" element={<TemplateEditorPage />} />
        <Route path="/templates/:id" element={<TemplateEditorPage />} />
        <Route path="/stamp" element={<StampPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/keys" element={<ApiKeysPage />} />
        {/* Fix: Add 404 page or keep current behavior */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
