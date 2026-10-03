import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { SubmissionDto } from '@grids/schema';
import { Empty, ErrorNotice, Loading, PageHeader, Tabs, relTime } from '@grids/ui';
import { ChevronRight, ClipboardCheck, Inbox, MapPin } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { FillForm } from './FillForm';
import { useFormsMenu } from './FormsHome';
import { SubmissionSheet } from './SubmissionSheet';
import { StageTrack, SubmissionStatusPill } from './status';

export function useInbox() {
  const ws = useWorkspace();
  return useQuery({ queryKey: ['inbox', ws.tenant.id], queryFn: () => api.inbox(ws.tenant.id), refetchInterval: 60_000 });
}

/** Approvals waiting on the caller, and the caller's own submissions in review. */
export function InboxPage() {
  const ws = useWorkspace();
  const search = useSearch({ strict: false }) as { tab?: 'review' | 'mine' };
  const navigate = useNavigate();
  const inbox = useInbox();
  const [open, setOpen] = useState<SubmissionDto | null>(null);
  const tab = search.tab ?? (inbox.data && !inbox.data.toReview.length && inbox.data.mine.length ? 'mine' : 'review');
  const items = (tab === 'review' ? inbox.data?.toReview : inbox.data?.mine) ?? [];
  return (
    <div>
      <PageHeader eyebrow="Forms" title="Submissions" meta="Review what is waiting on you, and follow your own submissions through approval." />
      <Tabs
        tabs={[
          { id: 'review', label: 'Waiting on me', count: inbox.data?.toReview.length },
          { id: 'mine', label: 'My submissions', count: inbox.data?.mine.filter((s) => s.status === 'returned').length },
        ]}
        value={tab}
        onChange={(t) => void navigate({ to: `/o/${ws.tenant.id}/inbox`, search: { tab: t } })}
      />
      <ErrorNotice error={inbox.error} />
      {inbox.isPending ? (
        <Loading />
      ) : !items.length ? (
        <div className="rounded-2xl border border-zinc-200 bg-snow">
          <Empty icon={tab === 'review' ? ClipboardCheck : Inbox} title={tab === 'review' ? 'All caught up' : 'Nothing in review'}>
            {tab === 'review' ? 'Submissions that need your approval will appear here.' : 'Submissions to forms with an approval workflow appear here, with each decision.'}
          </Empty>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-snow">
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s)} className="group flex w-full items-center gap-4 px-5 py-4 text-start transition hover:bg-zinc-50">
                <span className="flex size-10 shrink-0 items-center justify-center bg-accent-50 text-sm font-semibold text-accent-700 ring-1 ring-accent-100">
                  {(tab === 'review' ? (s.submittedBy ?? '?') : s.formName).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{s.formName}</span>
                    <SubmissionStatusPill s={s} />
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                    <span>{s.project.name}</span>
                    {s.entity && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" /> {s.entity.name}
                      </span>
                    )}
                    {tab === 'review' && <span>by {s.submittedBy ?? 'unknown'}</span>}
                    <span>{relTime(s.submittedAt)}</span>
                  </p>
                  <StageTrack stages={s.stages} current={s.stage} status={s.status} className="mt-2.5 hidden md:flex" />
                </div>
                <ChevronRight className="size-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <SubmissionSheet tenantId={ws.tenant.id} project={open.project.key} id={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** /o/:tenant/fill/:project/:form — filling in from the Forms menu. */
export function FillPage() {
  const ws = useWorkspace();
  const { project, formKey } = useParams({ strict: false }) as { project: string; formKey: string };
  const search = useSearch({ strict: false }) as { resubmit?: string; entity?: string };
  const menu = useFormsMenu();
  const entry = menu.data?.forms.find((f) => f.project.key === project && f.key === formKey);
  const group = menu.data?.groups.find((g) => g.id === entry?.groupId);
  return (
    <FillForm
      key={`${project}/${formKey}/${search.resubmit ?? ''}`}
      tenantId={ws.tenant.id}
      project={project}
      formKey={formKey}
      projectName={entry?.project.name}
      resubmitId={search.resubmit}
      entityId={search.entity}
      back={search.resubmit ? { to: `/o/${ws.tenant.id}/inbox`, label: 'Submissions' } : { to: `/o/${ws.tenant.id}/forms`, search: group ? { group: group.id } : undefined, label: group?.name ?? 'Forms' }}
      inboxHref={`/o/${ws.tenant.id}/inbox`}
    />
  );
}
