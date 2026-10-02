import { dashboard, elements, entities, form, island, observations, overlay, rng, types, weekStart, type TemplateCtx, type Tx } from './kit.js';

// Fictional geography (Pacific island setting) for the demo; replace via CSV import.
const PROVINCES = [
  { code: 'NTH', name: 'Northern', lon: 179.25, lat: -16.55, districts: ['Waimoana', 'Tavua Hills'] },
  { code: 'WST', name: 'Western', lon: 177.55, lat: -17.7, districts: ['Sunset Coast', 'Riverbend'] },
  { code: 'CTL', name: 'Central', lon: 178.45, lat: -18.05, districts: ['Harbourside', 'Highlands'] },
  { code: 'EST', name: 'Eastern Islands', lon: 179.0, lat: -18.85, districts: ['Lagoon', 'Outer Reef'] },
] as const;
const PLACES = [
  'Nakoro', 'Vailima', 'Tausala', 'Moana Point', 'Korovou', 'Sanaka', 'Lomana', 'Tuvalu Bay', 'Rakiraki Flats', 'Seaview',
  'Namaka', 'Kalesi', 'Waidina', 'Saru', 'Navaka', 'Delai', 'Matei', 'Loma', 'Vunisea', 'Tokou', 'Levuka Heights', 'Nalua', 'Wairiki', 'Somo',
];
const TYPES = ['Hospital', 'Health centre', 'Aid post'] as const;

/**
 * P2: weekly health facility surveillance. Province → District → Facility with
 * twelve weeks of seeded reports (including an influenza-like-illness cluster),
 * a weekly reporting form bound to the indicators, and an overview dashboard.
 */
