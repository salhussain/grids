import { useQuery } from '@tanstack/react-query';
import { roleAtLeast, type ProjectDto, type ProjectRole } from '@grids/schema';
import {
  Activity,
  Building2,
  Droplets,
  Folder,
  HeartPulse,
  Hospital,
  Map as MapIcon,
  MapPin,
  Plane,
  Sprout,
  Truck,
  UserRound,
  Users,
  Box,
  Flag,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useContext } from 'react';
import { api } from '../../api';

/** Icons projects and entity types can use (by name). */
export const ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  plane: Plane,
  hospital: Hospital,
  'heart-pulse': HeartPulse,
  users: Users,
  'user-round': UserRound,
  'building-2': Building2,
  droplets: Droplets,
  map: MapIcon,
  'map-pin': MapPin,
  activity: Activity,
  sprout: Sprout,
  truck: Truck,
  box: Box,
  flag: Flag,
};
export const iconOf = (name: string) => ICONS[name] ?? Box;

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
  return Object.fromEntries((q.data ?? []).map((e) => [e.key, e.name]));
}
