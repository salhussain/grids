import { describe, expect, it } from 'vitest';
import { catalogs, interpolate, resolveLocale, translator } from '../src/index.js';

const keys = (o: unknown, prefix = ''): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  const enKeys = keys(catalogs.en);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has every key with the same placeholders`, () => {
      expect(keys(catalog)).toEqual(enKeys);
      for (const k of enKeys) {
        const get = (c: unknown) => k.split('.').reduce<any>((o, p) => o[p], c);
        expect(vars(get(catalog)), `${locale}:${k}`).toEqual(vars(get(catalogs.en)));
        expect(get(catalog).trim().length, `${locale}:${k} empty`).toBeGreaterThan(0);
      }
    });
  }
});

describe('helpers', () => {
  it('resolves the best enabled locale', () => {
    expect(resolveLocale(['fr-CA', 'en'], ['en', 'fr'])).toBe('fr');
    expect(resolveLocale(['de'], ['en', 'ar'], 'ar')).toBe('ar');
    expect(resolveLocale([null, 'TPI'], ['en', 'tpi'])).toBe('tpi');
    expect(resolveLocale(['fr'], ['en'])).toBe('en');
  });
  it('translates with interpolation and English fallback', () => {
    expect(translator('es')('auth.signIn.subtitle', { name: 'Grids' })).toBe('para continuar en Grids');
    expect(translator('xx')('auth.signIn.title')).toBe('Sign in');
    expect(interpolate('{{a}} {{b}}', { a: 1 })).toBe('1 {{b}}');
  });
});
