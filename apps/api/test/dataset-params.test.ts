import { describe, expect, it } from 'vitest';
import { fillParams, paramValues } from '../src/services/dataset-params.js';

// How a query takes its parameters: `:name`, or `{{ name }}`, put in as plain values that cannot change the query.
const params = [
  { name: 'district', label: 'District', type: 'text' as const, default: 'North' },
  { name: 'minimum', label: 'Minimum', type: 'number' as const, default: '5' },
];
const fill = (sql: string, given: Record<string, string> = {}) => fillParams(sql, params, paramValues(params, given));

describe('parameters in SQL', () => {
  it('fill :name and {{ name }} alike', () => {
    expect(fill('select * from t where district = :district and n >= :minimum')).toBe("select * from t where district = 'North' and n >= 5");
    expect(fill('select * from t where district = {{ district }}')).toBe("select * from t where district = 'North'");
    expect(fill('where d = :district', { district: 'South' })).toBe("where d = 'South'");
  });

  it('leave alone what only looks like one', () => {
    // A cast, a slice, a string, a quoted name, a comment, a name that is not a parameter.
    expect(fill('select n::text, a[1:n], b[x:y] from t')).toBe('select n::text, a[1:n], b[x:y] from t');
    expect(fill("select ':district' as s, \":district\" from t")).toBe("select ':district' as s, \":district\" from t");
    expect(fill('select 1 -- :district\n, 2 /* :minimum */')).toBe('select 1 -- :district\n, 2 /* :minimum */');
    expect(fill('select time \'10:30\', :other from t')).toBe("select time '10:30', :other from t");
    expect(fill('select x::int where d = :district')).toBe("select x::int where d = 'North'");
  });

  it('keep a value a value', () => {
    expect(fill('where d = :district', { district: "x' or '1'='1" })).toBe("where d = 'x'' or ''1''=''1'");
    // A value that looks like a parameter is not filled in again.
    expect(fill('where a = :district and b = :minimum', { district: ':minimum' })).toBe("where a = ':minimum' and b = 5");
    expect(() => fill('where d = :district', { district: 'a\\' })).toThrow(/backslash/);
    expect(() => fill('where d = :minimum', { minimum: 'abc' })).toThrow(/number/);
  });

  it('still refuse {{ name }} that is not a parameter', () => {
    expect(() => fill('where d = {{ nope }}')).toThrow(/not a parameter/);
  });
});
