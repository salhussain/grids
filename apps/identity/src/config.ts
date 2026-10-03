import { resolve } from 'node:path';
import { z } from 'zod';

const Env = z.object({
  IDENTITY_PORT: z.coerce.number().default(4100),
  /** Public issuer URL (includes the /oidc mount path). */
  IDENTITY_ISSUER: z.string().default('http://localhost:4100/oidc'),
  DATABASE_URL_IDENTITY_APP: z.string(),
  /** Shared secret for the platform API's internal calls (/internal/*). */
  IDENTITY_SERVICE_TOKEN: z.string().min(16),
  /** Encrypts TOTP secrets at rest (AES-256-GCM; key derived via SHA-256). */
  IDENTITY_SECRET_KEY: z.string().min(16),
  IDENTITY_COOKIE_KEY: z.string().min(16),
  API_AUDIENCE: z.string().default('urn:grids:api'),
  /** Platform API base URL, for tenant branding on the login page. */
  API_URL: z.string().default('http://localhost:4000'),
  CONSOLE_URL: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().default('http://localhost:5174'),
  /** `platform` = relay through the platform API (default); otherwise an SMTP URL. */
  IDENTITY_MAIL: z.string().default('platform'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Grids <no-reply@grids.local>'),
  /** Built login app served at /ui. */
  LOGIN_DIST: z.string().default(resolve(import.meta.dirname, '../../login/dist')),
  NODE_ENV: z.string().default('development'),
});
export type IdentityConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Public origin of the identity service (issuer without the /oidc path). */
export const originOf = (issuer: string) => new URL(issuer).origin;
