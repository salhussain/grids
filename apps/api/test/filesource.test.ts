import { describe, expect, it } from 'vitest';
import { parseCsv, parseTable } from '../src/services/filesource.js';

const file = (text: string, name = 'x.csv') => ({
  bytes: new TextEncoder().encode(text),
  name,
  type: '',
});

describe('parseCsv', () => {
  it('handles quotes, embedded newlines, a BOM and CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n"l1\nl2",z')).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['l1\nl2', 'z'],
    ]);
  });
  it('guesses the delimiter', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseTable', () => {
  it('names blank and repeated headers and pads short rows', async () => {
    const t = await parseTable(file('id,,id\n1,2\n\n3,4,5\n'), {});
    expect(t.columns).toEqual(['id', 'column_2', 'id_2']);
    expect(t.rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
    ]);
  });
  it('rejects empty files, legacy .xls and broken workbooks', async () => {
    await expect(parseTable(file('\n\n'), {})).rejects.toThrow('no rows');
    await expect(
      parseTable(
        { bytes: Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0]), name: 'a.xls', type: '' },
        {},
      ),
    ).rejects.toThrow('.xlsx');
    await expect(
      parseTable({ bytes: Uint8Array.from([0x50, 0x4b, 1, 2]), name: 'a.xlsx', type: '' }, {}),
    ).rejects.toThrow();
  });
});
