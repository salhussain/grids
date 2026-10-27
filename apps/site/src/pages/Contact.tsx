import { useState } from 'react';
import { ctaPrimary } from '../Layout';

const field = 'h-10 w-full border border-zinc-300 bg-snow px-3 text-sm hover:border-zinc-400';

export function ContactPage() {
  const [sent, setSent] = useState(false);
  return (
    <section className="mx-auto grid max-w-6xl gap-14 px-5 py-20 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <div className="num text-[11px] tracking-widest text-accent-700 uppercase">Contact</div>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Talk to the team</h1>
        <p className="mt-4 max-w-md text-lg text-zinc-600">
          Tell us about your programme. We’ll reply within one working day with a walkthrough and a quote if you need one.
        </p>
        <ul className="mt-8 grid gap-3 text-zinc-700">
          <li>A 30-minute demo using your own use case</li>
          <li>Advice on structure, roles and data model</li>
          <li>Pricing for ministries, NGOs and partner-funded programmes</li>
        </ul>
      </div>
      {sent ? (
        <div className="self-start border border-accent-100 bg-accent-50 p-8" role="status">
          <h2 className="text-xl font-semibold">Thanks, we’ve got it.</h2>
          <p className="mt-2 text-zinc-700">Someone will be in touch within one working day.</p>
        </div>
      ) : (
        <form
          className="grid gap-5 self-start border border-zinc-200 bg-snow p-7"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Your name
              <input required className={field} autoComplete="name" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Work email
              <input required type="email" className={field} autoComplete="email" />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Organisation
            <input required className={field} autoComplete="organization" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Team size
            <select className={field} defaultValue="">
              <option value="" disabled>Select</option>
              <option>1–10</option>
              <option>11–75</option>
              <option>76+</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            What are you trying to do?
            <textarea rows={4} className="w-full border border-zinc-300 bg-snow p-3 text-sm hover:border-zinc-400" />
          </label>
          <button type="submit" className={ctaPrimary}>
            Request a demo
          </button>
        </form>
      )}
    </section>
  );
}
