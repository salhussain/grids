import { z } from 'zod';

const Env = z.object({
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL_PLATFORM: z.string(),
  CONSOLE_URL: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().default('http://localhost:5174'),
  /** Public portal: public projects for everyone, more after signing in. */
  PORTAL_URL: z.string().default('http://localhost:5176'),
  /** OIDC issuer of the Grids identity service (apps/identity). */
  IDENTITY_ISSUER: z.string().default('http://localhost:4100/oidc'),
  /** Base URL of the identity service's internal API. */
  IDENTITY_INTERNAL_URL: z.string().default('http://localhost:4100'),
  IDENTITY_SERVICE_TOKEN: z.string().min(16),
  /** Resource indicator the identity service puts in access-token `aud`. */
  API_AUDIENCE: z.string().default('urn:grids:api'),
  /** `log` = record only (read in the console's Email log); otherwise an SMTP URL. */
  SMTP_URL: z.string().default('log'),
  NODE_ENV: z.string().default('development'),
  MAIL_FROM: z.string().default('Grids <no-reply@grids.local>'),
  SUPPORT_EMAIL: z.string().default('support@grids.local'),
  /** Tenants get `{slug}.{BASE_DOMAIN}`; custom domains CNAME to `edge.{BASE_DOMAIN}`. */
  BASE_DOMAIN: z.string().default('grids.localhost'),
  /** Dev only: `*.localhost` / `*.test` custom domains verify without DNS. */
  DOMAIN_DEV_AUTOVERIFY: z.stringbool().default(true),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
