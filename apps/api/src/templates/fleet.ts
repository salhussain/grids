import { DEFAULT_WORK_STATES, uuidv7 } from '@grids/schema';
import { insertWork } from '../services/work.js';
import { dashboard, elements, entities, form, monthStart, observations, rng, types, type TemplateCtx, type Tx } from './kit.js';

const DEPOTS = [
  { code: 'SUVA', name: 'Suva depot', lon: 178.44, lat: -18.14 },
  { code: 'LTK', name: 'Lautoka depot', lon: 177.45, lat: -17.62 },
  { code: 'LAB', name: 'Labasa depot', lon: 179.38, lat: -16.43 },
] as const;
const MODELS = [
  ['Toyota', 'Hilux', 'Diesel'],
  ['Toyota', 'Land Cruiser', 'Diesel'],
  ['Isuzu', 'D-Max', 'Diesel'],
  ['Mitsubishi', 'Triton', 'Diesel'],
  ['Toyota', 'Corolla', 'Petrol'],
  ['Hino', '300 truck', 'Diesel'],
  ['Yamaha', 'AG200 motorbike', 'Petrol'],
] as const;
const GIVEN = ['Ana', 'Sione', 'Mere', 'Joseph', 'Priya', 'Tomasi', 'Litia', 'Rajesh', 'Epeli', 'Sera'];
const FAMILY = ['Tuilagi', 'Kaufusi', 'Narayan', 'Waqa', 'Taufa', 'Lal', 'Vunibola', 'Ratu'];
const DEFECTS = ['Brakes feel soft', 'Warning light on the dashboard', 'Windscreen cracked', 'Tyre worn on the rear left', 'Air conditioning not cooling', 'Strange noise from the engine'];
const DAY = 86_400_000;

/**
 * A fleet: depots, vehicles and drivers; trip, fuel and inspection forms that keep each vehicle's odometer current;
 * maintenance that comes round by date and by distance (as work items, opened on their own); defects reported by
 * drivers become repair work. Distance, fuel and cost are tracked monthly.
 */
