import { useQuery } from '@tanstack/react-query';
import { SubmissionsPage } from '@grids/schema';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Dialog, ErrorNotice, Loading, PageHeader, Tabs } from '@grids/ui';
import type { Inbox} from 'lucide-react';
import { ListChecks, Plus, Table2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useMe, useWorkspace } from '../../session';
import { FillForm } from './FillForm';
import { useFormsMenu } from './FormsHome';
import { SubmissionPane } from './SubmissionSheet';
import { SubmissionsList } from './SubmissionsList';

export function useInbox() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['inbox', ws.tenant.id],
    queryFn: () => api.inbox(ws.tenant.id),
    refetchInterval: 60_000,
  });
}

export const formHref = (tenantId: string, f: { project: { key: string }; key: string }) =>
  `/o/${tenantId}/forms/${f.project.key}/${f.key}`;

/** One form: everyone's submissions you can see, and (for approvers) the ones waiting on you; filling in starts from the button at the top. */
export function FormPage() {
  const ws = useWorkspace();
  const { project, formKey } = useParams({ strict: false }) as { project: string; formKey: string };
  const search = useSearch({ strict: false }) as {
    tab?: 'all' | 'pending' | 'mine';
    submission?: string;
  };
  const me = useMe();
  const navigate = useNavigate();
  const menu = useFormsMenu();
  const inbox = useInbox();
  const entry = menu.data?.forms.find((f) => f.project.key === project && f.key === formKey);
  const formsQ = useQuery({
    queryKey: ['forms', ws.tenant.id, project],
    queryFn: () => api.forms(ws.tenant.id, project),
  });
  const formDto = formsQ.data?.find((f) => f.key === formKey);
  const cfg = SubmissionsPage.parse(formDto?.settings?.submissionsPage ?? {});
  const def = formDto?.published ?? formDto?.draft ?? null;
  const all = useQuery({
    queryKey: ['form-submissions', ws.tenant.id, project, formKey],
    queryFn: () => api.submissions(ws.tenant.id, project, formKey, { page: 1, pageSize: 100 }),
  });
  const pending = (inbox.data?.toReview ?? []).filter(
    (s) => s.project.key === project && s.formKey === formKey,
  );
  const mine = (all.data?.items ?? []).filter((s) => s.submittedById === me.id);
  const tabs: {
    id: 'all' | 'pending' | 'mine';
    label: string;
    count?: number;
    icon: typeof Inbox;
  }[] = [
    ...(cfg.tabs.all
      ? [{ id: 'all' as const, label: 'All submissions', count: all.data?.total, icon: Table2 }]
      : []),
    ...(cfg.tabs.pending && pending.length
      ? [
          {
            id: 'pending' as const,
            label: 'Pending actions',
            count: pending.length,
            icon: ListChecks,
          },
        ]
      : []),
    ...(cfg.tabs.mine
      ? [{ id: 'mine' as const, label: 'My submissions', count: mine.length, icon: UserRound }]
      : []),
  ];
  const tab = tabs.find((t) => t.id === search.tab)?.id ?? tabs[0]?.id ?? 'all';
  const [pick, setPick] = useState<string | null>(search.submission ?? null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const source = (tab === 'pending' ? pending : tab === 'mine' ? mine : all.data?.items) ?? [];
  return (
    <div>
      <PageHeader
        eyebrow={entry?.project.name ?? 'Forms'}
        title={entry?.name ?? formKey}
        meta={entry?.description || undefined}
        actions={
          <Link
            to={`/o/${ws.tenant.id}/fill/${project}/${formKey}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            <Plus className="size-4" /> New submission
          </Link>
        }
      />
      {tabs.length > 1 && (
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(t) => (
            setPick(null),
            void navigate({
              to: formHref(ws.tenant.id, { project: { key: project }, key: formKey }),
              search: { tab: t },
            })
          )}
        />
      )}
      <ErrorNotice error={all.error} />
      {all.isPending ? (
        <Loading />
      ) : (
        <>
          <SubmissionsList
            items={source}
            cfg={cfg}
            def={def}
            tenantId={ws.tenant.id}
            project={project}
            formKey={formKey}
            onOpen={setPick}
          />
          {pick && (
            <Dialog
              open
              onClose={() => setPick(null)}
              wide="full"
              headerActions={<div ref={setHost} className="flex items-center gap-2" />}
              title={source.find((x) => x.id === pick)?.entity?.name ?? entry?.name ?? 'Submission'}
              description={entry?.name}
            >
              <div className="-mx-6 -my-5 flex h-[70vh] min-h-0 flex-col">
                <SubmissionPane
                  key={pick}
                  tenantId={ws.tenant.id}
                  project={project}
                  id={pick}
                  actionsHost={host}
                />
              </div>
            </Dialog>
          )}
        </>
      )}
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
  return (
    <FillForm
      key={`${project}/${formKey}/${search.resubmit ?? ''}`}
      tenantId={ws.tenant.id}
      project={project}
      formKey={formKey}
      projectName={entry?.project.name}
      resubmitId={search.resubmit}
      entityId={search.entity}
      back={
        search.resubmit && entry
          ? { to: formHref(ws.tenant.id, entry), label: entry.name }
          : undefined
      }
      inboxHref={formHref(ws.tenant.id, { project: { key: project }, key: formKey })}
    />
  );
}
