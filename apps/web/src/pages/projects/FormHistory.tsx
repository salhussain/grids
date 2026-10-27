import { useQuery } from '@tanstack/react-query';
import type { FormDefinition } from '@grids/schema';
import { Dialog, ErrorNotice, Loading, confirmDialog, dateTime } from '@grids/ui';
import { RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useProject } from './context';

const questionsOf = (d: FormDefinition) => new Map(d.sections.flatMap((s) => s.questions).map((q) => [q.key, q]));

/** What changed between two versions, in a few words. */
function changes(now: FormDefinition, before: FormDefinition | undefined): string {
  if (!before) return 'First version';
  const a = questionsOf(now);
  const b = questionsOf(before);
  const added = [...a.keys()].filter((k) => !b.has(k)).length;
  const removed = [...b.keys()].filter((k) => !a.has(k)).length;
  const edited = [...a.keys()].filter((k) => b.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).length;
  const parts = [added && `${added} added`, removed && `${removed} removed`, edited && `${edited} changed`].filter(Boolean) as string[];
  if (!parts.length) return JSON.stringify(now) === JSON.stringify(before) ? 'No changes' : 'Wording and settings';
  return parts.join(', ');
}

/** Every published version of a form, with a way back to any of them as the working draft. */
export function HistoryDialog({ formKey, current, onRestore, onClose }: { formKey: string; current: number | null; onRestore(def: FormDefinition, version: number): void; onClose(): void }) {
  const { tenantId, project } = useProject();
  const versions = useQuery({ queryKey: ['form-versions', tenantId, project.key, formKey], queryFn: () => api.formVersions(tenantId, project.key, formKey) });
  const list = versions.data ?? [];
  return (
    <Dialog open wide onClose={onClose} title="Version history" description="Each time you publish, that version is kept. Restoring one puts it back as your draft, and nothing changes for people until you publish.">
      <ErrorNotice error={versions.error} />
      {versions.isPending ? (
        <Loading />
      ) : !list.length ? (
        <p className="py-8 text-center text-sm text-zinc-500">Nothing published yet.</p>
      ) : (
        <ol className="divide-y divide-zinc-100 border border-zinc-200">
          {list.map((v, i) => (
            <li key={v.version} className="flex items-center gap-4 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center bg-accent-50 text-sm font-semibold text-accent-800">v{v.version}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {dateTime(v.publishedAt)} {v.version === current && <span className="ms-1.5 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900">Live</span>}
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {v.publishedBy ? `${v.publishedBy} · ` : ''}
                  {v.definition.sections.reduce((n, s) => n + s.questions.length, 0)} questions · {changes(v.definition, list[i + 1]?.definition)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Restore v${v.version}`}
                title={`Restore v${v.version}`}
                className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-ink"
                onClick={async () => {
                  if (await confirmDialog(`Replace your draft with version ${v.version}? Unpublished changes in the draft are lost.`, { confirmLabel: `Restore v${v.version}`, danger: true })) {
                    onRestore(v.definition, v.version);
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

