import { useQuery } from '@tanstack/react-query';
import { roleAtLeast, type ProjectDto, type ProjectRole } from '@grids/schema';
import { createContext, useContext } from 'react';
import { api } from '../../api';

/** Icons projects and entity types can use (by name). */
export { ICONS, iconOf } from '@grids/viz';

interface ProjectCtx {
  project: ProjectDto;
  tenantId: string;
  /** /o/:tenantId/p/:projectKey */
  base: string;
  can: (role: ProjectRole) => boolean;
}
const Ctx = createContext<ProjectCtx | null>(null);
export const ProjectProvider = Ctx.Provider;
export function useProject() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProject outside a project');
  return c;
}
export const projectCtx = (project: ProjectDto, tenantId: string): ProjectCtx => ({
  project,
  tenantId,
  base: `/o/${tenantId}/p/${project.key}`,
  can: (role) => roleAtLeast(project.myRole, role),
});

/** Data elements by key → name (legends, labels). */
export function useElementNames() {
  const { tenantId, project } = useProject();
  const q = useQuery({ queryKey: ['elements', tenantId, project.key], queryFn: () => api.elements(tenantId, project.key) });
  return Object.fromEntries((q.data ?? []).map((e) => [e.ref, e.name]));
}
