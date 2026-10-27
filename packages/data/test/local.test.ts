import { describe, expect, it } from 'vitest';
import { assertReadOnly, columnType, runLocalQuery } from '../src/index.js';

const opts = { limit: 100, timeoutMs: 10_000 };

describe('local SQL engine', () => {
  it('aggregates rows with inferred types', async () => {
    const r = await runLocalQuery(
      [
        {
          name: 'visits',
          rows: [
            { district: 'North', cases: '12', day: '2024-01-01', ok: 'true', id: '007' },
            { district: 'North', cases: 8, day: '2024-01-02', ok: false, id: '008' },
            { district: 'South', cases: '', day: '2024-01-03', ok: 'true', id: '009' },
          ],
        },
      ],
      'select district, sum(cases) as total, count(*) as n, min(day) as first_day from visits group by district order by district;',
      opts,
    );
    expect(r.rows).toEqual([
      { district: 'North', total: 20, n: 2, first_day: '2024-01-01' },
      { district: 'South', total: null, n: 1, first_day: '2024-01-03' },
    ]);
    expect(r.columns.map((c) => c.name)).toEqual(['district', 'total', 'n', 'first_day']);
    expect(r.truncated).toBe(false);
  });

  it('joins several tables and keeps text ids as text', async () => {
    const r = await runLocalQuery(
      [
        { name: 'a', rows: [{ id: '007', v: 1 }] },
        { name: 'b', rows: [{ id: '007', w: 'x' }] },
      ],
      'select a.id, v, w from a join b using (id)',
      opts,
    );
    expect(r.rows).toEqual([{ id: '007', v: 1, w: 'x' }]);
  });

  it('truncates to the limit', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ n: i }));
    const r = await runLocalQuery([{ name: 't', rows }], 'select * from t order by n', { ...opts, limit: 10 });
    expect(r.rows).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('cannot reach files, the network or other statements', async () => {
    const t = [{ name: 't', rows: [{ n: 1 }] }];
    await expect(runLocalQuery(t, "select * from read_csv('/etc/passwd')", opts)).rejects.toThrow();
    await expect(runLocalQuery(t, "select * from read_text('/etc/hosts')", opts)).rejects.toThrow();
    await expect(runLocalQuery(t, 'select 1; select 2', opts)).rejects.toThrow();
    await expect(runLocalQuery(t, 'drop table t', opts)).rejects.toThrow(/read-only|Only SELECT/);
    await expect(runLocalQuery(t, "copy t to '/tmp/x.csv'", opts)).rejects.toThrow();
  });

  it('reports SQL errors', async () => {
    await expect(runLocalQuery([{ name: 't', rows: [{ n: 1 }] }], 'select nope from t', opts)).rejects.toThrow(/nope/);
  });
});

describe('read-only guard', () => {
  it.each(['select 1', 'with a as (select 1) select * from a', '  SELECT * FROM t;', "select 'drop table x' as s", '-- hi\nselect "delete" from t', 'select replace(a, \'x\', \'y\') from t'])('allows %s', (s) =>
    expect(() => assertReadOnly(s)).not.toThrow(),
  );
  it.each(['delete from t', 'select 1; drop table t', 'insert into t values (1)', 'select * into x from t', 'update t set a = 1', 'create table x as select 1', 'call p()', ''])(
    'rejects %s',
    (s) => expect(() => assertReadOnly(s)).toThrow(),
  );
});

describe('column types', () => {
  it('picks the narrowest type', () => {
    expect(columnType(['1', 2, null])).toBe('BIGINT');
    expect(columnType(['1.5', 2])).toBe('DOUBLE');
    expect(columnType(['2024-01-01'])).toBe('DATE');
    expect(columnType(['2024-01-01T10:00:00Z', '2024-01-02'])).toBe('TIMESTAMP');
    expect(columnType(['007', '1'])).toBe('VARCHAR');
    expect(columnType(['a', 1])).toBe('VARCHAR');
  });
});
