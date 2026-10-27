import { useQuery } from '@tanstack/react-query';
import { DocumentTemplate, RecordOptions, SUBMISSION_RECORD_ID } from '@grids/schema';
import { Dialog, ErrorNotice, Loading, confirmDialog, dateTime } from '@grids/ui';
import { RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useProject } from './context';

const ACTION = { saved: 'Saved', published: 'Published', restored: 'Restored' } as const;

/** What a revision's text and settings looked like, in a few words. */
const summary = (docId: string, snapshot: unknown) => {
  if (docId === SUBMISSION_RECORD_ID) {
    const r = RecordOptions.safeParse(snapshot);
    return r.success ? `${r.data.layout === 'form' ? 'As the form' : 'Tables'} layout` : '';
  }
  const d = DocumentTemplate.safeParse(snapshot);
  return d.success
    ? `${d.data.name} · ${d.data.visibility} · ${d.data.body.length} characters`
    : '';
};

/** Every time a document was saved or published, by whom, with a way back to any of them as the draft. */
export function DocumentHistory({
  formKey,
  docId,
  name,
  onRestore,
  onClose,
}: {
  formKey: string;
  docId: string;
  name: string;
  onRestore(snapshot: unknown): void;
  onClose(): void;
}) {
  const { tenantId, project } = useProject();
  const list = useQuery({
    queryKey: ['document-revisions', tenantId, project.key, formKey, docId],
    queryFn: () => api.documentRevisions(tenantId, project.key, formKey, docId),
  });
  const rows = list.data ?? [];
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`History of ${name}`}
      description="Each save and publish is kept. Restoring one puts it back as your draft; nothing changes for emails and downloads until you publish."
    >
      <ErrorNotice error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <p className="py-8 text-center text-sm text-zinc-500">Nothing has been saved yet.</p>
      ) : (
        <ol className="divide-y divide-zinc-100 border border-zinc-200">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3">
              <span
                className={`flex h-7 w-24 shrink-0 items-center justify-center px-2 text-xs font-semibold ${r.action === 'published' ? 'bg-emerald-100 text-emerald-900' : 'bg-accent-50 text-accent-800'}`}
              >
                {ACTION[r.action]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{dateTime(r.createdAt)}</div>
                <div className="truncate text-xs text-zinc-500">
                  {r.actorName ? `${r.actorName} · ` : ''}
                  {summary(docId, r.snapshot)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Restore"
                title="Restore"
                className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
                onClick={async () => {
                  if (
                    await confirmDialog('Replace your draft of this document with this version?', {
                      confirmLabel: 'Restore',
                      danger: true,
                    })
                  ) {
                    onRestore(r.snapshot);
                    onClose();
                  }
                }}
              >
                <RotateCcw className="size-[18px]" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
