import { useParams } from '@tanstack/react-router';
import { SupportThread, type SupportClient } from '@grids/viz';
import { LifeBuoy } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../api';
import { env } from '../env';

/** The page the email links to: one conversation, for someone who asked from a project's page without an account. */
export function SupportThreadPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const client = useMemo<SupportClient>(
    () => ({
      signedIn: false,
      storageKey: 'grids-support:thread',
      info: () => Promise.reject(new Error('not used')),
      upload: (file) => api.publicHelpUploadReply(token, file, file.name),
      create: () => Promise.reject(new Error('not used')),
      thread: (t) => api.publicHelpThread(t),
      reply: (t, input) => api.publicHelpReply(t, input),
      fileUrl: (t, id) => Promise.resolve(`${env.apiUrl}/public/help/${t}/files/${id}`),
      openFile: (t, file) => void window.open(`${env.apiUrl}/public/help/${t}/files/${file.id}`, '_blank', 'noopener'),
    }),
    [token],
  );
  return (
    <div className="flex h-full min-h-screen flex-col bg-canvas">
      <div className="mx-auto flex h-screen w-full max-w-2xl flex-1 flex-col border-x border-zinc-200 bg-snow">
        <header className="flex items-center gap-2 border-b border-zinc-200 bg-ink px-4 py-3 text-canvas">
          <LifeBuoy className="size-4" /> <span className="text-sm font-semibold">Your conversation with the team</span>
        </header>
        <SupportThread client={client} threadKey={token} />
      </div>
    </div>
  );
}
