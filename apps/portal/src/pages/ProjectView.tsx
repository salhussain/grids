import { ProjectHelp } from '../ProjectHelp';
import { visitorSupport } from '../support';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ErrorNotice, Spinner } from '@grids/ui';
import { Explorer, SupportWidget } from '@grids/viz';
import { useEffect, useMemo } from 'react';
import { api } from '../api';
import { signIn } from '../auth';
import { HeaderControls } from '../prefs';
import { memberSource, publicSource } from '../source';
import { AuthControl } from '../AuthControl';
import { ProjectSwitcher } from '../ProjectSwitcher';
import { forgetProject, rememberProject, useOptionalUser } from '../projects';

const brand = (color: string) => document.documentElement.style.setProperty('--brand-600', color);

/** A public project's explorer, for anyone. */
export function PublicProjectView() {
  const { tenant, project } = useParams({ strict: false }) as { tenant: string; project: string };
  const view = useQuery({ queryKey: ['public', tenant, project], queryFn: () => api.publicProject(tenant, project), retry: false });
  useEffect(() => {
    if (view.data) {
      rememberProject(`/p/${tenant}/${project}`);
      brand(view.data.project.color || view.data.tenant.primaryColor);
      document.title = `${view.data.project.name} · ${view.data.tenant.name}`;
    }
  }, [view.data, tenant, project]);
  const support = useMemo(() => visitorSupport(tenant), [tenant]);
  const source = useMemo(() => (view.data ? publicSource(tenant, project, view.data.dashboards, view.data.elements) : null), [tenant, project, view.data]);
  if (view.isPending) return <Centered />;
  if (view.isError || !source) return <Failed error={view.error} />;
  const v = view.data;
  const logo = v.tenant.logo ? <img src={v.tenant.logo} alt="" className="size-9 object-contain" /> : <span className="flex size-9 items-center justify-center bg-accent-600 font-semibold text-on-accent">{v.tenant.name[0]}</span>;
  return (
    <>
    <Explorer
      modeToggle={false}
      source={source}
      title={v.project.name}
      subtitle={v.tenant.name}
      accent={v.project.color || v.tenant.primaryColor}
      mapStyles={v.tenant.mapStyles}
      reporting={v.project.reporting}
      rememberPeriod={false}
      layout={v.project.explorer.layout}
      hideOnLayer={v.project.explorer.hideOnLayer}
      panelStart={v.project.explorer.panelStart}
      helpCorner={v.tenant.helpPosition === 'right'}
      logo={logo}
      switcher={<ProjectSwitcher currentTo={`/p/${tenant}/${project}`} logo={logo} name={v.project.name} subtitle={v.tenant.name} />}
      actions={
        <div className="flex items-center gap-2">
          <HeaderControls />
          <AuthControl />
        </div>
      }
    />
    <SupportWidget client={support} project={project} side={v.tenant.helpPosition === 'right' ? 'end' : 'start'} className={v.tenant.helpPosition === 'right' ? 'bottom-5!' : undefined} />
    </>
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
    if (p.data) {
      brand(p.data.color);
      rememberProject(`/o/${tenantId}/p/${project}`);
    }
  }, [p.data, tenantId, project]);
  if (!user || p.isPending) return <Centered />;
  if (p.isError || !p.data) return <Failed error={p.error ?? new Error('Project not found')} />;
  const logo = p.data.logo ? <img src={p.data.logo} alt="" className="size-9 object-contain" /> : <span className="size-9" style={{ background: p.data.color }} />;
  return (
    <>
    <Explorer
      modeToggle={false}
      source={source}
      title={p.data.name}
      accent={p.data.color}
      reporting={p.data.reporting}
      rememberPeriod={false}
      layout={p.data.explorer.layout}
      hideOnLayer={p.data.explorer.hideOnLayer}
      panelStart={p.data.explorer.panelStart}
      logo={logo}
      switcher={<ProjectSwitcher currentTo={`/o/${tenantId}/p/${project}`} logo={logo} name={p.data.name} />}
      actions={
        <div className="flex items-center gap-2">
          <HeaderControls />
          <AuthControl />
        </div>
      }
    />
    <ProjectHelp tenantId={tenantId} project={project} />
    </>
  );
}

const Centered = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner className="size-7" />
  </div>
);
const Failed = ({ error }: { error: unknown }) => {
  // Don't send people straight back here: the landing page opens the last project they viewed.
  useEffect(() => forgetProject(), []);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-8">
      <ErrorNotice error={error} />
      <Link to="/" className="text-sm text-accent-700 hover:underline">
        ← Other projects
      </Link>
    </div>
  );
};
