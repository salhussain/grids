import { FormDefinition } from '@grids/schema';
import { describe, expect, it } from 'vitest';
import { buildDocument, documentToHtml, formatAnswer, lintDocument } from '../src/index.js';

const def = FormDefinition.parse({
  title: 'Payments',
  sections: [
    {
      key: 'main',
      title: 'Payer',
      questions: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'kind', type: 'select', label: 'Kind', options: [{ value: 'a', label: 'Annual fee' }, { value: 'b', label: 'Late fee' }] },
        { key: 'paid', type: 'boolean', label: 'Paid' },
        { key: 'due', type: 'date', label: 'Due' },
      ],
    },
    {
      key: 'items',
      title: 'Items',
      repeat: {},
      questions: [
        { key: 'what', type: 'text', label: 'What' },
        { key: 'cost', type: 'decimal', label: 'Cost' },
      ],
    },
  ],
});

const data = {
  values: { name: 'Ana', kind: 'a', paid: false, due: '2026-03-04', items: [{ what: 'Pens', cost: 4.5 }, { what: 'Paper', cost: 10 }] },
  details: { _submitted_at: '4 Mar 2026, 10:00', _submitted_by: 'Bo', _form_name: 'Payments' },
};

describe('documents', () => {
  it('formats answers as people read them', () => {
    expect(formatAnswer(def.sections[0]!.questions[1], 'b')).toBe('Late fee');
    expect(formatAnswer(def.sections[0]!.questions[2], true)).toBe('Yes');
    expect(formatAnswer(def.sections[0]!.questions[3], '2026-03-04')).toBe('4 Mar 2026');
    expect(formatAnswer(undefined, null)).toBe('');
  });

  it('fills a template, with bold, lists and details of the submission', () => {
    const d = buildDocument({ header: '${_form_name}', footer: 'Sent by ${_submitted_by}', body: '# Notice\n\nDear **${name}**,\nyour ${kind} is due ${due}. Paid: ${paid}.\n\n- Submitted ${_submitted_at}\n- Ref' }, def, data);
    expect(d.header).toEqual([{ text: 'Payments' }]);
    expect(d.footer.map((r) => r.text).join('')).toBe('Sent by Bo');
    expect(d.blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(d.blocks[1]).toMatchObject({ kind: 'paragraph' });
    const para = d.blocks[1] as { lines: { text: string; bold?: boolean }[][] };
    expect(para.lines[0]!.find((r) => r.bold)?.text).toBe('Ana');
    expect(para.lines[1]!.map((r) => r.text).join('')).toBe('your Annual fee is due 4 Mar 2026. Paid: No.');
    expect(d.blocks[2]).toMatchObject({ kind: 'list', ordered: false });
  });

  it('repeats blocks and table rows for a repeating section', () => {
    const d = buildDocument(
      { header: '', footer: '', body: '[[each items]]\n${_row}. ${what}: ${cost}\n[[end]]\n\n| Item | Cost |\n|---|---|\n[[each items]]| ${what} | ${cost} |' },
      def,
      data,
    );
    const lines = d.blocks.filter((b) => b.kind === 'paragraph').map((b) => (b as { lines: { text: string }[][] }).lines[0]!.map((r) => r.text).join(''));
    expect(lines).toEqual(['1. Pens: 4.5', '2. Paper: 10']);
    const table = d.blocks.find((b) => b.kind === 'table') as { header: unknown[]; rows: { text: string }[][][] };
    expect(table.header).toHaveLength(2);
    expect(table.rows.map((r) => r.map((c) => c.map((x) => x.text).join('')))).toEqual([['Pens', '4.5'], ['Paper', '10']]);
  });

  it('draws a preview that never lets answers become markup', () => {
    const html = documentToHtml(buildDocument({ header: '', footer: '', body: 'Hello ${name}' }, def, { ...data, values: { name: '<script>x</script>' } }));
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('finds what is wrong with a template', () => {
    expect(lintDocument({ name: 'N', header: '', footer: '', body: 'Hi ${nope}\n[[each name]]\nx' }, def)).toEqual([
      'N: unknown question ${nope}',
      'N: "name" is not a repeating section, so it cannot be repeated',
      'N: every [[each …]] needs an [[end]] after it',
    ]);
    expect(lintDocument({ name: 'N', header: '', footer: '', body: '[[each items]]\n${what} ${_row} ${_submitted_at}\n[[end]]' }, def)).toEqual([]);
  });
});
