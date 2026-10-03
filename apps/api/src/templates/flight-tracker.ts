import { dashboard, elements, job, types, type TemplateCtx, type Tx } from './kit.js';

/** OpenSky's anonymous API: a small bounding box (≤ 25 sq° costs one credit per call). */
export const OPENSKY_BBOX = { lamin: 51.0, lomin: -1.0, lamax: 52.0, lomax: 1.0, label: 'London & south-east England' };

/**
 * P1: a public, live flight tracker. Every 5 minutes a job pulls state vectors from
 * OpenSky, upserts Country → Aircraft entities with positions, records altitude,
 * speed and a "seen" marker, and snapshots the airborne list as a dataset.
 */
export async function flightTracker(tx: Tx, c: TemplateCtx) {
  await types(tx, c, [
    { key: 'country', name: 'Country', plural: 'Countries', icon: 'flag', color: '#6929c4', geometry: 'none', attributes: [] },
    {
      key: 'aircraft',
      name: 'Aircraft',
      plural: 'Aircraft',
      icon: 'plane',
      color: '#0f62fe',
      geometry: 'point',
      parentTypes: ['country'],
      attributes: [
        { key: 'callsign', label: 'Callsign', type: 'text', summary: true },
        { key: 'icao24', label: 'ICAO 24-bit address', type: 'text' },
        { key: 'altitude_m', label: 'Altitude', type: 'number', unit: 'm', summary: true },
        { key: 'velocity_ms', label: 'Ground speed', type: 'number', unit: 'm/s', summary: true },
        { key: 'heading', label: 'Heading', type: 'number', unit: '°' },
        { key: 'vertical_rate', label: 'Vertical rate', type: 'number', unit: 'm/s' },
        { key: 'on_ground', label: 'On ground', type: 'boolean' },
        { key: 'squawk', label: 'Squawk', type: 'text' },
        { key: 'last_contact', label: 'Last contact', type: 'text' },
      ],
    },
  ]);
  await elements(tx, c, [
    { key: 'seen', name: 'Seen in area', description: 'Recorded each time an aircraft is reported in the area', aggregation: 'count' },
    { key: 'altitude_m', name: 'Barometric altitude', unit: 'm', aggregation: 'avg' },
    { key: 'velocity_ms', name: 'Ground speed', unit: 'm/s', aggregation: 'avg' },
  ]);
  const { lamin, lomin, lamax, lomax } = OPENSKY_BBOX;
  await job(tx, c, {
    key: 'opensky_positions',
    name: 'OpenSky positions',
    description: `Live state vectors for ${OPENSKY_BBOX.label} from the OpenSky Network (anonymous access).`,
    schedule: '*/5 * * * *',
    freshnessMinutes: 5,
    maxRetries: 2,
    timeoutSeconds: 120,
    steps: [
      {
        id: 'fetch',
        type: 'http.extract',
        label: 'Fetch state vectors',
        url: `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,
        rows: 'states.{ "icao": $[0], "callsign": $trim($[1]), "country": $[2], "time": $[3], "contact": $[4], "lon": $[5], "lat": $[6], "alt": $[7], "ground": $[8], "speed": $[9], "heading": $[10], "vrate": $[11], "squawk": $[14] }',
        timeoutSeconds: 60,
      },
      { id: 'located', type: 'filter', label: 'Has a position', condition: '$type(lat) = "number" and $type(lon) = "number"' },
      { id: 'countries', type: 'entity.upsert', label: 'Registration countries', entityType: 'country', code: 'country', name: 'country' },
      {
        id: 'aircraft',
        type: 'entity.upsert',
        label: 'Aircraft and positions',
        entityType: 'aircraft',
        code: 'icao',
        name: 'callsign != "" ? callsign : $uppercase(icao)',
        parentType: 'country',
        parentCode: 'country',
        lon: 'lon',
        lat: 'lat',
        attributes: {
          callsign: 'callsign',
          icao24: 'icao',
          altitude_m: 'alt',
          velocity_ms: 'speed',
          heading: 'heading',
          vertical_rate: 'vrate',
          on_ground: 'ground',
          squawk: 'squawk',
          last_contact: '$fromMillis(contact * 1000)',
        },
      },
      { id: 'observations', type: 'observation.write', label: 'Altitude, speed, seen', entityType: 'aircraft', entityCode: 'icao', at: 'time', values: { seen: '1', altitude_m: 'alt', velocity_ms: 'speed' } },
      {
        id: 'snapshot',
        type: 'dataset.write',
        label: 'Airborne now',
        dataset: 'airborne_now',
        mode: 'replace',
        columns: [
          { name: 'callsign', value: 'callsign != "" ? callsign : $uppercase(icao)' },
          { name: 'country', value: 'country' },
          { name: 'altitude_m', value: 'alt' },
          { name: 'speed_kmh', value: 'speed ? $round(speed * 3.6) : null' },
          { name: 'heading', value: 'heading ? $round(heading) : null' },
          { name: 'on_ground', value: 'ground' },
        ],
      },
    ],
  });
  await dashboard(tx, c, {
    key: 'live',
    name: 'Live air traffic',
    description: `Aircraft over ${OPENSKY_BBOX.label}, refreshed every 5 minutes from the OpenSky Network.`,
    isPublic: true,
    widgets: [
      { id: 'tracked', type: 'kpi', title: 'Aircraft in the area', w: 3, h: 1, query: { kind: 'kpi', element: 'seen', aggregation: 'distinct', range: { lastMinutes: 10 } } },
      { id: 'airborne', type: 'kpi', title: 'Airborne', w: 3, h: 1, query: { kind: 'kpi', element: 'altitude_m', aggregation: 'distinct', range: { lastMinutes: 10 } } },
      { id: 'altitude', type: 'kpi', title: 'Average altitude', w: 3, h: 1, options: { unit: 'm', decimals: 0 }, query: { kind: 'kpi', element: 'altitude_m', aggregation: 'avg', range: { lastMinutes: 10 } } },
      { id: 'speed', type: 'kpi', title: 'Average ground speed', w: 3, h: 1, options: { unit: 'm/s', decimals: 0 }, query: { kind: 'kpi', element: 'velocity_ms', aggregation: 'avg', range: { lastMinutes: 10 } } },
      {
        id: 'map',
        type: 'map',
        title: 'Positions',
        w: 8,
        h: 4,
        options: { refreshSeconds: 60, labelAttribute: 'callsign' },
        query: { kind: 'geo', entityType: 'aircraft', element: 'altitude_m', withinMinutes: 10 },
      },
      { id: 'countries', type: 'bar', title: 'By country of registration', w: 4, h: 4, options: { horizontal: true }, query: { kind: 'breakdown', element: 'seen', aggregation: 'distinct', by: 'parent', range: { lastMinutes: 10 }, limit: 10 } },
      { id: 'hourly', type: 'line', title: 'Aircraft per hour', w: 6, h: 2, query: { kind: 'series', elements: ['seen'], aggregation: 'distinct', interval: 'hour', range: { lastHours: 24 } } },
      { id: 'altitude_trend', type: 'line', title: 'Average altitude per hour (m)', w: 6, h: 2, query: { kind: 'series', elements: ['altitude_m'], aggregation: 'avg', interval: 'hour', range: { lastHours: 24 } } },
      { id: 'list', type: 'table', title: 'Airborne now', w: 12, h: 3, query: { kind: 'table', source: 'dataset', dataset: 'airborne_now', sort: 'altitude_m', desc: true, limit: 50 } },
    ],
  });
}
