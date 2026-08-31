import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Static imports for auth components (not suitable for lazy loading)
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/admin/ProtectedRoute";

// Lazy load all other pages for code splitting
const AdminLogin = lazy(() => import("./pages/admin/Login"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const AdminOverview = lazy(() => import("./pages/admin/Overview").catch(() => import("./pages/admin/Overview")));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics"));
const AdminContacts = lazy(() => import("./pages/admin/Contacts").catch(() => import("./pages/admin/Contacts")));
const AdminPagesPage = lazy(() => import("./pages/admin/PagesPage"));
const PageConfigEditor = lazy(() => import("./components/admin/pages/PageConfigEditor"));
const AdminImport = lazy(() => import("./pages/admin/ImportPage"));
const AdminSettings = lazy(() => import("./pages/admin/SettingsPage"));
const AdminSegments = lazy(() => import("./pages/admin/Segments"));
const AdminCampaigns = lazy(() => import("./pages/admin/Campaigns"));
const AdminAutomations = lazy(() => import("./pages/admin/Automations"));
const AdminJourneyBuilder = lazy(() => import("./pages/admin/JourneyBuilder"));
const AdminTemplates = lazy(() => import("./pages/admin/Templates"));
const TemplateEditorPage = lazy(() => import("./components/admin/campaigns/TemplateEditor"));
const TemplatePreviewPage = lazy(() => import("./pages/admin/TemplatePreview"));
const AdminExperiments = lazy(() => import("./pages/admin/Experiments"));
const AdminExperimentDetail = lazy(() => import("./pages/admin/ExperimentDetail"));
const AdminExperimentsSetup = lazy(() => import("./pages/admin/ExperimentsSetup"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// Skeleton loading fallback - better than black screen
const PageLoader = () => (
  <div className="min-h-screen bg-background flex flex-col">
    {/* Header skeleton */}
    <div className="h-16 md:h-20 border-b border-border/30 flex items-center px-4">
      <div className="w-24 h-8 bg-muted/20 rounded animate-pulse" />
    </div>
    {/* Hero skeleton */}
    <div className="flex-1 flex items-center justify-center px-6 pt-20">
      <div className="w-full max-w-lg space-y-4">
        <div className="h-4 w-32 bg-muted/20 rounded animate-pulse mx-auto" />
        <div className="h-10 w-full bg-muted/20 rounded animate-pulse" />
        <div className="h-10 w-3/4 bg-muted/20 rounded animate-pulse mx-auto" />
        <div className="h-6 w-full bg-muted/20 rounded animate-pulse" />
        <div className="h-14 w-full bg-primary/20 rounded-2xl animate-pulse mt-6" />
      </div>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />

    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Admin routes - wrapped with AuthProvider */}
          <Route
            path="/login"
            element={
              <AuthProvider>
                <Suspense fallback={<PageLoader />}>
                  <AdminLogin />
                </Suspense>
              </AuthProvider>
            }
          />

          {/* Admin layout with sidebar */}
          <Route
            path="/"
            element={
              <AuthProvider>
                <ProtectedRoute>
                  <Suspense fallback={<PageLoader />}>
                    <AdminLayout />
                  </Suspense>
                </ProtectedRoute>
              </AuthProvider>
            }
          >
            <Route index element={<Suspense fallback={<PageLoader />}><AdminOverview /></Suspense>} />
            <Route path="analytics" element={<Suspense fallback={<PageLoader />}><AdminAnalytics /></Suspense>} />
            <Route path="contacts" element={<Suspense fallback={<PageLoader />}><AdminContacts /></Suspense>} />
            <Route path="pages" element={<Suspense fallback={<PageLoader />}><AdminPagesPage /></Suspense>} />
            <Route path="pages/:slug/edit" element={<Suspense fallback={<PageLoader />}><PageConfigEditor /></Suspense>} />
            <Route path="import" element={<Suspense fallback={<PageLoader />}><AdminImport /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<PageLoader />}><AdminSettings /></Suspense>} />
            <Route path="segments" element={<Suspense fallback={<PageLoader />}><AdminSegments /></Suspense>} />
            <Route path="campaigns" element={<Suspense fallback={<PageLoader />}><AdminCampaigns /></Suspense>} />
            <Route path="automations" element={<Suspense fallback={<PageLoader />}><AdminAutomations /></Suspense>} />
            <Route path="automations/fluxos/:id" element={<Suspense fallback={<PageLoader />}><AdminJourneyBuilder /></Suspense>} />
            <Route path="templates" element={<Suspense fallback={<PageLoader />}><AdminTemplates /></Suspense>} />
            <Route path="templates/new" element={<Suspense fallback={<PageLoader />}><TemplateEditorPage /></Suspense>} />
            <Route path="templates/:id/edit" element={<Suspense fallback={<PageLoader />}><TemplateEditorPage /></Suspense>} />
            <Route path="experiments" element={<Suspense fallback={<PageLoader />}><AdminExperiments /></Suspense>} />
            <Route path="experiments/setup" element={<Suspense fallback={<PageLoader />}><AdminExperimentsSetup /></Suspense>} />
            <Route path="experiments/:id" element={<Suspense fallback={<PageLoader />}><AdminExperimentDetail /></Suspense>} />
          </Route>

          {/* Visualizacao de template — aberta em nova aba pelo menu de /templates.
              Rota IRMA do bloco AdminLayout (nao filha) de proposito: e um
              visualizador de tela cheia, sem a sidebar do admin. O React Router
              v6 da precedencia a este caminho sobre o path="/" com filhos. */}
          <Route
            path="/templates/:id/preview"
            element={
              <AuthProvider>
                <ProtectedRoute>
                  <Suspense fallback={<PageLoader />}><TemplatePreviewPage /></Suspense>
                </ProtectedRoute>
              </AuthProvider>
            }
          />

          {/* Redirects */}
          <Route path="/leads" element={<Navigate to="/contacts" replace />} />
          {/* Legacy /adnia redirects */}
          <Route path="/adnia/*" element={<Navigate to="/" replace />} />
          <Route path="/adnia" element={<Navigate to="/" replace />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
