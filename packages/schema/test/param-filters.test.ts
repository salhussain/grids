import { describe, expect, it } from 'vitest';
import { columnConditions, filterFromParam, type DatasetParam } from '../src/index.js';

const p = (over: Partial<DatasetParam>): DatasetParam => ({ name: 'x', label: '', type: 'text', default: '', ...over });

describe('a dataset parameter as a dashboard filter', () => {
  it('is nothing until the parameter stands for a column', () => {
    expect(filterFromParam(p({}), 'ds')).toBeNull();
  });
  it('starts a text filter at the default, unless that default means "everything"', () => {
    expect(filterFromParam(p({ name: 'country', label: 'Country', column: 'country', default: 'Barbados' }), 'ds')).toMatchObject({ kind: 'select', column: 'country', label: 'Country', param: 'country', default: 'Barbados', mode: 'rows' });
    expect(filterFromParam(p({ name: 'country', column: 'country', default: 'All', any: 'All' }), 'ds')?.default).toBeUndefined();
  });
  it('turns a date into the start (or end) of a date range', () => {
    expect(filterFromParam(p({ type: 'date', column: 'day', default: '2026-09-01' }), 'ds')).toMatchObject({ kind: 'date', part: 'from', default: { from: '2026-09-01' } });
    expect(filterFromParam(p({ type: 'date', column: 'day', default: '2026-09-30', compare: 'at_most' }), 'ds')).toMatchObject({ kind: 'date', part: 'to', default: { to: '2026-09-30' } });
  });
  it('turns a number into the low (or high) end of a range', () => {
    expect(filterFromParam(p({ type: 'number', column: 'visits', default: '60' }), 'ds')).toMatchObject({ kind: 'range', part: 'min', default: { min: 60 } });
    expect(filterFromParam(p({ type: 'number', column: 'visits', default: '200', compare: 'at_most' }), 'ds')).toMatchObject({ kind: 'range', part: 'max', default: { max: 200 } });
  });
  it('filters the stored rows from where it starts', () => {
    const f = [filterFromParam(p({ type: 'number', column: 'visits', default: '60' }), 'ds')!, filterFromParam(p({ name: 'c', column: 'country', default: 'Barbados' }), 'ds')!];
    expect(columnConditions(f, {}, 'ds')).toEqual([{ op: 'range', column: 'visits', min: 60 }, { op: 'in', column: 'country', values: ['Barbados'] }]);
    // A viewer clearing one removes only that one.
    expect(columnConditions(f, { [f[0]!.id]: null }, 'ds')).toEqual([{ op: 'in', column: 'country', values: ['Barbados'] }]);
  });
});