export async function fleet(tx: Tx, c: TemplateCtx, now = new Date()) {
  await types(tx, c, [
    {
      key: 'depot',
      name: 'Depot',
      plural: 'Depots',
      icon: 'warehouse',
      color: '#8a3ffc',
      geometry: 'point',
      marker: { style: 'pin' },
      attributes: [{ key: 'address', label: 'Address', type: 'text' }],
    },
    {
      key: 'vehicle',
      name: 'Vehicle',
      plural: 'Vehicles',
      icon: 'truck',
      color: '#0f62fe',
      geometry: 'point',
      marker: { style: 'icon' },
      parentTypes: ['depot'],
      attributes: [
        { key: 'registration', label: 'Registration', type: 'text', summary: true, required: true },
        { key: 'make', label: 'Make', type: 'text' },
        { key: 'model', label: 'Model', type: 'text', summary: true },
        { key: 'year', label: 'Year', type: 'integer' },
        { key: 'fuel_type', label: 'Fuel', type: 'select', options: ['Diesel', 'Petrol', 'Electric', 'Hybrid'] },
        { key: 'status', label: 'Status', type: 'select', options: ['Available', 'In use', 'In the workshop', 'Retired'], summary: true, required: true },
        { key: 'odometer', label: 'Odometer (km)', type: 'integer', summary: true },
        { key: 'registration_expiry', label: 'Registration expires', type: 'date' },
      ],
    },
    {
      key: 'driver',
      name: 'Driver',
      plural: 'Drivers',
      icon: 'user-round',
      color: '#007d79',
      geometry: 'none',
      parentTypes: ['depot'],
      attributes: [
        { key: 'licence_no', label: 'Licence number', type: 'text' },
        { key: 'licence_class', label: 'Licence class', type: 'select', options: ['Car', 'Truck', 'Motorbike'] },
        { key: 'licence_expiry', label: 'Licence expires', type: 'date', summary: true },
        { key: 'phone', label: 'Phone', type: 'phone' },
      ],
    },
  ]);
  await elements(tx, c, [
    { key: 'distance_km', name: 'Distance driven', unit: 'km', aggregation: 'sum' },
    { key: 'fuel_litres', name: 'Fuel', unit: 'litres', aggregation: 'sum' },
    { key: 'fuel_cost', name: 'Fuel cost', unit: '$', aggregation: 'sum' },
  ]);
  for (const k of [
    { key: 'maintenance', name: 'Maintenance', description: 'Planned servicing and checks.', icon: 'wrench', color: '#007d79', prefix: 'MNT', sla: { resolveHours: { urgent: 24, high: 72, normal: 24 * 14, low: 24 * 30 } } },
    { key: 'repair', name: 'Repair', description: 'Something broken or unsafe.', icon: 'hammer', color: '#da1e28', prefix: 'RPR', sla: { respondHours: { urgent: 2, high: 8, normal: 24, low: 72 }, resolveHours: { urgent: 24, high: 72, normal: 24 * 7, low: 24 * 21 } } },
  ])
    await tx.insertInto('work_type').values({ id: uuidv7(), tenant_id: c.tenantId, project_id: c.projectId, key: k.key, name: k.name, description: k.description, icon: k.icon, color: k.color, prefix: k.prefix, states: JSON.stringify(DEFAULT_WORK_STATES), sla: JSON.stringify(k.sla) }).execute();

  await entities(tx, c, 'depot', DEPOTS.map((d) => ({ code: d.code, name: d.name, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })));

  const r = rng(90210);
  const vehicles = Array.from({ length: 14 }, (_, i) => {
    const depot = DEPOTS[i % DEPOTS.length]!;
    const [make, model, fuel_type] = r.pick(MODELS);
    const year = now.getUTCFullYear() - r.int(0, 9);
    const odometer = r.int(8, 190) * 1000 + r.int(0, 999);
    const status = i === 4 ? 'In the workshop' : i === 13 ? 'Retired' : r.next() < 0.4 ? 'In use' : 'Available';
    return {
      code: `V${String(i + 1).padStart(2, '0')}`,
      name: `${make} ${model} ${i + 1}`,
      parentCode: depot.code,
      geometry: { type: 'Point' as const, coordinates: [depot.lon + (r.next() - 0.5) * 0.05, depot.lat + (r.next() - 0.5) * 0.05] },
      attributes: {
        registration: `${r.pick(['FB', 'GK', 'HN', 'JD'])} ${r.int(100, 999)}`,
        make,
        model,
        year,
        fuel_type,
        status,
        odometer,
        registration_expiry: new Date(now.getTime() + r.int(-20, 330) * DAY).toISOString().slice(0, 10),
      },
    };
  });
  const made = await entities(tx, c, 'vehicle', vehicles);
  await entities(
    tx,
    c,
    'driver',
    Array.from({ length: 9 }, (_, i) => ({
      code: `D${String(i + 1).padStart(2, '0')}`,
      name: `${GIVEN[i % GIVEN.length]} ${r.pick(FAMILY)}`,
      parentCode: DEPOTS[i % DEPOTS.length]!.code,
      attributes: {
        licence_no: `L${r.int(100000, 999999)}`,
        licence_class: r.pick(['Car', 'Car', 'Truck', 'Motorbike']),
        licence_expiry: new Date(now.getTime() + r.int(-10, 700) * DAY).toISOString().slice(0, 10),
        phone: `+679 9${r.int(100000, 999999)}`,
      },
    })),
  );

  const items: { entityId: string; element: string; at: Date; value: number }[] = [];
  for (const v of vehicles) {
    if (v.attributes.status === 'Retired') continue;
    const id = made.ids.get(v.code)!;
    for (let m = 5; m >= 0; m--) {
      const at = monthStart(now, m);
      const km = r.int(300, 3200);
      const litres = Math.round(km * (v.attributes.make === 'Hino' ? 0.22 : 0.11) + r.int(0, 30));
      items.push({ entityId: id, element: 'distance_km', at, value: km }, { entityId: id, element: 'fuel_litres', at, value: litres }, { entityId: id, element: 'fuel_cost', at, value: Math.round(litres * (2.3 + r.next() * 0.3) * 100) / 100 });
    }
  }
  await observations(tx, c, items);

  await form(tx, c, {
    key: 'trip_log',
    name: 'Trip log',
    description: 'Where the vehicle went, and how far.',
    subjectType: 'vehicle',
    definition: {
      title: 'Trip log',
      period: 'month',
      sections: [
        {
          key: 'trip',
          title: 'Trip',
          questions: [
            { key: 'purpose', type: 'select', label: 'Purpose', required: true, options: ['Field visit', 'Delivery', 'Staff transport', 'Errand', 'Other'].map((x) => ({ value: x.toLowerCase().replace(/ /g, '_'), label: x })) },
            { key: 'destination', type: 'text', label: 'Destination' },
            { key: 'start_km', type: 'integer', label: 'Odometer at start', required: true, min: 0 },
            { key: 'end_km', type: 'integer', label: 'Odometer at end', required: true, constraint: '. >= ${start_km}', constraintMessage: 'The end reading cannot be lower than the start', bind: { attribute: 'odometer' } },
            { key: 'distance', type: 'calculate', label: 'Distance', calculation: "if(${start_km} != '' and ${end_km} != '', ${end_km} - ${start_km}, 0)", bind: { element: 'distance_km' } },
            { key: 'notes', type: 'textarea', label: 'Notes' },
          ],
        },
      ],
    },
  });
  await form(tx, c, {
    key: 'fuel_fill',
    name: 'Fuel fill',
    description: 'Litres and cost at the pump.',
    subjectType: 'vehicle',
    definition: {
      title: 'Fuel fill',
      period: 'month',
      sections: [
        {
          key: 'fuel',
          title: 'Fuel',
          questions: [
            { key: 'litres', type: 'decimal', label: 'Litres', required: true, min: 1, max: 300, bind: { element: 'fuel_litres' } },
            { key: 'cost', type: 'decimal', label: 'Cost', required: true, min: 0, bind: { element: 'fuel_cost' } },
            { key: 'odometer', type: 'integer', label: 'Odometer', required: true, min: 0, bind: { attribute: 'odometer' } },
            { key: 'receipt', type: 'file', label: 'Receipt' },
          ],
        },
      ],
    },
  });
  await form(tx, c, {
    key: 'pre_trip_check',
    name: 'Pre-trip check',
    description: 'A quick walk-round before driving.',
    subjectType: 'vehicle',
    definition: {
      title: 'Pre-trip check',
      sections: [
        {
          key: 'check',
          title: 'Walk-round',
          questions: ['Tyres and wheel nuts', 'Lights and indicators', 'Brakes', 'Fluids (oil, water, brake)', 'Windscreen and wipers', 'Seatbelts', 'First-aid kit and triangle'].map((label) => ({ key: label.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''), type: 'boolean' as const, label, required: true })),
        },
        { key: 'sign_off', title: 'Sign off', questions: [{ key: 'problems', type: 'textarea', label: 'Anything wrong?' }] },
      ],
    },
  });
  await form(tx, c, {
    key: 'report_defect',
    name: 'Report a problem',
    description: 'Tell the workshop. It becomes a repair job.',
    subjectType: 'vehicle',
    definition: {
      title: 'Report a problem',
      sections: [
        {
          key: 'defect',
          title: 'The problem',
          questions: [
            { key: 'summary', type: 'text', label: 'What is wrong?', required: true },
            { key: 'severity', type: 'select', label: 'How bad is it?', required: true, options: [{ value: 'low', label: 'Minor, can wait' }, { value: 'normal', label: 'Needs fixing soon' }, { value: 'high', label: 'Should not be driven far' }, { value: 'urgent', label: 'Unsafe, do not drive' }] },
            { key: 'details', type: 'textarea', label: 'Details' },
            { key: 'photo', type: 'file', label: 'Photo' },
          ],
        },
      ],
    },
    settings: { work: { type: 'repair', title: '${summary}', description: '${details}', priority: 'normal', priorityFrom: 'severity', assigneeId: null, dueInHours: null } },
  });

  // Maintenance that comes round by itself: a service by distance or every six months, a yearly safety check.
  const mnt = await tx.selectFrom('work_type').select('id').where('project_id', '=', c.projectId).where('key', '=', 'maintenance').executeTakeFirstOrThrow();
  const plans = [
    { key: 'service', name: 'Routine service', title: 'Service ${name} (${code})', description: 'Oil and filters, brakes, tyres, and a general check.', every_days: 180, meter_attribute: 'odometer', meter_every: 10000, lead_days: 14 },
    { key: 'safety_check', name: 'Annual safety check', title: 'Safety inspection for ${name}', description: 'Roadworthiness inspection and registration renewal.', every_days: 365, meter_attribute: null, meter_every: null, lead_days: 30 },
  ];
  for (const p of plans) {
    const id = uuidv7();
    await tx.insertInto('work_schedule').values({ id, tenant_id: c.tenantId, project_id: c.projectId, type_id: mnt.id, key: p.key, name: p.name, title: p.title, description: p.description, priority: 'normal', entity_type: 'vehicle', every_days: p.every_days, meter_attribute: p.meter_attribute, meter_every: p.meter_every, lead_days: p.lead_days }).execute();
    for (const v of vehicles) {
      if (v.attributes.status === 'Retired') continue;
      await tx
        .insertInto('work_schedule_target')
        .values({ schedule_id: id, entity_id: made.ids.get(v.code)!, tenant_id: c.tenantId, next_due_at: new Date(now.getTime() + r.int(-5, p.every_days - 20) * DAY), last_meter: p.meter_attribute ? v.attributes.odometer - r.int(0, 9800) : null })
        .execute();
    }
  }

  // A few jobs already on the board.
  const jobs: { type: 'maintenance' | 'repair'; vehicle: number; title: string; priority: 'low' | 'normal' | 'high' | 'urgent'; state: string; hoursAgo: number }[] = [
    { type: 'repair', vehicle: 4, title: DEFECTS[0]!, priority: 'high', state: 'in_progress', hoursAgo: 30 },
    { type: 'repair', vehicle: 1, title: DEFECTS[1]!, priority: 'normal', state: 'new', hoursAgo: 6 },
    { type: 'repair', vehicle: 7, title: DEFECTS[3]!, priority: 'low', state: 'waiting', hoursAgo: 90 },
    { type: 'repair', vehicle: 9, title: DEFECTS[2]!, priority: 'normal', state: 'resolved', hoursAgo: 150 },
    { type: 'repair', vehicle: 2, title: DEFECTS[5]!, priority: 'urgent', state: 'new', hoursAgo: 2 },
    { type: 'maintenance', vehicle: 0, title: 'Service Toyota Hilux 1 (V01)', priority: 'normal', state: 'in_progress', hoursAgo: 40 },
    { type: 'maintenance', vehicle: 5, title: 'Safety inspection for Hino 300 truck 6', priority: 'normal', state: 'new', hoursAgo: 12 },
    { type: 'maintenance', vehicle: 3, title: 'Service Mitsubishi Triton 4 (V04)', priority: 'normal', state: 'closed', hoursAgo: 400 },
  ];
  for (const j of jobs) {
    const at = new Date(now.getTime() - j.hoursAgo * 3_600_000);
    const made1 = await insertWork({ db: undefined as never, now: () => at }, tx, { tenantId: c.tenantId, projectId: c.projectId, type: j.type, title: j.title, priority: j.priority, entityId: made.ids.get(vehicles[j.vehicle]!.code)!, createdBy: c.actorId, source: j.type === 'maintenance' ? 'schedule' : 'form' });
    const done = j.state === 'resolved' || j.state === 'closed';
    await tx
      .updateTable('work_item')
      .set({
        state: j.state,
        assignee_id: j.state === 'new' ? null : c.actorId,
        first_response_at: j.state === 'new' ? null : new Date(at.getTime() + 40 * 60_000),
        resolved_at: done ? new Date(at.getTime() + (8 + r.int(0, 30)) * 3_600_000) : null,
        due_at: j.type === 'maintenance' && !done ? new Date(now.getTime() + r.int(-2, 10) * DAY) : null,
      })
      .where('id', '=', made1.id)
      .execute();
  }

  await dashboard(tx, c, {
    key: 'fleet',
    name: 'Fleet',
    description: 'Distance, fuel, upkeep and what is in the workshop.',
    widgets: [
      { id: 'vehicles', type: 'kpi', title: 'Vehicles in service', w: 3, h: 1, query: { kind: 'kpi', entityType: 'vehicle', where: { attribute: 'status', equals: 'Available' } } },
      { id: 'workshop', type: 'kpi', title: 'In the workshop', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', entityType: 'vehicle', where: { attribute: 'status', equals: 'In the workshop' } } },
      { id: 'km', type: 'kpi', title: 'Distance (30 days)', w: 3, h: 1, query: { kind: 'kpi', element: 'distance_km', range: { lastHours: 24 * 31 }, compare: true } },
      { id: 'fuel_cost', type: 'kpi', title: 'Fuel cost (30 days)', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', element: 'fuel_cost', range: { lastHours: 24 * 31 }, compare: true } },
      { id: 'open_repairs', type: 'kpi', title: 'Open repairs', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'count', type: 'repair', state: 'open' } },
      { id: 'open_maintenance', type: 'kpi', title: 'Maintenance due', w: 3, h: 1, query: { kind: 'work', measure: 'count', type: 'maintenance', state: 'open' } },
      { id: 'overdue', type: 'kpi', title: 'Overdue jobs', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'count', overdue: true } },
      { id: 'resolve', type: 'kpi', title: 'Avg. hours to fix', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'avg_resolve_hours', type: 'repair', state: 'done' } },
      { id: 'monthly', type: 'line', title: 'Distance and fuel per month', w: 6, h: 3, query: { kind: 'series', elements: ['distance_km', 'fuel_litres'], interval: 'month', range: { lastHours: 24 * 186 } } },
      { id: 'by_depot', type: 'bar', title: 'Vehicles by depot', w: 3, h: 3, query: { kind: 'breakdown', entityType: 'vehicle', by: 'parent' } },
      { id: 'status', type: 'pie', title: 'Vehicle status', w: 3, h: 3, query: { kind: 'breakdown', entityType: 'vehicle', by: 'attribute', attribute: 'status' } },
      { id: 'jobs', type: 'bar', title: 'Jobs by status', w: 4, h: 3, query: { kind: 'work', measure: 'count', by: 'state' } },
      { id: 'depots', type: 'map', title: 'Depots', w: 4, h: 3, query: { kind: 'geo', entityType: 'depot' } },
      { id: 'fleet', type: 'table', title: 'Vehicles', w: 4, h: 3, query: { kind: 'table', entityType: 'vehicle', columns: ['name', 'registration', 'status', 'odometer', 'parent'], limit: 100 } },
    ],
  });
}
