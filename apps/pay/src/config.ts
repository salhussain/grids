import { z } from 'zod';

const Env = z.object({
  PAY_PORT: z.coerce.number().default(4400),
  /** Where people's browsers reach GridPay (the payment pages). */
  PAY_PUBLIC_URL: z.string().default('http://localhost:4400'),
  DATABASE_URL_PAY_APP: z.string(),
  /** Shared secret for the platform API's calls to /internal/*, and for GridPay's calls back to it. */
  PAY_SERVICE_TOKEN: z.string().min(16),
  /** Encrypts merchants' API keys at rest (AES-256-GCM; key derived via SHA-256). */
  PAY_SECRET_KEY: z.string().min(16),
  /** Platform API base URL, told when a payment ends. */
  API_URL: z.string().default('http://localhost:4000'),
  NODE_ENV: z.string().default('development'),
});
export type PayConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PayConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
