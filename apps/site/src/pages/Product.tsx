import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { ctaPrimary, ctaSecondary } from '../Layout';
import { SIGNUP_URL } from '../env';

const BLOCKS: { eyebrow: string; title: string; body: string; points: string[] }[] = [
  {
    eyebrow: 'Collect',
    title: 'Forms that work where people work',
    body: 'A visual builder with skip logic, validation and translations. Fill them on a phone, tablet or laptop, online or off.',
    points: ['Offline-first sync with conflict handling', 'Responses are immutable and versioned', 'Public links for open surveys', 'Review and approval workflows'],
  },
  {
    eyebrow: 'Organise',
    title: 'An organisation that matches yours',
    body: 'Model the real structure of your agency, then give each team exactly the access it needs.',
    points: ['Units to any depth: region, department, team', 'Roles granted for a unit and everything below', 'Shared entity types and registers across projects', 'Single sign-on and two-step sign-in'],
  },
  {
    eyebrow: 'Analyse',
    title: 'Dashboards, maps and tables that stay current',
    body: 'Explore data with a visual query builder or SQL, then turn any result into a chart, map layer or KPI.',
    points: ['Live refresh as data arrives', 'Maps with facility-level drill-down', 'Public or private publishing', 'Export to CSV and GeoJSON'],
  },
  {
    eyebrow: 'Connect',
    title: 'Bring in the systems you already have',
    body: 'Schedule pulls from APIs, databases and files. Map fields once and keep datasets fresh automatically.',
    points: ['HTTP, Postgres and S3 connectors', 'Run history with per-step logs and retries', 'Webhooks and a documented API', 'DHIS2-compatible data model'],
  },
];

export function ProductPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-12">
        <div className="num text-[11px] tracking-widest text-accent-700 uppercase">Product</div>
        <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">One platform, four jobs done well.</h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-600">
          Collect, organise, analyse and connect — with the controls a public organisation needs.
        </p>
      </section>
      <div className="mx-auto grid max-w-6xl gap-6 px-5 pb-20">
        {BLOCKS.map((b, i) => (
          <section key={b.title} className="grid items-center gap-10 border border-zinc-200 bg-snow p-8 md:grid-cols-2 md:p-12">
            <div className={i % 2 ? 'md:order-2' : ''}>
              <div className="num text-[11px] tracking-widest text-accent-700 uppercase">{b.eyebrow}</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{b.title}</h2>
              <p className="mt-3 text-zinc-600">{b.body}</p>
            </div>
            <ul className="grid gap-3">
              {b.points.map((p) => (
                <li key={p} className="flex items-start gap-3 border-b border-zinc-200 pb-3 last:border-0">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center bg-accent-50 text-accent-700">
                    <Check className="size-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="border-t border-zinc-200 bg-snow">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-14">
          <h2 className="mr-auto text-2xl font-semibold tracking-[-0.02em]">See it with your own data.</h2>
          <Link to="/pricing" className={ctaSecondary}>View pricing</Link>
          <a href={SIGNUP_URL} className={ctaPrimary}>Start free trial</a>
        </div>
      </section>
    </>
  );
}
