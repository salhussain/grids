import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { currentUser } from './auth';

/** Signed-in user, if any (never forces a sign-in). `undefined` while it is being checked. */
export function useOptionalUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    void currentUser().then(setUser);
  }, []);
  return user;
}

export interface PortalProject {
  /** Route to open it. */
  to: string;
  name: string;
  description: string;
  org: string;
  color: string;
  logo: string | null;
  /** Icon name, shown when there is no logo. */
  icon: string;
  cover: string | null;
  badge: 'Public' | 'Organisation' | 'Private';
  /** Needs sign-in (not a public project). */
  mine: boolean;
}

/**
 * Every project this visitor can open: the public catalogue, plus (when signed in) the live private
 * and organisation projects of the organisations they belong to.
 */
export function usePortalProjects() {
  const user = useOptionalUser();
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: api.publicCatalogue });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!user });
  const mine = useQuery({
    queryKey: ['my-projects', me.data?.memberships.map((m) => m.tenantId)],
    enabled: !!me.data,
    queryFn: async () =>
      (
        await Promise.all(
          me.data!.memberships
            .filter((m) => m.status === 'active')
            .map(async (m) => (await api.projects(m.tenantId).catch(() => [])).filter((p) => p.status === 'live').map((p) => ({ tenantId: m.tenantId, tenantName: m.tenantName, p }))),
        )
      ).flat(),
  });
  const items = useMemo<PortalProject[]>(() => {
    const own = (mine.data ?? [])
      .filter((m) => m.p.visibility !== 'public')
      .map<PortalProject>(({ tenantId, tenantName, p }) => ({
        to: `/o/${tenantId}/p/${p.key}`,
        name: p.name,
        description: p.description,
        org: tenantName,
        color: p.color,
        logo: p.logo,
        icon: p.icon,
        cover: p.coverImage,
        badge: p.visibility === 'organisation' ? 'Organisation' : 'Private',
        mine: true,
      }));
    const pub = (catalogue.data ?? []).map<PortalProject>((c) => ({
      to: `/p/${c.tenant.slug}/${c.project.key}`,
      name: c.project.name,
      description: c.project.description,
      org: c.tenant.name,
      color: c.project.color,
      logo: c.project.logo ?? c.tenant.logo,
      icon: c.project.icon,
      cover: c.project.coverImage,
      badge: 'Public',
      mine: false,
    }));
    return [...own, ...pub];
  }, [mine.data, catalogue.data]);
  // Ready once we know who is looking and what they can open.
  const pending = user === undefined || catalogue.isPending || (!!user && (me.isPending || mine.isPending));
  return { items, pending, signedIn: !!user, error: catalogue.error };
}

const LAST = 'grids.portal.last';
export const rememberProject = (path: string) => {
  try {
    localStorage.setItem(LAST, path);
  } catch {
    /* storage unavailable: the landing page just shows the list */
  }
};
export const forgetProject = () => {
  try {
    localStorage.removeItem(LAST);
  } catch {
    /* nothing remembered anyway */
  }
};
export const lastProject = () => {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
};
