import { dashboard, elements, entities, form, monthStart, observations, rng, types, type TemplateCtx, type Tx } from './kit.js';

const OFFICES = [
  { code: 'HQ', name: 'Head office', region: 'Central', lon: 178.44, lat: -18.14, target: 22 },
  { code: 'WST', name: 'Western regional office', region: 'Western', lon: 177.45, lat: -17.62, target: 12 },
  { code: 'NTH', name: 'Northern regional office', region: 'Northern', lon: 179.34, lat: -16.43, target: 10 },
  { code: 'EST', name: 'Eastern field office', region: 'Eastern', lon: 178.82, lat: -18.66, target: 7 },
  { code: 'LAB', name: 'Field laboratory', region: 'Central', lon: 178.6, lat: -17.9, target: 6 },
] as const;
const DEPARTMENTS = ['Programs', 'Operations', 'Finance', 'People & culture', 'IT', 'Monitoring & evaluation'] as const;
const POSITIONS: Record<(typeof DEPARTMENTS)[number], string[]> = {
  Programs: ['Program officer', 'Senior program officer', 'Program manager', 'Community liaison'],
  Operations: ['Logistics officer', 'Driver', 'Operations coordinator', 'Administrator'],
  Finance: ['Accountant', 'Finance officer', 'Finance manager'],
  'People & culture': ['HR officer', 'HR business partner'],
  IT: ['Systems administrator', 'Data engineer', 'Support technician'],
  'Monitoring & evaluation': ['M&E officer', 'Data analyst', 'Research associate'],
};
const GIVEN = ['Ana', 'Sione', 'Mere', 'Joseph', 'Priya', 'Tomasi', 'Litia', 'Rajesh', 'Salote', 'Viliami', 'Grace', 'Epeli', 'Sera', 'Daniel', 'Losana', 'Arjun', 'Akanisi', 'Paula', 'Mosese', 'Kirti'];
const FAMILY = ['Tuilagi', 'Kaufusi', 'Narayan', 'Waqa', 'Taufa', 'Lal', 'Vunibola', 'Fifita', 'Prasad', 'Ratu', 'Havili', 'Singh', 'Koroi', 'Mahe', 'Chand', 'Tamani'];

/**
 * P2: HR & workforce. Offices with their staff (employees as entities), monthly
 * leave, training and overtime, forms for leave requests, training records and
 * staff changes, and a workforce dashboard.
 */
