import { describe, expect, it } from 'vitest';
import { applyParams, DashboardParams, QuerySpec } from '../src/index.js';

describe('dashboard parameters', () => {
  const area = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const kpi = QuerySpec.parse({ kind: 'kpi', element: 'cases', range: { lastHours: 168 } });
  const latest = QuerySpec.parse({ kind: 'breakdown', element: 'cases', by: 'parent', latest: true });
  const table = QuerySpec.parse({ kind: 'table', entityType: 'facility' });

  it('binds the area and period only when the dashboard offers them', () => {
    expect(applyParams(kpi, { area, hours: 720 }, { areaType: 'province', period: true })).toMatchObject({ ancestorId: area, range: { lastHours: 720 } });
    expect(applyParams(kpi, { area, hours: 720 }, { areaType: null, period: false })).toEqual(kpi);
  });

  it('leaves latest-value and range-less queries’ windows alone', () => {
    expect(applyParams(latest, { hours: 720 }, { areaType: null, period: true })).toEqual(latest);
    expect(applyParams(table, { area, hours: 720 }, { areaType: 'province', period: true })).toEqual({ ...table, ancestorId: area });
  });

  it('accepts only the offered periods', () => {
    expect(DashboardParams.safeParse({ hours: '168' }).success).toBe(true);
    expect(DashboardParams.safeParse({ hours: 5 }).success).toBe(false);
  });
});
