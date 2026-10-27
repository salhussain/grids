import { Link } from '@tanstack/react-router';
import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { ctaPrimary, ctaSecondary } from '../Layout';
import { ANNUAL_DISCOUNT, COMPARE, FAQ, PLANS, price } from '../content';
import { SIGNUP_URL } from '../env';

const Cell = ({ v }: { v: string | boolean }) =>
  v === true ? (
    <Check className="mx-auto size-4 text-accent-600" aria-label="Included" />
  ) : v === false ? (
    <Minus className="mx-auto size-4 text-zinc-300" aria-label="Not included" />
  ) : (
    <span className="num">{v}</span>
  );

export function PricingPage() {
  const [annual, setAnnual] = useState(true);
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-10 text-center">
        <div className="num text-[11px] tracking-widest text-accent-700 uppercase">Pricing</div>
        <h1 className="mx-auto mt-2 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Plans for every stage of your programme
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-600">Start with a 14-day trial. No card needed.</p>
        <div
          role="group"
          aria-label="Billing period"
          className="mt-8 inline-flex gap-px border border-zinc-300 bg-zinc-300"
        >
          {[
            [false, 'Monthly'],
            [true, `Annual · save ${ANNUAL_DISCOUNT * 100}%`],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={annual === v}
              onClick={() => setAnnual(v as boolean)}
              className={`px-4 py-2 text-sm transition-colors ${annual === v ? 'bg-ink text-canvas' : 'bg-snow text-zinc-700 hover:bg-zinc-50'}`}
            >
              {l as string}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-20 md:grid-cols-3">
        {PLANS.map((p) => {
          const amount = price(p, annual);
          return (
            <div
              key={p.id}
              className={`flex flex-col border bg-snow p-7 ${p.popular ? 'border-accent-600 shadow-raised' : 'border-zinc-200'}`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{p.name}</h2>
                {p.popular && <span className="bg-accent-600 px-2 py-0.5 text-[11px] font-medium text-on-accent">Most popular</span>}
              </div>
              <p className="mt-2 min-h-12 text-sm text-zinc-600">{p.blurb}</p>
              <div className="num mt-5 text-5xl font-semibold tracking-[-0.03em]">
                {amount === null ? 'Custom' : `$${amount}`}
              </div>
              <div className="mt-1 h-5 text-sm text-zinc-500">
                {amount === null ? 'Tailored to your volume' : `per month${annual ? ', billed annually' : ''}`}
              </div>
              {p.id === 'enterprise' ? (
                <Link to="/contact" className={`${ctaSecondary} mt-6`}>
                  {p.cta}
                </Link>
              ) : (
                <a href={`${SIGNUP_URL}?plan=${p.id}`} className={`${p.popular ? ctaPrimary : ctaSecondary} mt-6`}>
                  {p.cta}
                </a>
              )}
              <ul className="mt-7 grid gap-3 border-t border-zinc-200 pt-6 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-600" /> {h}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="border-y border-zinc-200 bg-snow">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-[-0.02em]">Compare plans</h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300">
                  <th className="w-[34%] py-3 text-left font-medium" />
                  {PLANS.map((p) => (
                    <th key={p.id} className="py-3 text-center text-base font-semibold">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARE.map((g) => (
                <tbody key={g.group}>
                  <tr>
                    <td colSpan={4} className="num pt-8 pb-2 text-[11px] tracking-widest text-zinc-500 uppercase">
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map(([label, a, b, c]) => (
                    <tr key={label} className="border-b border-zinc-200">
                      <td className="py-3 pr-4 text-zinc-700">{label}</td>
                      {[a, b, c].map((v, i) => (
                        <td key={i} className="py-3 text-center">
                          <Cell v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">Questions, answered</h2>
        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <span className="text-xl text-zinc-400 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-zinc-600">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-zinc-600">
          Still unsure?{' '}
          <Link to="/contact" className="font-medium text-accent-700 hover:underline">
            Talk to us
          </Link>
          .
        </p>
      </section>
    </>
  );
}
