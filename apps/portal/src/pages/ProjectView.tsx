import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ErrorNotice, Spinner } from '@grids/ui';
import { Explorer } from '@grids/viz';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { api } from '../api';
import { signIn } from '../auth';
import { HeaderControls } from '../prefs';
import { memberSource, publicSource } from '../source';
import { useOptionalUser } from './Home';

const Back = () => (
  <Link to="/" className="flex h-9 items-center gap-1.5 px-2 text-sm text-zinc-600 hover:text-ink" title="All projects">
    <ArrowLeft className="size-4 rtl:rotate-180" />
  </Link>
);

const brand = (color: string) => document.documentElement.style.setProperty('--brand-600', color);

/** A public project's explorer, for anyone. */
export function PublicProjectView() {
  const { tenant, project } = useParams({ strict: false }) as { tenant: string; project: string };
  const view = useQuery({ queryKey: ['public', tenant, project], queryFn: () => api.publicProject(tenant, project), retry: false });
  useEffect(() => {
    if (view.data) {
      brand(view.data.tenant.primaryColor);
      document.title = `${view.data.project.name} · ${view.data.tenant.name}`;
    }
  }, [view.data]);
  const source = useMemo(() => (view.data ? publicSource(tenant, project, view.data.dashboards, view.data.elements) : null), [tenant, project, view.data]);
  if (view.isPending) return <Centered />;
  if (view.isError || !source) return <Failed error={view.error} />;
  const v = view.data;
  return (
    <Explorer
      source={source}
      title={v.project.name}
      subtitle={v.tenant.name}
      accent={v.tenant.primaryColor}
      mapStyles={v.tenant.mapStyles}
      logo={v.tenant.logo ? <img src={v.tenant.logo} alt="" className="size-9 object-contain" /> : <span className="flex size-9 items-center justify-center bg-accent-600 font-semibold text-on-accent">{v.tenant.name[0]}</span>}
      actions={
        <div className="flex items-center gap-2">
          <HeaderControls />
          <Back />
        </div>
      }
    />
  );
}

/** A project the signed-in person can access (private or organisation-wide). */
export function MemberProjectView() {
  const { tenantId, project } = useParams({ strict: false }) as { tenantId: string; project: string };
  const user = useOptionalUser();
  useEffect(() => {
    if (user === null) void signIn({ returnTo: window.location.pathname });
  }, [user]);
  const p = useQuery({ queryKey: ['project', tenantId, project], queryFn: () => api.projects(tenantId).then((l) => l.find((x) => x.key === project) ?? null), enabled: !!user });
  const source = useMemo(() => memberSource(tenantId, project), [tenantId, project]);
  useEffect(() => {
    if (p.data) brand(p.data.color);
  }, [p.data]);
  if (!user || p.isPending) return <Centered />;
  if (p.isError || !p.data) return <Failed error={p.error ?? new Error('Project not found')} />;
  return (
    <Explorer
      source={source}
      title={p.data.name}
      accent={p.data.color}
      logo={p.data.logo ? <img src={p.data.logo} alt="" className="size-9 object-contain" /> : <span className="size-9" style={{ background: p.data.color }} />}
      actions={
        <div className="flex items-center gap-2">
          <HeaderControls />
          <Back />
        </div>
      }
    />
  );
}

const Centered = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner className="size-7" />
  </div>
);
const Failed = ({ error }: { error: unknown }) => (
  <div className="mx-auto max-w-lg space-y-4 p-8">
    <ErrorNotice error={error} />
    <Link to="/" className="text-sm text-accent-700 hover:underline">
      ← All projects
    </Link>
  </div>
);
