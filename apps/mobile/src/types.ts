import type { FormDefinition, FormDto } from '@grids/schema';

export interface ProjectLite {
  key: string;
  name: string;
  color: string;
  icon: string;
  myRole: string | null;
}

/** A form as the device keeps it: enough to fill it in, not to edit it. */
export interface FormLite {
  key: string;
  name: string;
  description: string;
  currentVersion: number | null;
  published: FormDefinition | null;
  settings: FormDto['settings'];
  canFill: boolean;
  availability: FormDto['availability'];
  subjectType: FormDto['subjectType'];
}

export const liteOf = (f: FormDto): FormLite => ({
  key: f.key,
  name: f.name,
  description: f.description,
  currentVersion: f.currentVersion,
  published: f.published,
  settings: f.settings,
  canFill: f.canFill,
  availability: f.availability,
  subjectType: f.subjectType,
});

/** Places of a project live under this name in the device's database. */
export const scopeOf = (tenantId: string, project: string) => `${tenantId}:${project}`;

/** One of the person's own past submissions, as kept for reading offline. */
export interface HistoryRow {
  id: string;
  formName: string;
  status: string;
  stageName: string | null;
  outcome: string | null;
  entity: string | null;
  collectedAt: string;
  submittedAt: string;
}
