import type { ErrorComponentProps } from '@tanstack/react-router';
import { ApiError, useToast } from '@grids/ui';
import { Copy, Home, RotateCcw, TriangleAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { WorkspaceDto } from '@grids/schema';
import { applyTheme, resetTheme } from './theme';
import { WorkspaceProvider } from './session';
import { SupportBubble } from './SupportBubble';

/** What people see when a page breaks: what happened, the way out, and (as in the workspace) a help button. */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const toast = useToast();
  const org = window.location.pathname.match(/^\/o\/([^/]+)/)?.[1];
  // The workspace that broke took its colours with it: wear the organisation's again, from what was already loaded.
  const qc = useQueryClient();
  const ws = org ? qc.getQueryData<WorkspaceDto>(['workspace', org]) : undefined;
  useEffect(() => {
    if (ws) applyTheme(ws.theme);
    return () => resetTheme();
  }, [ws]);
  const code =
    error instanceof ApiError
      ? `HTTP ${error.status}`
      : error instanceof Error
        ? error.name
        : 'Error';
  const description = error instanceof Error ? error.message : String(error);
  const report = `${code}: ${description}\n${window.location.href}\n${new Date().toISOString()}`;
  const icon = 'grid size-10 place-items-center rounded-full border transition-colors';
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md text-center">
        <TriangleAlert className="mx-auto size-14 text-accent-600" strokeWidth={1.5} aria-hidden />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-600">
          This page couldn’t load. Try again, or get in touch if it keeps happening.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            aria-label="Try again"
            title="Try again"
            onClick={reset}
            className={`${icon} border-transparent bg-accent-600 text-white hover:bg-accent-700`}
          >
            <RotateCcw className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Home"
            title="Home"
            onClick={() => (window.location.href = org ? `/o/${org}` : '/')}
            className={`${icon} border-zinc-300 text-zinc-700 hover:bg-zinc-100 hover:text-ink`}
          >
            <Home className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Copy the error"
            title="Copy the error"
            onClick={() =>
              void navigator.clipboard?.writeText(report).then(() => toast('Error copied'))
            }
            className={`${icon} border-zinc-300 text-zinc-700 hover:bg-zinc-100 hover:text-ink`}
          >
            <Copy className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      {/* The same help button as in the workspace: raise a ticket from here (only when the workspace had loaded). */}
      {ws && (
        <WorkspaceProvider value={ws}>
          <SupportBubble />
        </WorkspaceProvider>
      )}
    </main>
  );
}
