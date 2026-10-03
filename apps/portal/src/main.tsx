import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router';
import { ApiError, applyColorMode, storedColorMode } from '@grids/ui';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { completeSignIn } from './auth';
import { Home } from './pages/Home';
import { MemberProjectView, PublicProjectView } from './pages/ProjectView';
import { I18nProvider } from './prefs';
import './styles.css';

applyColorMode(storedColorMode());

function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeSignIn()
      .then((u) => void navigate({ to: ((u.state as { returnTo?: string } | undefined)?.returnTo ?? '/') as '/', replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [navigate]);
  return error ? <p className="p-8 text-sm text-red-700">Sign-in failed: {error}</p> : null;
}

const root = createRootRoute({ component: Outlet });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: Home }),
  createRoute({ getParentRoute: () => root, path: '/p/$tenant/$project', component: PublicProjectView }),
  createRoute({ getParentRoute: () => root, path: '/o/$tenantId/p/$project', component: MemberProjectView }),
  createRoute({ getParentRoute: () => root, path: '/auth/callback', component: Callback }),
  createRoute({ getParentRoute: () => root, path: '$', component: () => <Navigate to="/" /> }),
]);
const router = createRouter({ routeTree });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
