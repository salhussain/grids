import { Link, Outlet } from '@tanstack/react-router';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LOGIN_URL, SIGNUP_URL } from './env';

export const LINKS = [
  { to: '/product', label: 'Product' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/contact', label: 'Contact' },
] as const;

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-semibold tracking-tight ${className}`}>
      <span className="flex size-7 items-center justify-center bg-accent-600 text-on-accent">
        <svg viewBox="0 0 32 32" className="size-4" fill="currentColor" aria-hidden>
          <path d="M5 5h10v10H5zM17 5h10v10H17zM5 17h10v10H5zM17 17h10v10H17z" />
        </svg>
      </span>
      Grids
    </span>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        try {
          localStorage.setItem('grids.colorMode', next ? 'dark' : 'light');
        } catch {
          /* storage unavailable: the mode still applies for this visit */
        }
      }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex size-9 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-ink"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export const ctaPrimary =
  'inline-flex h-10 items-center justify-center gap-2 bg-accent-600 px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-700';
export const ctaSecondary =
  'inline-flex h-10 items-center justify-center gap-2 border border-zinc-300 bg-snow px-5 text-sm font-medium text-ink transition-colors hover:border-zinc-500';

function Header() {
  const [open, setOpen] = useState(false);
  const link = 'px-3 py-2 text-sm text-zinc-600 hover:text-ink [&.active]:text-ink [&.active]:font-medium';
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link to="/" aria-label="Grids home">
          <Logo />
        </Link>
        <nav className="hidden items-center md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className={link}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <a href={LOGIN_URL} className="hidden px-3 py-2 text-sm text-zinc-600 hover:text-ink sm:block">
            Sign in
          </a>
          <a href={SIGNUP_URL} className={`${ctaPrimary} hidden h-9 sm:inline-flex`}>
            Start free trial
          </a>
          <button
            type="button"
            className="flex size-9 items-center justify-center md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-zinc-200 bg-canvas px-5 py-3 md:hidden" aria-label="Mobile">
          {[...LINKS].map((l) => (
            <Link key={l.to} to={l.to} className="block py-2.5 text-[15px]" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <a href={LOGIN_URL} className="block py-2.5 text-[15px]">
            Sign in
          </a>
          <a href={SIGNUP_URL} className={`${ctaPrimary} mt-2 w-full`}>
            Start free trial
          </a>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  const col = 'text-sm text-zinc-600 hover:text-ink';
  return (
    <footer className="border-t border-zinc-200 bg-snow">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-zinc-600">
            Field data, from collection to dashboard. Built for the people who run public services.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <div className="num text-[11px] tracking-widest text-zinc-500 uppercase">Product</div>
          <Link to="/product" className={col}>Features</Link>
          <Link to="/pricing" className={col}>Pricing</Link>
          <a href={LOGIN_URL} className={col}>Sign in</a>
        </div>
        <div className="grid content-start gap-2">
          <div className="num text-[11px] tracking-widest text-zinc-500 uppercase">Company</div>
          <Link to="/contact" className={col}>Contact</Link>
          <Link to="/contact" className={col}>Book a demo</Link>
        </div>
        <div className="grid content-start gap-2">
          <div className="num text-[11px] tracking-widest text-zinc-500 uppercase">Legal</div>
          <span className={col}>Privacy</span>
          <span className={col}>Terms</span>
        </div>
      </div>
      <div className="border-t border-zinc-200 py-5 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} Grids. All rights reserved.
      </div>
    </footer>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
