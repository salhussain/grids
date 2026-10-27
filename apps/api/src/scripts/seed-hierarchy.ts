/**
 * Adds a project with a deep entity hierarchy, to try the entities tree, maps, permissions scoped to a
 * branch and forms whose questions choose entities related to each other:
 *
 *   Region › Country › Parish › Community › Facility › Ward
 *
 * plus a visit form that picks a country, then a parish under it, then the facility under that.
 *
 *   pnpm --filter @grids/api build && node --env-file=../../.env dist/scripts/seed-hierarchy.js
 *
 * Nothing is deleted. ORGANISATION_ID and USER_ID pick who owns it (defaults: the first organisation and its first admin).
 */
import { createDb, TenantRouter, type CellDB, type PlatformDB } from '@grids/db';
import { DataElementInput, EntityInput, EntityTypeInput, FormInput, ProjectInput } from '@grids/schema';
import { loadConfig } from '../config.js';
import { GridsIdpClient } from '../idp/grids.js';
import { cellResolver } from '../services/cells.js';
import type { Actor } from '../services/context.js';
import { EmailService, mailerFor } from '../services/email.js';
import { createServices } from '../services/index.js';
import { secretsKeyFrom } from '../services/secrets.js';

const config = loadConfig();
const platformDb = createDb<PlatformDB>(config.DATABASE_URL_PLATFORM, { max: 4 });
const cells = new TenantRouter<CellDB>(cellResolver(platformDb));
const services = createServices({
  db: platformDb,
  cells,
  idp: new GridsIdpClient(config.IDENTITY_INTERNAL_URL, config.IDENTITY_SERVICE_TOKEN),
  email: new EmailService(platformDb, mailerFor(config.SMTP_URL, config.MAIL_FROM)),
  consoleUrl: config.CONSOLE_URL,
  workspaceUrl: config.WEB_URL,
  baseDomain: config.BASE_DOMAIN,
  supportEmail: config.SUPPORT_EMAIL,
  secretsKey: secretsKeyFrom(config.SECRETS_KEY, false),
  allowPrivateConnections: true,
  now: () => new Date(),
});

