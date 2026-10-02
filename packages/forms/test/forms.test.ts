import { FormDefinition } from '@grids/schema';
import { describe, expect, it } from 'vitest';
import { evalExpr, lintDefinition, parse, periodStart, references, validate } from '../src/index.js';

describe('expressions', () => {
  const a = { age: 34, sex: 'F', symptoms: ['fever', 'cough'], weight: 70, height: 1.75, note: '' };
  it.each([
    ['${age} >= 18', true],
    ['${age} >= 18 and ${sex} = \'M\'', false],
    ['${age} < 5 or ${sex} = "F"', true],
    ['not(${age} > 40)', true],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 div 4', 2.5],
    ['10 mod 4', 2],
    ['-${age} + 4', -30],
    ['selected(${symptoms}, \'fever\')', true],
    ['count-selected(${symptoms})', 2],
    ['round(${weight} / (${height} * ${height}), 1)', 22.9],
    ['if(${note} = \'\', \'none\', ${note})', 'none'],
    ['${missing} = \'\'', true],
    ['string-length(\'abc\')', 3],
    ['age(\'2000-06-15\', \'2026-06-14\')', 25],
    ['days-between(\'2026-01-01\', \'2026-01-31\')', 30],
    ['\'2026-02-01\' > \'2026-01-31\'', true],
    ['true() and true', true],
  ])('%s → %j', (src, expected) => expect(evalExpr(src, a)).toEqual(expected));

  it('supports `.` for the value being constrained', () => {
    expect(evalExpr('. >= 0 and . <= 120', {}, 130)).toBe(false);
  });

  it('reports syntax errors with positions and refuses unknown names', () => {
    expect(() => parse('${a} >')).toThrow(/end of expression/);
    expect(() => parse('constructor(1)')).toThrow(/Unknown function/);
    expect(() => parse('age')).toThrow(/use \$\{age\}/);
  });

  it('lists references', () => {
    expect(references('${a} + if(${b} > 1, ${c}, 0)').sort()).toEqual(['a', 'b', 'c']);
  });
});

const def = FormDefinition.parse({
  title: 'Weekly report',
  period: 'week',
  sections: [
    {
      key: 'cases',
      title: 'Cases',
      questions: [
        { key: 'malaria', type: 'integer', label: 'Malaria cases', required: true, min: 0, bind: { element: 'malaria_cases' } },
        { key: 'deaths', type: 'integer', label: 'Deaths', min: 0, constraint: '. <= ${malaria}', constraintMessage: 'Deaths cannot exceed cases' },
        { key: 'cfr', type: 'calculate', label: 'CFR', calculation: 'if(${malaria} > 0, round(${deaths} div ${malaria} * 100, 1), 0)' },
        { key: 'outbreak', type: 'boolean', label: 'Suspected outbreak?' },
        { key: 'details', type: 'textarea', label: 'Describe', required: true, relevant: '${outbreak} = true' },
        { key: 'kind', type: 'select', label: 'Kind', options: [{ value: 'a', label: 'A' }] },
      ],
    },
  ],
});

describe('validation', () => {
  it('requires, constrains, calculates and drops irrelevant answers', () => {
    expect(validate(def, {}).errors).toEqual({ malaria: 'Required' });
    const bad = validate(def, { malaria: 3, deaths: 5, kind: 'zzz' });
    expect(bad.errors).toEqual({ deaths: 'Deaths cannot exceed cases', kind: 'Choose one of the options' });
    const ok = validate(def, { malaria: 8, deaths: 1, outbreak: false, details: 'ignored' });
    expect(ok.ok).toBe(true);
    expect(ok.clean).toEqual({ malaria: 8, deaths: 1, cfr: 12.5, outbreak: false });
    expect(validate(def, { malaria: 2, outbreak: true }).errors).toEqual({ details: 'Required' });
    expect(validate(def, { malaria: 2.5 }).errors).toEqual({ malaria: 'Enter a whole number' });
  });

  it('lints definitions', () => {
    const broken = FormDefinition.parse({
      title: 'x',
      sections: [{ key: 's', title: 's', questions: [{ key: 'a', type: 'integer', label: 'A', relevant: '${b} > 1' }, { key: 'c', type: 'select', label: 'C' }] }],
    });
    expect(lintDefinition(broken)).toEqual(['"c" needs at least one option', '"a" relevance: unknown question ${b}']);
    expect(lintDefinition(def)).toEqual([]);
  });

  it('aligns periods', () => {
    expect(periodStart('week', new Date('2026-10-01T15:00:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(periodStart('month', new Date('2026-10-17T15:00:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