export async function hrWorkforce(tx: Tx, c: TemplateCtx, now = new Date()) {
  await types(tx, c, [
    {
      key: 'office',
      name: 'Office',
      plural: 'Offices',
      icon: 'building-2',
      color: '#8a3ffc',
      geometry: 'point',
      attributes: [
        { key: 'region', label: 'Region', type: 'select', options: ['Central', 'Western', 'Northern', 'Eastern'], summary: true },
        { key: 'headcount_target', label: 'Approved positions', type: 'integer', summary: true },
        { key: 'address', label: 'Address', type: 'text' },
      ],
    },
    {
      key: 'employee',
      name: 'Employee',
      plural: 'Employees',
      icon: 'user-round',
      color: '#1192e8',
      geometry: 'none',
      parentTypes: ['office'],
      attributes: [
        { key: 'position', label: 'Position', type: 'text', summary: true, required: true },
        { key: 'department', label: 'Department', type: 'select', options: [...DEPARTMENTS], summary: true, required: true },
        { key: 'grade', label: 'Grade', type: 'select', options: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] },
        { key: 'employment_type', label: 'Employment type', type: 'select', options: ['Permanent', 'Fixed-term', 'Casual', 'Volunteer'] },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Another identity', 'Prefer not to say'] },
        { key: 'start_date', label: 'Start date', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'On leave', 'Exited'], summary: true, required: true },
        { key: 'email', label: 'Work email', type: 'email' },
      ],
    },
  ]);
  await elements(tx, c, [
    { key: 'leave_days', name: 'Leave taken', unit: 'days', aggregation: 'sum' },
    { key: 'training_hours', name: 'Training', unit: 'hours', aggregation: 'sum' },
    { key: 'overtime_hours', name: 'Overtime', unit: 'hours', aggregation: 'sum' },
    { key: 'performance_score', name: 'Performance score', description: '1 (needs improvement) – 5 (outstanding)', aggregation: 'avg' },
  ]);
  await entities(
    tx,
    c,
    'office',
    OFFICES.map((o) => ({ code: o.code, name: o.name, attributes: { region: o.region, headcount_target: o.target }, geometry: { type: 'Point', coordinates: [o.lon, o.lat] } })),
  );

  const r = rng(424242);
  const staff = OFFICES.flatMap((o) =>
    Array.from({ length: o.target - r.int(0, 3) }, (_, i) => {
      const department = o.code === 'LAB' ? 'Monitoring & evaluation' : i === 0 ? 'Operations' : r.pick(DEPARTMENTS);
      const given = r.pick(GIVEN);
      const family = r.pick(FAMILY);
      const start = new Date(Date.UTC(now.getUTCFullYear() - r.int(0, 9), r.int(0, 11), r.int(1, 28)));
      const exited = r.next() < 0.06;
      return {
        code: `E${String(1000 + r.int(0, 8999))}-${o.code}${i}`,
        name: `${given} ${family}`,
        parentCode: o.code,
        attributes: {
          position: r.pick(POSITIONS[department]),
          department,
          grade: `G${r.int(1, 6)}`,
          employment_type: r.next() < 0.7 ? 'Permanent' : r.pick(['Fixed-term', 'Casual', 'Volunteer']),
          gender: r.next() < 0.52 ? 'Female' : r.next() < 0.96 ? 'Male' : 'Another identity',
          start_date: start.toISOString().slice(0, 10),
          status: exited ? 'Exited' : r.next() < 0.08 ? 'On leave' : 'Active',
          email: `${given}.${family}`.toLowerCase() + '@example.org',
        },
      };
    }),
  );
  const created = await entities(tx, c, 'employee', staff);

  const items: { entityId: string; element: string; at: Date; value: number }[] = [];
  for (const e of staff) {
    if (e.attributes.status === 'Exited') continue;
    const id = created.ids.get(e.code)!;
    for (let m = 5; m >= 0; m--) {
      const at = monthStart(now, m);
      if (r.next() < 0.45) items.push({ entityId: id, element: 'leave_days', at, value: r.int(1, 6) });
      if (r.next() < 0.35) items.push({ entityId: id, element: 'training_hours', at, value: r.pick([2, 4, 8, 16, 24]) });
      if (r.next() < 0.3) items.push({ entityId: id, element: 'overtime_hours', at, value: r.int(2, 18) });
    }
    items.push({ entityId: id, element: 'performance_score', at: monthStart(now, 3), value: r.pick([3, 3, 4, 4, 4, 5, 2]) });
  }
  await observations(tx, c, items);

  await form(tx, c, {
    key: 'leave_request',
    name: 'Leave request',
    subjectType: 'employee',
    definition: {
      title: 'Leave request',
      period: 'month',
      sections: [
        {
          key: 'leave',
          title: 'Leave',
          questions: [
            { key: 'leave_type', type: 'select', label: 'Type of leave', required: true, options: [{ value: 'annual', label: 'Annual' }, { value: 'sick', label: 'Sick' }, { value: 'family', label: 'Family / carer' }, { value: 'study', label: 'Study' }, { value: 'unpaid', label: 'Unpaid' }] },
            { key: 'start', type: 'date', label: 'First day', required: true },
            { key: 'end', type: 'date', label: 'Last day', required: true, constraint: ". >= ${start}", constraintMessage: 'The last day must be on or after the first day' },
            { key: 'days', type: 'calculate', label: 'Working days (approx.)', calculation: "if(${start} != '' and ${end} != '', round((days-between(${start}, ${end}) + 1) * 5 div 7), 0)", bind: { element: 'leave_days' } },
            { key: 'certificate', type: 'boolean', label: 'Medical certificate attached?', relevant: "${leave_type} = 'sick' and ${days} > 2", required: true },
            { key: 'notes', type: 'textarea', label: 'Notes for your manager' },
          ],
        },
      ],
    },
  });
  await form(tx, c, {
    key: 'training_record',
    name: 'Training record',
    subjectType: 'employee',
    definition: {
      title: 'Training record',
      period: 'month',
      sections: [
        {
          key: 'training',
          title: 'Training',
          questions: [
            { key: 'course', type: 'text', label: 'Course or workshop', required: true },
            { key: 'provider', type: 'select', label: 'Provider', options: [{ value: 'internal', label: 'Internal' }, { value: 'external', label: 'External' }, { value: 'online', label: 'Online' }] },
            { key: 'hours', type: 'decimal', label: 'Hours', required: true, min: 0.5, max: 200, bind: { element: 'training_hours' } },
            { key: 'certified', type: 'boolean', label: 'Certificate awarded?' },
          ],
        },
      ],
    },
  });
  await form(tx, c, {
    key: 'staff_change',
    name: 'Staff change',
    description: 'Promotions, transfers within the office, leave status and exits.',
    subjectType: 'employee',
    definition: {
      title: 'Staff change',
      sections: [
        {
          key: 'change',
          title: 'Change',
          questions: [
            { key: 'position', type: 'text', label: 'Position', bind: { attribute: 'position' } },
            { key: 'grade', type: 'select', label: 'Grade', bind: { attribute: 'grade' }, options: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].map((g) => ({ value: g, label: g })) },
            { key: 'status', type: 'select', label: 'Status', required: true, bind: { attribute: 'status' }, options: ['Active', 'On leave', 'Exited'].map((s) => ({ value: s, label: s })) },
            { key: 'reason', type: 'textarea', label: 'Reason', required: true, relevant: "${status} = 'Exited'" },
          ],
        },
      ],
    },
  });

  await dashboard(tx, c, {
    key: 'workforce',
    name: 'Workforce',
    description: 'Headcount, composition, leave and training across offices.',
    widgets: [
      { id: 'headcount', type: 'kpi', title: 'Active staff', w: 3, h: 1, query: { kind: 'kpi', entityType: 'employee', where: { attribute: 'status', equals: 'Active' } } },
      { id: 'on_leave', type: 'kpi', title: 'On leave', w: 3, h: 1, query: { kind: 'kpi', entityType: 'employee', where: { attribute: 'status', equals: 'On leave' } } },
      { id: 'training', type: 'kpi', title: 'Training hours (90 days)', w: 3, h: 1, query: { kind: 'kpi', element: 'training_hours', range: { lastHours: 24 * 90 }, compare: true } },
      { id: 'leave', type: 'kpi', title: 'Leave days (30 days)', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', element: 'leave_days', range: { lastHours: 24 * 31 }, compare: true } },
      { id: 'by_office', type: 'bar', title: 'Staff by office', w: 6, h: 3, options: { horizontal: true }, query: { kind: 'breakdown', entityType: 'employee', by: 'parent' } },
      { id: 'gender', type: 'pie', title: 'Gender', w: 3, h: 3, query: { kind: 'breakdown', entityType: 'employee', by: 'attribute', attribute: 'gender' } },
      { id: 'employment', type: 'pie', title: 'Employment type', w: 3, h: 3, query: { kind: 'breakdown', entityType: 'employee', by: 'attribute', attribute: 'employment_type' } },
      { id: 'departments', type: 'bar', title: 'Staff by department', w: 6, h: 3, query: { kind: 'breakdown', entityType: 'employee', by: 'attribute', attribute: 'department' } },
      { id: 'monthly', type: 'line', title: 'Leave, training and overtime per month', w: 6, h: 3, query: { kind: 'series', elements: ['leave_days', 'training_hours', 'overtime_hours'], interval: 'month', range: { lastHours: 24 * 186 } } },
      { id: 'offices', type: 'map', title: 'Offices', w: 5, h: 3, options: { labelAttribute: 'region' }, query: { kind: 'geo', entityType: 'office' } },
      { id: 'staff', type: 'table', title: 'Staff directory', w: 7, h: 3, query: { kind: 'table', entityType: 'employee', columns: ['name', 'position', 'department', 'parent', 'status'], limit: 100 } },
    ],
  });
}
