import { z } from 'zod';

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'A hex colour like #0f62fe');
const LocaleCode = z.string().regex(/^[a-z]{2,3}$/);
const Image = z
  .string()
  .max(400_000)
  .regex(/^(data:image\/(png|svg\+xml|jpeg|webp);base64,|https:\/\/)/, 'PNG, SVG, JPEG or WebP image');

/** The platform's own look: the console and pages not tied to an organisation (sign-in, public portal). */
export const PlatformBranding = z.object({
  appName: z.string().trim().min(1).max(40).default('Grids'),
  primaryColor: Hex.default('#0f62fe'),
  logo: Image.nullable().default(null),
  /** Shown on the sign-in page when no organisation is involved. */
  welcomeMessage: z.string().trim().max(300).default(''),
  supportEmail: z.string().trim().max(200).default(''),
});
export type PlatformBranding = z.infer<typeof PlatformBranding>;

/**
 * Languages: what the console offers staff, and the defaults every new
 * organisation starts with (organisations can change theirs).
 */
export const PlatformLocalization = z
  .object({
    consoleLanguages: z.array(LocaleCode).min(1).max(20).default(['en']),
    consoleDefault: LocaleCode.default('en'),
    orgLanguages: z.array(LocaleCode).min(1).max(20).default(['en']),
    orgDefault: LocaleCode.default('en'),
  })
  .refine((l) => l.consoleLanguages.includes(l.consoleDefault), { message: 'The console default must be enabled', path: ['consoleDefault'] })
  .refine((l) => l.orgLanguages.includes(l.orgDefault), { message: 'The organisation default must be enabled', path: ['orgDefault'] });
export type PlatformLocalization = z.infer<typeof PlatformLocalization>;

export const PlatformSettingsDto = z.object({
  branding: z.object({
    appName: z.string(),
    primaryColor: z.string(),
    logo: z.string().nullable(),
    welcomeMessage: z.string(),
    supportEmail: z.string(),
  }),
  localization: z.object({
    consoleLanguages: z.array(z.string()),
    consoleDefault: z.string(),
    orgLanguages: z.array(z.string()),
    orgDefault: z.string(),
  }),
});
export type PlatformSettingsDto = z.infer<typeof PlatformSettingsDto>;
export const PlatformSettingsInput = z.object({ branding: PlatformBranding.optional(), localization: PlatformLocalization.optional() });
export type PlatformSettingsInput = z.input<typeof PlatformSettingsInput>;
