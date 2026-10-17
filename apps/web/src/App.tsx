import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Header } from '@/components/header';
import { Providers } from '@/components/providers';
import { AuthGuard } from '@/components/auth/auth-guard';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { markPerformance } from '@/lib/performance/performance-marks';

// Lazy load pages for isolation. Pages are recreated on route retry so a failed
// lazy import is re-attempted instead of replaying React.lazy's cached rejection.
interface LazyPages {
  HomePage: React.LazyExoticComponent<React.ComponentType>;
  LoginPage: React.LazyExoticComponent<React.ComponentType>;
  RegisterPage: React.LazyExoticComponent<React.ComponentType>;
  ConnectionsPage: React.LazyExoticComponent<React.ComponentType>;
  SettingsPage: React.LazyExoticComponent<React.ComponentType>;
  SqlLabPage: React.LazyExoticComponent<React.ComponentType>;
  UnauthorizedPage: React.LazyExoticComponent<React.ComponentType>;
}

function LegacyKnowledgeRedirect() {
  const location = useLocation();
  return <Navigate to={`/settings/ai${location.pathname}${location.search}${location.hash}`} replace />;
}

function createPages(): LazyPages {
  return {
    HomePage: lazy(() => import('./app/page')),
    LoginPage: lazy(() => import('./app/auth/login/page')),
    RegisterPage: lazy(() => import('./app/auth/register/page')),
    ConnectionsPage: lazy(() => import('./app/connections/page')),
    SettingsPage: lazy(() => import('./app/settings/page')),
    SqlLabPage: lazy(() => import('./app/sqllab/page')),
    UnauthorizedPage: lazy(() => import('./app/unauthorized/page')),
  };
}

function App() {
  const [routeRetryKey, setRouteRetryKey] = useState(0);
  const pages = useMemo(() => createPages(), [routeRetryKey]);

  useEffect(() => {
    markPerformance("route_mounted");
  }, []);

  return (
    <Providers>
      <AuthGuard>
        <div className="relative flex h-screen flex-col bg-background overflow-hidden">
          <Header />
          <main className="flex-1 flex flex-col overflow-hidden">
            <RouteErrorBoundary onRetry={() => setRouteRetryKey((key) => key + 1)}>
              <Suspense fallback={<div className="h-full w-full flex items-center justify-center">Loading page...</div>}>
                <Routes>
                  <Route path="/" element={<pages.HomePage />} />
                  <Route path="/auth/login" element={<pages.LoginPage />} />
                  <Route path="/auth/register" element={<pages.RegisterPage />} />
                  <Route path="/connections" element={<pages.ConnectionsPage />} />
                  <Route path="/settings/ai/knowledge" element={<pages.SettingsPage />} />
                  <Route path="/settings/ai/knowledge/:knowledgeBaseId" element={<pages.SettingsPage />} />
                  <Route path="/settings/ai/knowledge/:knowledgeBaseId/documents/:documentId" element={<pages.SettingsPage />} />
                  <Route path="/knowledge" element={<LegacyKnowledgeRedirect />} />
                  <Route path="/knowledge/:knowledgeBaseId" element={<LegacyKnowledgeRedirect />} />
                  <Route path="/knowledge/:knowledgeBaseId/documents/:documentId" element={<LegacyKnowledgeRedirect />} />
                  <Route path="/settings" element={<pages.SettingsPage />} />
                  <Route path="/sqllab" element={<pages.SqlLabPage />} />
                  <Route path="/unauthorized" element={<pages.UnauthorizedPage />} />

                  {/* Fallback to 404 or home */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
      </AuthGuard>
    </Providers>
  );
}

export default App;
