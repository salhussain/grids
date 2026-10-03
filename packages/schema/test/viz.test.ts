import { describe, expect, it } from 'vitest';
import { applyParams, DashboardParams, QuerySpec } from '../src/index.js';

describe('dashboard parameters', () => {
  const area = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const kpi = QuerySpec.parse({ kind: 'kpi', element: 'cases', range: { lastHours: 168 } });
  const latest = QuerySpec.parse({ kind: 'breakdown', element: 'cases', by: 'parent', latest: true });
  const table = QuerySpec.parse({ kind: 'table', entityType: 'facility' });

  it('binds the area only when the dashboard offers it; periods always apply', () => {
    expect(applyParams(kpi, { area, hours: 720 }, { areaType: 'province', period: true })).toMatchObject({ ancestorId: area, range: { lastHours: 720 } });
    expect(applyParams(kpi, { area }, { areaType: null, period: false })).toEqual(kpi);
    expect(applyParams(kpi, { entity: area }, { areaType: null, period: false })).toMatchObject({ ancestorId: area });
  });

  it('binds custom date ranges and series intervals', () => {
    expect(applyParams(kpi, { from: '2026-01-01', to: '2026-01-31', hours: 24 }, { areaType: null, period: false })).toMatchObject({
      range: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00.000Z' },
    });
    const series = QuerySpec.parse({ kind: 'series', elements: ['cases'], interval: 'day' });
    expect(applyParams(series, { interval: 'month' }, { areaType: null, period: false })).toMatchObject({ interval: 'month' });
    expect(applyParams(kpi, { interval: 'month' }, { areaType: null, period: false })).toEqual(kpi);
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

import { FormDefinition, formTexts, localizeForm } from '../src/forms.js';

describe('form translations', () => {
  const def = FormDefinition.parse({
    title: 'Weekly report',
    sections: [{ key: 'a', title: 'Cases', questions: [{ key: 'kind', type: 'select', label: 'Kind', options: [{ value: 'x', label: 'Ex' }] }] }],
    translations: { fr: { title: 'Rapport hebdomadaire', 'kind.label': 'Type', 'kind.option.x': 'Iks' } },
  });
  it('lists translatable texts and applies a language with fallbacks', () => {
    expect(formTexts(def).map(([k]) => k)).toEqual(['title', 'section.a', 'kind.label', 'kind.option.x']);
    const fr = localizeForm(def, 'fr');
    expect(fr.title).toBe('Rapport hebdomadaire');
    expect(fr.sections[0]!.title).toBe('Cases'); // not translated: original
    expect(fr.sections[0]!.questions[0]).toMatchObject({ label: 'Type', options: [{ value: 'x', label: 'Iks' }] });
    expect(localizeForm(def, 'es')).toBe(def);
  });
});
