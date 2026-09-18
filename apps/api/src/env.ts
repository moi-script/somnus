import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// One .env at the repo root, shared by every workspace.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });

const schema = z.object({
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/lacs'),
  API_PORT: z.coerce.number().int().optional(),
  /** Set by hosts such as Render; used when API_PORT is not. */
  PORT: z.coerce.number().int().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost,capacitor://localhost'),
  NODE_ENV: z.string().default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  // Fail at boot with the actual missing keys rather than at the first
  // request with an opaque undefined.
  throw new Error(`Invalid environment.\n${issues.join('\n')}\n\nCopy .env.example to .env.`);
}

export const env = parsed.data;
export const port = env.API_PORT ?? env.PORT ?? 4000;

/** The database address without its password, for logs. */
export function redactedMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, '//***@');
}
export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
