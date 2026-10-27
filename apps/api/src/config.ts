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
  /** GridPay (the payment service): where the API reaches it, and the shared secret for calls in both directions. */
  PAY_URL: z.string().default('http://localhost:4400'),
  PAY_SERVICE_TOKEN: z.string().min(16),
  /** Resource indicator the identity service puts in access-token `aud`. */
  API_AUDIENCE: z.string().default('urn:grids:api'),
  /** `log` = record only (read in the console's Email log); otherwise an SMTP URL. */
  SMTP_URL: z.string().default('log'),
  NODE_ENV: z.string().default('development'),
  /** 32 random bytes, base64 (openssl rand -base64 32): encrypts project variables. Required in production. */
  SECRETS_KEY: z.string().optional(),
  /** Lets project connections reach private network addresses. Off in production unless set. */
  CONNECTIONS_ALLOW_PRIVATE: z.stringbool().optional(),
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