const tenant = process.env.ORGANISATION_ID ?? (await platformDb.selectFrom('tenant').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id;
const admin = await platformDb
  .selectFrom('membership as m')
  .innerJoin('user_identity as u', 'u.id', 'm.user_id')
  .select(['u.id', 'u.email'])
  .where('m.tenant_id', '=', tenant)
  .where('m.role', '=', 'org_admin')
  .$if(!!process.env.USER_ID, (q) => q.where('u.id', '=', process.env.USER_ID!))
  .orderBy('m.created_at')
  .executeTakeFirstOrThrow();
const actor: Actor = { id: admin.id, email: admin.email, isPlatformAdmin: false, permissions: new Set() };
const project = 'caribbean-health';

await services.projects.create(
  actor,
  tenant,
  ProjectInput.parse({
    key: project,
    name: 'Caribbean Health Network',
    description: 'Facilities and wards across the Eastern Caribbean, six levels deep: region, country, parish, community, facility and ward.',
    visibility: 'organisation',
    color: '#0e6a6a',
    icon: 'network',
  }),
);

const type = (t: unknown) => services.projects.saveType(actor, tenant, project, EntityTypeInput.parse(t));
await type({ key: 'region', name: 'Region', plural: 'Regions', icon: 'globe', color: '#161616', parentTypes: ['@root'] });
await type({ key: 'country', name: 'Country', plural: 'Countries', icon: 'flag', color: '#0f62fe', geometry: 'point', parentTypes: ['region'], attributes: [{ key: 'population', label: 'Population', type: 'integer', summary: true }] });
await type({ key: 'parish', name: 'Parish', plural: 'Parishes', icon: 'map', color: '#6929c4', geometry: 'point', parentTypes: ['country'] });
await type({ key: 'community', name: 'Community', plural: 'Communities', icon: 'home', color: '#007d79', geometry: 'point', parentTypes: ['parish'] });
await type({
  key: 'facility',
  name: 'Facility',
  plural: 'Facilities',
  icon: 'hospital',
  color: '#da1e28',
  geometry: 'point',
  marker: { style: 'pin' },
  parentTypes: ['community'],
  attributes: [
    { key: 'facility_type', label: 'Type', type: 'select', options: ['Hospital', 'Health centre', 'Clinic'], summary: true, required: true },
    { key: 'beds', label: 'Beds', type: 'integer', summary: true },
    { key: 'phone', label: 'Phone', type: 'phone' },
  ],
});
await type({ key: 'ward', name: 'Ward', plural: 'Wards', icon: 'bed', color: '#8a3ffc', parentTypes: ['facility'], attributes: [{ key: 'beds', label: 'Beds', type: 'integer', summary: true }] });
await services.projects.saveElement(actor, tenant, project, DataElementInput.parse({ key: 'occupied_beds', name: 'Occupied beds', aggregation: 'max' }));

// A small deterministic generator, so the same project comes out every time.
let seed = 20261008;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const jitter = (n: number, spread: number) => Math.round((n + (rnd() - 0.5) * spread) * 1e5) / 1e5;

const COUNTRIES: { code: string; name: string; lat: number; lon: number; population: number; parishes: { name: string; communities: string[] }[] }[] = [
  { code: 'DM', name: 'Dominica', lat: 15.41, lon: -61.37, population: 72000, parishes: [{ name: 'Saint George', communities: ['Roseau', 'Goodwill'] }, { name: 'Saint Andrew', communities: ['Marigot', 'Wesley'] }, { name: 'Saint Patrick', communities: ['Berekua', 'Grand Bay'] }] },
  { code: 'LC', name: 'Saint Lucia', lat: 13.91, lon: -60.98, population: 180000, parishes: [{ name: 'Castries', communities: ['Castries Town', 'Bexon'] }, { name: 'Gros Islet', communities: ['Rodney Bay', 'Babonneau'] }, { name: 'Vieux Fort', communities: ['Vieux Fort Town', 'Beausejour'] }] },
  { code: 'GD', name: 'Grenada', lat: 12.12, lon: -61.68, population: 113000, parishes: [{ name: 'Saint George', communities: ['Saint George’s', 'Grand Anse'] }, { name: 'Saint Andrew', communities: ['Grenville', 'Paraclete'] }, { name: 'Saint David', communities: ['Saint David’s', 'Perdmontemps'] }] },
  { code: 'BB', name: 'Barbados', lat: 13.19, lon: -59.54, population: 282000, parishes: [{ name: 'Saint Michael', communities: ['Bridgetown', 'Black Rock'] }, { name: 'Christ Church', communities: ['Oistins', 'Worthing'] }, { name: 'Saint Philip', communities: ['Six Cross Roads', 'Crane'] }] },
];
const KINDS = ['Hospital', 'Health centre', 'Clinic'] as const;
const WARDS: Record<(typeof KINDS)[number], string[]> = { Hospital: ['Emergency', 'Maternity', 'Surgical'], 'Health centre': ['General', 'Maternity'], Clinic: ['General'] };

const make = async (input: unknown) => (await services.projects.createEntity(actor, tenant, project, EntityInput.parse(input))).id;
const point = (lat: number, lon: number) => ({ type: 'Point' as const, coordinates: [lon, lat] });

const region = await make({ typeKey: 'region', code: 'EC', name: 'Eastern Caribbean' });
const counts = { country: 0, parish: 0, community: 0, facility: 0, ward: 0 };
for (const c of COUNTRIES) {
  const country = await make({ typeKey: 'country', code: c.code, name: c.name, parentId: region, attributes: { population: c.population }, geometry: point(c.lat, c.lon) });
  counts.country++;
  for (const [pi, p] of c.parishes.entries()) {
    const pLat = jitter(c.lat, 0.25);
    const pLon = jitter(c.lon, 0.2);
    const parish = await make({ typeKey: 'parish', code: `${c.code}-P${pi + 1}`, name: p.name, parentId: country, geometry: point(pLat, pLon) });
    counts.parish++;
    for (const [ci, name] of p.communities.entries()) {
      const cLat = jitter(pLat, 0.06);
      const cLon = jitter(pLon, 0.06);
      const community = await make({ typeKey: 'community', code: `${c.code}-P${pi + 1}-C${ci + 1}`, name, parentId: parish, geometry: point(cLat, cLon) });
      counts.community++;
      // The first community of each parish has a hospital or health centre; the second a clinic.
      const kinds: (typeof KINDS)[number][] = ci === 0 ? [pi === 0 ? 'Hospital' : 'Health centre'] : ['Clinic'];
      for (const kind of kinds) {
        const beds = kind === 'Hospital' ? 120 + Math.round(rnd() * 120) : kind === 'Health centre' ? 20 + Math.round(rnd() * 20) : 0;
        const facility = await make({
          typeKey: 'facility',
          code: `${c.code}-P${pi + 1}-C${ci + 1}-F`,
          name: `${name} ${kind}`,
          parentId: community,
          attributes: { facility_type: kind, beds, phone: `+1 767 555 ${String(1000 + counts.facility * 37).slice(-4)}` },
          geometry: point(jitter(cLat, 0.01), jitter(cLon, 0.01)),
        });
        counts.facility++;
        for (const w of WARDS[kind]) {
          await make({ typeKey: 'ward', code: `${c.code}-P${pi + 1}-C${ci + 1}-W${counts.ward + 1}`, name: `${w} ward`, parentId: facility, attributes: { beds: Math.max(4, Math.round(beds / WARDS[kind].length)) } });
          counts.ward++;
        }
      }
    }
  }
}

// A visit form that narrows step by step: a country, then a parish under it, then the facility within that parish.
await services.forms.save(
  actor,
  tenant,
  project,
  FormInput.parse({
    key: 'facility_visit',
    name: 'Facility visit',
    description: 'Pick the country and parish, then the facility, and record what you found.',
    subjectType: 'facility',
    definition: {
      title: 'Facility visit',
      description: 'Choose where you are, from the widest area down to the facility.',
      sections: [
        {
          key: 'where',
          title: 'Where are you?',
          questions: [
            { key: 'country', type: 'entity', label: 'Country', entityType: 'country', required: true },
            { key: 'parish', type: 'entity', label: 'Parish', entityType: 'parish', filter: { of: 'country', relation: 'children' }, required: true },
            { key: 'main_entity', type: 'entity', label: 'Facility', entityType: 'facility', filter: { of: 'parish', relation: 'descendants' }, primary: true, required: true },
          ],
        },
        {
          key: 'visit',
          title: 'The visit',
          questions: [
            { key: 'visited_on', type: 'date', label: 'Date of visit', required: true },
            { key: 'beds', type: 'integer', label: 'Beds in use', bind: { element: 'occupied_beds' }, min: 0 },
            { key: 'ward', type: 'entity', label: 'Ward checked', entityType: 'ward', filter: { of: 'main_entity', relation: 'children' } },
            { key: 'notes', type: 'textarea', label: 'Notes' },
          ],
        },
      ],
      layout: 'steps',
    },
  }),
);
await services.forms.publish(actor, tenant, project, 'facility_visit');

console.log(`Caribbean Health Network: 1 region, ${counts.country} countries, ${counts.parish} parishes, ${counts.community} communities, ${counts.facility} facilities, ${counts.ward} wards, and the facility visit form`);
await platformDb.destroy();
