import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router';
import { ApiError, Spinner, applyColorMode, storedColorMode } from '@grids/ui';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { completeSignIn } from './auth';
import { NoProjects } from './pages/Home';
import { lastProject, usePortalProjects } from './projects';
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

/**
 * "/": open the project you last viewed, else the first one you can open (your own before public ones).
 * Switching projects happens in the window behind the project name, so there is no separate list page.
 */
function Landing() {
  const { items, pending } = usePortalProjects();
  const navigate = useNavigate();
  const last = lastProject();
  const target = pending ? undefined : (items.find((i) => i.to === last) ?? items.find((i) => i.mine) ?? items[0]);
  useEffect(() => {
    if (target) void navigate({ to: target.to as '/', replace: true });
  }, [target, navigate]);
  return pending || target ? <div className="flex h-full items-center justify-center"><Spinner className="size-7" /></div> : <NoProjects />;
}

const root = createRootRoute({ component: Outlet });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: Landing }),
  createRoute({ getParentRoute: () => root, path: '/projects', component: () => <Navigate to="/" replace /> }),
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