export async function healthSurveillance(tx: Tx, c: TemplateCtx, now = new Date()) {
  await types(tx, c, [
    { key: 'province', name: 'Province', plural: 'Provinces', icon: 'map', color: '#005d5d', geometry: 'polygon', attributes: [{ key: 'population', label: 'Population', type: 'integer' }] },
    { key: 'district', name: 'District', plural: 'Districts', icon: 'map-pin', color: '#007d79', geometry: 'polygon', parentTypes: ['province'], attributes: [{ key: 'population', label: 'Population', type: 'integer' }] },
    {
      key: 'facility',
      name: 'Facility',
      plural: 'Facilities',
      icon: 'hospital',
      color: '#da1e28',
      geometry: 'point',
      parentTypes: ['district'],
      attributes: [
        { key: 'facility_type', label: 'Type', type: 'select', options: [...TYPES], summary: true, required: true },
        { key: 'ownership', label: 'Ownership', type: 'select', options: ['Government', 'Faith-based', 'Private'] },
        { key: 'beds', label: 'Beds', type: 'integer', summary: true },
        { key: 'catchment_population', label: 'Catchment population', type: 'integer' },
        { key: 'in_charge', label: 'Officer in charge', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'phone' },
      ],
    },
  ]);
  await elements(tx, c, [
    { key: 'malaria_cases', name: 'Malaria cases (confirmed)', aggregation: 'sum' },
    { key: 'ili_cases', name: 'Influenza-like illness', aggregation: 'sum' },
    { key: 'diarrhoea_cases', name: 'Acute diarrhoea', aggregation: 'sum' },
    { key: 'measles_suspected', name: 'Suspected measles', aggregation: 'sum' },
    { key: 'deaths', name: 'Deaths (all causes)', aggregation: 'sum' },
    { key: 'stockout_days', name: 'Stock-out days (essential medicines)', unit: 'days', aggregation: 'sum' },
  ]);

  const r = rng(20261002);
  // Island-shaped outlines (a separate generator keeps the seeded figures stable).
  const shape = rng(7);
  const districts = PROVINCES.flatMap((p, pi) =>
    p.districts.map((d, di) => {
      const lon = p.lon + (di ? 0.35 : -0.3);
      const lat = p.lat + (di ? -0.2 : 0.15);
      return { code: `${p.code}-${di + 1}`, name: d, parentCode: p.code, lon, lat, province: pi, outline: island(shape, lon, lat, 0.3, 0.2) };
    }),
  );
  await entities(
    tx,
    c,
    'province',
    PROVINCES.map((p, pi) => ({
      code: p.code,
      name: p.name,
      attributes: { population: r.int(60, 220) * 1000 },
      geometry: { type: 'MultiPolygon', coordinates: districts.filter((d) => d.province === pi).map((d) => d.outline.coordinates) },
    })),
  );
  await entities(
    tx,
    c,
    'district',
    districts.map((d) => ({ code: d.code, name: d.name, parentCode: d.parentCode, attributes: { population: r.int(20, 90) * 1000 }, geometry: d.outline })),
  );
  let place = 0;
  const facilities = districts.flatMap((d) =>
    [0, 1, 2].map((i) => {
      const type = TYPES[i === 0 && d.code.endsWith('-1') ? 0 : i === 0 ? 1 : i]!;
      const name = `${PLACES[place++ % PLACES.length]} ${type}`;
      return {
        code: `HF-${d.code}-${i + 1}`,
        name,
        parentCode: d.code,
        district: d.code,
        type,
        attributes: {
          facility_type: type,
          ownership: r.next() < 0.75 ? 'Government' : r.pick(['Faith-based', 'Private']),
          beds: type === 'Hospital' ? r.int(40, 160) : type === 'Health centre' ? r.int(4, 20) : 0,
          catchment_population: r.int(3, 40) * 1000,
          in_charge: r.pick(['Sr. Mere Tuilagi', 'Dr. Ana Kaufusi', 'Mr. Joseph Narayan', 'Sr. Litia Waqa', 'Dr. Sione Taufa', 'Ms. Priya Lal']),
        },
        geometry: { type: 'Point' as const, coordinates: [d.lon + (r.next() - 0.5) * 0.3, d.lat + (r.next() - 0.5) * 0.2] },
      };
    }),
  );
  const created = await entities(tx, c, 'facility', facilities.map(({ district: _d, type: _t, ...f }) => f));

  // Twelve weeks of weekly reports; an ILI cluster in Harbourside over the last three weeks.
  const scale = { Hospital: 3, 'Health centre': 1.4, 'Aid post': 0.5 } as const;
  const items: { entityId: string; element: string; at: Date; value: number }[] = [];
  for (const f of facilities) {
    const id = created.ids.get(f.code)!;
    const s = scale[f.type];
    for (let w = 11; w >= 0; w--) {
      if (w === 0 && r.next() < 0.2) continue; // some facilities haven't reported this week yet
      const at = weekStart(now, w);
      const outbreak = f.district === 'CTL-1' && w <= 2 ? 3 + (2 - w) * 1.5 : 1;
      const seasonal = 1 + 0.35 * Math.sin((12 - w) / 2);
      items.push(
        { entityId: id, element: 'malaria_cases', at, value: r.count(4 * s * seasonal) },
        { entityId: id, element: 'ili_cases', at, value: r.count(5 * s * outbreak) },
        { entityId: id, element: 'diarrhoea_cases', at, value: r.count(3 * s) },
        { entityId: id, element: 'measles_suspected', at, value: r.next() < (f.district === 'EST-2' && w < 4 ? 0.5 : 0.04) ? r.int(1, 3) : 0 },
        { entityId: id, element: 'deaths', at, value: r.next() < 0.15 * s ? r.int(1, 2) : 0 },
        { entityId: id, element: 'stockout_days', at, value: r.next() < 0.18 ? r.int(1, 7) : 0 },
      );
    }
  }
  await observations(tx, c, items);

  await form(tx, c, {
    key: 'weekly_report',
    name: 'Weekly surveillance report',
    description: 'Submitted by each facility every Monday for the previous epidemiological week.',
    subjectType: 'facility',
    definition: {
      title: 'Weekly surveillance report',
      period: 'week',
      sections: [
        {
          key: 'cases',
          title: 'Cases this week',
          questions: [
            { key: 'malaria', type: 'integer', label: 'Confirmed malaria cases', required: true, min: 0, max: 5000, bind: { element: 'malaria_cases' } },
            { key: 'ili', type: 'integer', label: 'Influenza-like illness', required: true, min: 0, max: 5000, bind: { element: 'ili_cases' } },
            { key: 'diarrhoea', type: 'integer', label: 'Acute diarrhoea', required: true, min: 0, max: 5000, bind: { element: 'diarrhoea_cases' } },
            { key: 'measles', type: 'integer', label: 'Suspected measles', required: true, min: 0, max: 500, bind: { element: 'measles_suspected' } },
            { key: 'measles_note', type: 'note', label: 'Notify the district health office within 24 hours of any suspected measles case.', relevant: '${measles} > 0' },
            { key: 'deaths', type: 'integer', label: 'Deaths (all causes)', required: true, min: 0, max: 500, bind: { element: 'deaths' }, constraint: '. <= ${malaria} + ${ili} + ${diarrhoea} + ${measles} + 50', constraintMessage: 'Check the number of deaths' },
          ],
        },
        {
          key: 'alerts',
          title: 'Alerts',
          questions: [
            { key: 'outbreak', type: 'boolean', label: 'Do you suspect an outbreak?' },
            { key: 'outbreak_details', type: 'textarea', label: 'Describe the cases (symptoms, location, ages)', required: true, relevant: '${outbreak} = true' },
            { key: 'stockout', type: 'integer', label: 'Days with essential medicines out of stock', min: 0, max: 7, bind: { element: 'stockout_days' } },
            { key: 'items_out', type: 'multiselect', label: 'Which items?', relevant: '${stockout} > 0', options: [{ value: 'act', label: 'Malaria treatment (ACT)' }, { value: 'rdt', label: 'Malaria rapid tests' }, { value: 'ors', label: 'ORS / zinc' }, { value: 'amox', label: 'Amoxicillin' }, { value: 'vaccine', label: 'Vaccines' }] },
          ],
        },
      ],
    },
  });
  await form(tx, c, {
    key: 'facility_profile',
    name: 'Facility profile update',
    subjectType: 'facility',
    definition: {
      title: 'Facility profile update',
      sections: [
        {
          key: 'profile',
          title: 'Profile',
          questions: [
            { key: 'in_charge', type: 'text', label: 'Officer in charge', required: true, bind: { attribute: 'in_charge' } },
            { key: 'phone', type: 'text', label: 'Phone', bind: { attribute: 'phone' }, constraint: "regex(., '^[+0-9 ()-]{6,20}$')", constraintMessage: 'Enter a phone number' },
            { key: 'beds', type: 'integer', label: 'Beds', min: 0, max: 2000, bind: { attribute: 'beds' } },
          ],
        },
      ],
    },
  });

  const week = 24 * 7;
  await dashboard(tx, c, {
    key: 'overview',
    name: 'Surveillance overview',
    description: 'This week’s reports, trends and hotspots across all facilities.',
    filters: { areaType: 'province' },
    widgets: [
      { id: 'malaria', type: 'kpi', title: 'Malaria cases (7 days)', w: 3, h: 1, options: { invert: true }, query: { kind: 'kpi', element: 'malaria_cases', range: { lastHours: week }, compare: true } },
      { id: 'ili', type: 'kpi', title: 'Influenza-like illness (7 days)', w: 3, h: 1, options: { invert: true, warn: 150, alert: 220 }, query: { kind: 'kpi', element: 'ili_cases', range: { lastHours: week }, compare: true } },
      { id: 'measles', type: 'kpi', title: 'Suspected measles (7 days)', w: 3, h: 1, options: { invert: true, warn: 1, alert: 3 }, query: { kind: 'kpi', element: 'measles_suspected', range: { lastHours: week }, compare: true } },
      { id: 'reporting', type: 'kpi', title: 'Facilities reporting this week', w: 3, h: 1, query: { kind: 'kpi', element: 'malaria_cases', aggregation: 'distinct', range: { lastHours: week } } },
      { id: 'trend', type: 'line', title: 'Weekly cases', w: 8, h: 3, query: { kind: 'series', elements: ['malaria_cases', 'ili_cases', 'diarrhoea_cases'], interval: 'week', range: { lastHours: week * 12 } } },
      { id: 'types', type: 'pie', title: 'Facilities by type', w: 4, h: 3, query: { kind: 'breakdown', entityType: 'facility', by: 'attribute', attribute: 'facility_type' } },
      { id: 'map', type: 'map', title: 'Influenza-like illness, latest week', w: 7, h: 4, options: { warn: 12, alert: 25, labelAttribute: 'facility_type' }, query: { kind: 'geo', entityType: 'facility', element: 'ili_cases' } },
      { id: 'districts', type: 'bar', title: 'ILI by district (4 weeks)', w: 5, h: 4, options: { horizontal: true }, query: { kind: 'breakdown', element: 'ili_cases', by: 'parent', entityType: 'facility', range: { lastHours: week * 4 } } },
      { id: 'stockouts', type: 'bar', title: 'Stock-out days by facility (4 weeks)', w: 6, h: 3, options: { horizontal: true }, query: { kind: 'breakdown', element: 'stockout_days', by: 'entity', range: { lastHours: week * 4 }, limit: 8 } },
      { id: 'facilities', type: 'table', title: 'Facilities', w: 6, h: 3, query: { kind: 'table', entityType: 'facility', columns: ['name', 'parent', 'facility_type', 'beds', 'in_charge'], limit: 50 } },
    ],
  });

  const month = 24 * 28;
  await overlay(tx, c, { key: 'ili_4w', name: 'Influenza-like illness (4 weeks)', group: 'Disease surveillance', element: 'ili_cases', hours: month, palette: 'heat' });
  await overlay(tx, c, { key: 'malaria_4w', name: 'Malaria cases (4 weeks)', group: 'Disease surveillance', element: 'malaria_cases', hours: month, palette: 'purples' });
  await overlay(tx, c, { key: 'diarrhoea_4w', name: 'Acute diarrhoea (4 weeks)', group: 'Disease surveillance', element: 'diarrhoea_cases', hours: month, palette: 'blues' });
  await overlay(tx, c, { key: 'measles_12w', name: 'Suspected measles (12 weeks)', group: 'Disease surveillance', element: 'measles_suspected', hours: week * 12, palette: 'reds', thresholds: [1, 3, 6] });
  await overlay(tx, c, { key: 'ili_facilities', name: 'ILI by facility (latest report)', group: 'Disease surveillance', element: 'ili_cases', hours: null, level: 'facility', palette: 'heat', thresholds: [5, 12, 25] });
  await overlay(tx, c, { key: 'stockouts_4w', name: 'Stock-out days (4 weeks)', group: 'Health system', element: 'stockout_days', hours: month, palette: 'performance', thresholds: [1, 5, 10], unit: 'days' });
  await overlay(tx, c, { key: 'deaths_12w', name: 'Deaths, all causes (12 weeks)', group: 'Health system', element: 'deaths', hours: week * 12, palette: 'greens' });
}
