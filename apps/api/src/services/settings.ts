import { LOCALE_CODES } from '@grids/i18n';
import { PlatformBranding, PlatformLocalization, type PlatformSettingsDto, type PlatformSettingsInput } from '@grids/schema';
import { badRequest } from '../errors.js';
import { requireStaff } from './authz.js';
import { audit, type Actor, type ServiceContext } from './context.js';

/** Platform-wide branding and languages (console, sign-in, organisation defaults). */
export class SettingsService {
  constructor(private readonly ctx: ServiceContext) {}

  async get(): Promise<PlatformSettingsDto> {
    const rows = await this.ctx.db.selectFrom('platform_setting').select(['key', 'value']).where('key', 'in', ['branding', 'localization']).execute();
    const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const branding = PlatformBranding.safeParse(raw.branding ?? {});
    const localization = PlatformLocalization.safeParse(raw.localization ?? {});
    return {
      branding: branding.success ? branding.data : PlatformBranding.parse({}),
      localization: localization.success ? localization.data : PlatformLocalization.parse({}),
    };
  }

  async update(actor: Actor, input: PlatformSettingsInput): Promise<PlatformSettingsDto> {
    requireStaff(actor, 'settings.manage');
    if (input.localization) {
      const l = PlatformLocalization.parse(input.localization);
      const unknown = [...l.consoleLanguages, ...l.orgLanguages].filter((c) => !(LOCALE_CODES as string[]).includes(c));
      if (unknown.length) throw badRequest(`Unsupported language: ${[...new Set(unknown)].join(', ')}`);
    }
    for (const key of ['branding', 'localization'] as const) {
      const value = input[key];
      if (!value) continue;
      const parsed = key === 'branding' ? PlatformBranding.parse(value) : PlatformLocalization.parse(value);
      await this.ctx.db
        .insertInto('platform_setting')
        .values({ key, value: JSON.stringify(parsed) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(parsed), updated_at: this.ctx.now() }))
        .execute();
    }
    await audit(this.ctx, actor.id, null, 'platform.settings_updated', { sections: Object.keys(input).join(', ') });
    return this.get();
  }

  /** Languages a new organisation starts with. */
  async orgDefaults(): Promise<{ languages: string[]; defaultLanguage: string; overrides: Record<string, never> }> {
    const { localization: l } = await this.get();
    return { languages: l.orgLanguages, defaultLanguage: l.orgDefault, overrides: {} };
  }
}
