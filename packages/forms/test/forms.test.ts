import { FormDefinition, FormSettings, RecordOptions } from '@grids/schema';
import { describe, expect, it } from 'vitest';
import { availabilityProblems, buildDocument, buildRecord, defaultAnswers, evalExpr, fillState, formState, lintDefinition, lintDocument, parse, periodStart, recordMarkdown, references, validate, zonedInstant } from '../src/index.js';

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
    expect(validate(def, {}).errors).toEqual({ malaria: 'This is a required field' });
    const bad = validate(def, { malaria: 3, deaths: 5, kind: 'zzz' });
    expect(bad.errors).toEqual({ deaths: 'Deaths cannot exceed cases', kind: 'Choose one of the options' });
    const ok = validate(def, { malaria: 8, deaths: 1, outbreak: false, details: 'ignored' });
    expect(ok.ok).toBe(true);
    expect(ok.clean).toEqual({ malaria: 8, deaths: 1, cfr: 12.5, outbreak: false });
    expect(validate(def, { malaria: 2, outbreak: true }).errors).toEqual({ details: 'This is a required field' });
    expect(validate(def, { malaria: 2.5 }).errors).toEqual({ malaria: 'Enter a whole number' });
  });

  it('handles hidden and discarded questions', () => {
    const d = FormDefinition.parse({
      title: 'T',
      sections: [
        {
          key: 's',
          title: 'S',
          questions: [
            { key: 'weight', type: 'integer', label: 'Weight', required: true },
            { key: 'band', type: 'text', label: 'Band', hidden: true, required: true, calculation: "if(${weight} > 50, 'heavy', 'light')" },
            { key: 'district', type: 'text', label: 'District', discard: true },
          ],
        },
      ],
    });
    const r = validate(d, { weight: 60, district: 'north', band: 'forged' });
    expect(r.ok).toBe(true);
    expect(r.clean).toEqual({ weight: 60, band: 'heavy' });
    expect(r.all).toEqual({ weight: 60, band: 'heavy', district: 'north' });
    expect(validate(d, {}).errors).toEqual({ weight: 'This is a required field' });
    expect(lintDefinition(FormDefinition.parse({ ...d, sections: [{ ...d.sections[0]!, questions: [{ key: 'x', type: 'text', label: 'X', hidden: true }] }] }))).toEqual([
      '"x" is hidden but has no calculation or default value, so it would always be empty',
    ]);
  });

  it('treats the questions of a hidden section as hidden', () => {
    const d = FormDefinition.parse({
      title: 'T',
      sections: [
        { key: 'a', title: 'A', questions: [{ key: 'w', type: 'integer', label: 'W', required: true }] },
        { key: 'b', title: 'B', hidden: true, questions: [{ key: 'band', type: 'text', label: 'Band', required: true, calculation: "if(${w} > 5, 'hi', 'lo')" }] },
      ],
    });
    const r = validate(d, { w: 9 });
    expect(r.ok).toBe(true);
    expect(r.clean).toEqual({ w: 9, band: 'hi' });
    expect(formState(d, { w: 9 }).shown.has('b')).toBe(false);
  });

  it('uses default values, hidden constants and custom required messages', () => {
    const d = FormDefinition.parse({
      title: 'T',
      sections: [
        {
          key: 's',
          title: 'S',
          questions: [
            { key: 'name', type: 'text', label: 'Name', required: true, requiredMessage: 'Tell us your name', placeholder: 'e.g. Ana' },
            { key: 'country', type: 'text', label: 'Country', defaultValue: 'Samoa' },
            { key: 'source', type: 'text', label: 'Source', hidden: true, defaultValue: 'mobile' },
          ],
        },
      ],
    });
    expect(defaultAnswers(d)).toEqual({ country: 'Samoa' });
    expect(validate(d, {}).errors).toEqual({ name: 'Tell us your name' });
    expect(validate(d, { name: 'Ana', source: 'forged' }).clean).toEqual({ name: 'Ana', source: 'mobile' });
    const bad = FormDefinition.parse({ ...d, sections: [{ ...d.sections[0]!, questions: [{ key: 'k', type: 'select', label: 'K', options: [{ value: 'a', label: 'A' }], defaultValue: 'z' }] }] });
    expect(lintDefinition(bad)).toEqual(['"k" has a default value that does not fit (choose one of the options)']);
  });

  it('checks times, phone numbers, emails, web addresses and ratings', () => {
    const d = FormDefinition.parse({
      title: 'T',
      sections: [
        {
          key: 's',
          title: 'S',
          questions: [
            { key: 't', type: 'time', label: 'T' },
            { key: 'p', type: 'phone', label: 'P' },
            { key: 'e', type: 'email', label: 'E' },
            { key: 'u', type: 'url', label: 'U' },
            { key: 'r', type: 'rating', label: 'R', max: 4 },
            { key: 'f', type: 'file', label: 'F' },
          ],
        },
      ],
    });
    expect(validate(d, { t: '09:30', p: '+685 123 4567', e: 'a@b.co', u: 'https://x.org/a', r: 4, f: '0190c1a0-0000-7000-8000-000000000001' }).ok).toBe(true);
    expect(validate(d, { t: '25:00', p: '12', e: 'nope', u: 'ftp://x', r: 5, f: 'abc' }).errors).toEqual({
      t: 'Enter a time',
      p: 'Enter a valid phone number',
      e: 'Enter a valid email address',
      u: 'Enter a web address starting with http:// or https://',
      r: 'Choose a rating',
      f: 'Add a file',
    });
  });

  it('validates repeating sections row by row', () => {
    const d = FormDefinition.parse({
      title: 'T',
      sections: [
        { key: 'top', title: 'Household', questions: [{ key: 'village', type: 'text', label: 'Village', required: true }, { key: 'n', type: 'calculate', label: 'N', calculation: 'count-selected(${members})' }] },
        {
          key: 'members',
          title: 'Members',
          repeat: { min: 1, max: 3 },
          questions: [
            { key: 'name', type: 'text', label: 'Name', required: true },
            { key: 'age', type: 'integer', label: 'Age', min: 0 },
            { key: 'adult', type: 'calculate', label: 'Adult', calculation: '${age} >= 18' },
            { key: 'label', type: 'calculate', label: 'Label', calculation: "${village} + ': ' + ${name}" },
            { key: 'guardian', type: 'text', label: 'Guardian', relevant: '${adult} = false' },
          ],
        },
      ],
    });
    expect(validate(d, { village: 'A' }).errors).toEqual({ members: 'Add at least one' });
    const bad = validate(d, { village: 'A', members: [{ name: 'Ana', age: 30 }, { age: -1 }] });
    expect(bad.errors).toEqual({ 'members.1.name': 'This is a required field', 'members.1.age': 'Must be at least 0' });
    const ok = validate(d, { village: 'A', members: [{ name: 'Ana', age: 30, guardian: 'x' }, { name: 'Bo', age: 7, guardian: 'Ana' }] });
    expect(ok.ok).toBe(true);
    expect(ok.clean).toEqual({
      village: 'A',
      n: 2,
      members: [
        { name: 'Ana', age: 30, adult: true },
        { name: 'Bo', age: 7, adult: false, guardian: 'Ana' },
      ],
    });
    expect(validate(d, { village: 'A', members: Array.from({ length: 4 }, () => ({ name: 'x' })) }).errors).toEqual({ members: 'Add at most 3' });
    const outside = FormDefinition.parse({ ...d, sections: [{ ...d.sections[0]!, questions: [...d.sections[0]!.questions, { key: 'peek', type: 'calculate', label: 'P', calculation: '${age}' }] }, d.sections[1]!] });
    expect(lintDefinition(outside)).toEqual(['"peek" calculation: "age" is inside a repeating section, so only questions in the same section can use it']);
  });

  it('accepts several photos or files when asked', () => {
    const d = FormDefinition.parse({ title: 'T', sections: [{ key: 's', title: 'S', questions: [{ key: 'ph', type: 'image', label: 'P', multiple: true, maxItems: 2 }] }] });
    const id = (n: number) => `0190c1a0-0000-7000-8000-00000000000${n}`;
    expect(validate(d, { ph: [id(1), id(2)] }).clean).toEqual({ ph: [id(1), id(2)] });
    expect(validate(d, { ph: [id(1), id(2), id(3)] }).errors).toEqual({ ph: 'Add at most 2' });
    expect(validate(d, { ph: id(1) }).errors).toEqual({ ph: 'Add pictures' });
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
    // 2026-10-01 is a Thursday: the week starting Sunday began on 27 September.
    expect(periodStart('week_sun', new Date('2026-10-01T15:00:00Z')).toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(periodStart('week_sun', new Date('2026-09-27T23:00:00Z')).toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(periodStart('year', new Date('2026-10-17T15:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('availability', () => {
  const settings = (a: Partial<FormSettings['availability']> = {}, l: Partial<FormSettings['limits']> = {}) =>
    FormSettings.parse({ availability: { opensAt: null, closesAt: null, timezone: 'UTC', beforeMessage: '', afterMessage: '', ...a }, limits: { maxSubmissions: null, perPerson: null, fullMessage: '', ...l } });
  const none = { total: 0, mine: 0 };

  it('reads wall-clock times in a zone, across daylight saving', () => {
    expect(zonedInstant('2026-11-30T17:00', 'UTC')!.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(zonedInstant('2026-11-30T17:00', 'Pacific/Auckland')!.toISOString()).toBe('2026-11-30T04:00:00.000Z'); // NZDT, UTC+13
    expect(zonedInstant('2026-07-01T12:00', 'America/New_York')!.toISOString()).toBe('2026-07-01T16:00:00.000Z'); // EDT
    expect(zonedInstant('2026-01-01T12:00', 'America/New_York')!.toISOString()).toBe('2026-01-01T17:00:00.000Z'); // EST
    expect(zonedInstant('nonsense', 'UTC')).toBeNull();
  });

  it('is open with no settings and says why it is not otherwise', () => {
    expect(fillState(settings(), new Date('2026-01-01T00:00:00Z'), none).state).toBe('open');
    const s = settings({ opensAt: '2026-03-01T09:00', closesAt: '2026-03-31T17:00', beforeMessage: 'Not yet!' });
    expect(fillState(s, new Date('2026-02-28T23:00:00Z'), none)).toMatchObject({ state: 'not_yet', message: 'Not yet!' });
    expect(fillState(s, new Date('2026-03-15T00:00:00Z'), none).state).toBe('open');
    const late = fillState(s, new Date('2026-04-01T00:00:00Z'), none);
    expect(late.state).toBe('closed');
    expect(late.message).toContain('closed on');
  });

  it('applies the limits', () => {
    const s = settings({}, { maxSubmissions: 10, perPerson: 2 });
    expect(fillState(s, new Date(), { total: 10, mine: 0 }).state).toBe('full');
    expect(fillState(s, new Date(), { total: 3, mine: 2 }).state).toBe('limit');
    expect(fillState(s, new Date(), { total: 3, mine: 1 }).state).toBe('open');
  });

  it('checks what the author entered', () => {
    expect(availabilityProblems(settings({ timezone: 'Not/AZone' }))).toHaveLength(1);
    expect(availabilityProblems(settings({ opensAt: '2026-03-02T09:00', closesAt: '2026-03-01T09:00' }))).toContain('The form must close after it opens');
    expect(availabilityProblems(settings({ opensAt: '2026-03-01T09:00', closesAt: '2026-03-02T09:00' }))).toEqual([]);
  });
});

describe('the default submission record', () => {
  const def = FormDefinition.parse({
    title: 'Facility visit',
    sections: [
      { key: 'visit', title: 'Visit', questions: [{ key: 'facility', type: 'text', label: 'Facility' }, { key: 'note', type: 'note', label: 'Fill this in carefully' }, { key: 'parish', type: 'text', label: 'Parish' }] },
      { key: 'findings', title: 'Findings', questions: [{ key: 'cold', type: 'boolean', label: 'Cold chain working?' }, { key: 'extra', type: 'text', label: 'Anything else?' }] },
      { key: 'households', title: 'Households', repeat: { itemLabel: 'Household' }, questions: [{ key: 'size', type: 'integer', label: 'People' }] },
    ],
  });
  const data = { values: { facility: 'Delai', parish: 'St. Andrew', cold: true, households: [{ size: 4 }, { size: 2 }] }, details: { _submitted_by: 'Ana', _submitted_at: '4 Mar 2026', _status: 'Approved' } };
  const cells = (d: ReturnType<typeof buildRecord>) => d.blocks.flatMap((b) => (b.kind === 'table' ? b.rows.map((r) => r.map((c) => c.map((x) => x.text).join(''))) : []));
  const headings = (d: ReturnType<typeof buildRecord>) => d.blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.runs[0]!.text : ''));
  const all = RecordOptions.parse({});
  const opts = (o: object) => RecordOptions.parse(o);

  it('lists the questions that were answered, under their sections, and skips notes', () => {
    const d = buildRecord(def, data, all);
    expect(headings(d)).toEqual(['Facility visit', 'Visit', 'Findings', 'Households', 'Household 1', 'Household 2']);
    expect(cells(d)).toEqual([['Facility', 'Delai'], ['Parish', 'St. Andrew'], ['Cold chain working?', 'Yes'], ['People', '4'], ['People', '2']]);
    expect(d.blocks[1]).toMatchObject({ kind: 'paragraph' });
  });

  it('shows what was not answered when asked, and drops the headings and the details line when told to', () => {
    expect(cells(buildRecord(def, data, opts({ blank: true })))).toContainEqual(['Anything else?', 'No answer']);
    const flat = buildRecord(def, data, opts({ group: false, details: false }));
    expect(headings(flat)).toEqual(['Facility visit', 'Households', 'Household 1', 'Household 2']);
    expect(flat.blocks[1]).toMatchObject({ kind: 'table' });
    expect(cells(flat).slice(0, 3)).toEqual([['Facility', 'Delai'], ['Parish', 'St. Andrew'], ['Cold chain working?', 'Yes']]);
  });

  it('has an editable twin that is a valid document', () => {
    const md = recordMarkdown(def, all);
    expect(lintDocument({ name: 'Copy', body: md, header: '', footer: '' }, def)).toEqual([]);
    const built = buildDocument({ body: md, header: '', footer: '' }, def, data);
    expect(built.blocks.some((b) => b.kind === 'table')).toBe(true);
    expect(md).toContain('[[each households]]');
  });

  const withNotes = FormDefinition.parse({
    title: 'Clinic check',
    description: 'Fill this in on the day of the visit.',
    sections: [{ key: 'a', title: 'Basics', questions: [{ key: 'name', type: 'text', label: 'Name', hint: 'As on the sign' }, { key: 'n1', type: 'note', label: 'Take the temperature first' }, { key: 'temp', type: 'integer', label: 'Temperature' }] }],
  });
  const wd = { values: { name: 'Delai', temp: 37 }, details: { _project_name: 'Island health' } };

  it('can show the form as it appears: each question with its answer in order, with colours, a title block and notes', () => {
    const d = buildRecord(withNotes, { ...wd, accent: '#0e7c66' }, opts({ layout: 'form', colors: true, notes: true, details: false }));
    expect(d.blocks.map((b) => b.kind)).toEqual(['paragraph', 'heading', 'paragraph', 'heading', 'field', 'note', 'field']);
    expect(d.blocks[1]).toMatchObject({ kind: 'heading', level: 1, fill: '#0e7c66' });
    expect(d.blocks[4]).toMatchObject({ kind: 'field', hint: [{ text: 'As on the sign' }], shade: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect(d.blocks[5]).toMatchObject({ kind: 'note', runs: [{ text: 'Take the temperature first' }] });
  });

  it('can leave out the colours, the title block and the notes', () => {
    const d = buildRecord(withNotes, wd, opts({ layout: 'form', header: false, details: false }));
    expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'field', 'field']);
    expect(d.blocks[0]).not.toHaveProperty('fill');
    expect(d.blocks[1]).not.toHaveProperty('hint');
    expect(d.blocks[1]).not.toHaveProperty('shade');
  });

  it('places answers where they were put, and nothing else', () => {
    const d = buildDocument({ body: 'ignored', header: 'ignored', footer: 'ignored', mode: 'placed', fields: [{ id: 'f1', key: 'name', x: 10, y: 20, width: 40, size: 14, align: 'left', bold: true }] }, withNotes, wd);
    expect(d.mode).toBe('placed');
    expect(d.blocks).toEqual([]);
    expect(d.placed).toEqual([{ id: 'f1', x: 10, y: 20, width: 40, size: 14, align: 'left', bold: true, runs: [{ text: 'Delai' }] }]);
    expect(lintDocument({ name: 'X', body: '', header: '', footer: '', fields: [{ id: 'f', key: 'nope', x: 0, y: 0, width: 10, size: 10, align: 'left', bold: false }] }, withNotes)).toHaveLength(1);
  });
});
