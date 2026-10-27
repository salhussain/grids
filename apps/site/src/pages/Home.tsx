import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  ChartColumn,
  ClipboardList,
  Network,
  Palette,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { ctaPrimary, ctaSecondary } from '../Layout';
import { FEATURES, PLANS, USE_CASES, price } from '../content';
import { SIGNUP_URL } from '../env';

const ICONS: Record<(typeof FEATURES)[number]['icon'], LucideIcon> = {
  ClipboardList,
  Network,
  ChartColumn,
  ShieldCheck,
  Palette,
  Workflow,
};

export function Section({
  eyebrow,
  title,
  lead,
  children,
  tint,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  tint?: boolean;
}) {
  return (
    <section className={tint ? 'border-y border-zinc-200 bg-snow' : ''}>
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-12 max-w-2xl">
          {eyebrow && <div className="num text-[11px] tracking-widest text-accent-700 uppercase">{eyebrow}</div>}
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{title}</h2>
          {lead && <p className="mt-3 text-lg text-zinc-600">{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A mock of the product: KPI tiles and bars, drawn with plain divs so it themes with the page. */
function ProductShot() {
  const bars = [38, 52, 44, 61, 58, 72, 66, 80, 74, 91, 86, 100];
  return (
    <div className="border border-zinc-200 bg-snow shadow-raised" aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-4 py-3">
        <span className="size-2.5 bg-zinc-300" />
        <span className="size-2.5 bg-zinc-300" />
        <span className="size-2.5 bg-zinc-300" />
        <span className="num ml-3 text-xs text-zinc-500">moh.grids.app / dashboard</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-zinc-200">
        {[['Facilities reporting', '94%'], ['Submissions this week', '12,480'], ['Open alerts', '3']].map(([l, v]) => (
          <div key={l} className="bg-snow p-4">
            <div className="text-xs text-zinc-500">{l}</div>
            <div className="num mt-2 text-2xl font-semibold tracking-tight">{v}</div>
          </div>
        ))}
      </div>
      <div className="p-5">
        <div className="mb-3 text-xs text-zinc-500">Weekly completeness</div>
        <div className="flex h-36 items-end gap-2">
          {bars.map((h, i) => (
            <div key={i} style={{ height: `${h}%` }} className="flex-1 bg-accent-600/80 first:bg-accent-600/40" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-20 pb-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="num inline-flex items-center gap-2 border border-accent-100 bg-accent-50 px-2.5 py-1 text-[11px] tracking-widest text-accent-700 uppercase">
              Field data platform
            </div>
            <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-6xl">
              From the field to the dashboard, in one place.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-600">
              Grids lets ministries, agencies and NGOs collect data on any device, control who sees what, and publish live
              dashboards — without stitching tools together.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={SIGNUP_URL} className={ctaPrimary}>
                Start 14-day free trial <ArrowRight className="size-4" />
              </a>
              <Link to="/contact" className={ctaSecondary}>
                Book a demo
              </Link>
            </div>
            <p className="mt-4 text-sm text-zinc-500">No card needed. Cancel any time.</p>
          </div>
          <ProductShot />
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-snow">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-zinc-200 md:grid-cols-4">
          {[['9', 'countries'], ['40k+', 'forms filled each week'], ['99.9%', 'uptime target'], ['6', 'languages built in']].map(([v, l]) => (
            <div key={l} className="bg-snow px-5 py-8">
              <div className="num text-3xl font-semibold tracking-tight">{v}</div>
              <div className="mt-1 text-sm text-zinc-600">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <Section eyebrow="Platform" title="Everything a data programme needs" lead="One workspace for collection, access control, analysis and publishing.">
        <div className="grid gap-px border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon];
            return (
              <div key={f.title} className="bg-snow p-7">
                <span className="flex size-10 items-center justify-center border border-accent-100 bg-accent-50 text-accent-700">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-[15px] text-zinc-600">{f.body}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section tint eyebrow="How it works" title="Live in an afternoon">
        <ol className="grid gap-8 md:grid-cols-3">
          {[
            ['Set up your organisation', 'Add your logo, colours and structure. Invite the people who will collect and review data.'],
            ['Build forms and projects', 'Design forms visually, define what you track, and assign each project to the right team.'],
            ['Publish what matters', 'Share dashboards and maps with partners or the public. Keep everything else private.'],
          ].map(([t, b], i) => (
            <li key={t} className="border-t-2 border-ink pt-5">
              <div className="num text-sm text-zinc-500">0{i + 1}</div>
              <h3 className="mt-2 text-xl font-semibold">{t}</h3>
              <p className="mt-2 text-zinc-600">{b}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Use cases" title="Built for public services">
        <div className="grid gap-4 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <div key={u.title} className="border border-zinc-200 bg-snow p-6 transition-colors hover:border-zinc-400">
              <h3 className="text-lg font-semibold">{u.title}</h3>
              <p className="mt-2 text-zinc-600">{u.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tint eyebrow="Pricing" title="Simple plans that grow with you" lead="Start free for 14 days. Pay monthly or save 20% annually.">
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.id} className={`border bg-canvas p-6 ${p.popular ? 'border-accent-600' : 'border-zinc-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {p.popular && <span className="bg-accent-600 px-2 py-0.5 text-[11px] font-medium text-on-accent">Popular</span>}
              </div>
              <div className="num mt-4 text-4xl font-semibold tracking-tight">
                {p.monthly === null ? 'Custom' : `$${price(p, false)}`}
                {p.monthly !== null && <span className="text-sm font-normal text-zinc-500"> /month</span>}
              </div>
              <ul className="mt-5 grid gap-2 text-sm">
                {p.highlights.slice(0, 4).map((h) => (
                  <li key={h} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-600" /> {h}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link to="/pricing" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline">
          Compare every plan <ArrowRight className="size-4" />
        </Link>
      </Section>

      <section className="bg-chrome text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.02em]">Ready to see your data on one screen?</h2>
            <p className="mt-2 text-zinc-300">Start a trial in minutes, or let us walk you through it.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={SIGNUP_URL} className={ctaPrimary}>Start free trial</a>
            <Link to="/contact" className="inline-flex h-10 items-center border border-white/30 px-5 text-sm font-medium hover:bg-white/10">
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
