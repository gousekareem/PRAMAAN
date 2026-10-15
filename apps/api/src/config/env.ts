import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** disable = no TLS (local or Render private network); verify-full = TLS with certificate verification. */
    DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
    DATABASE_CA_CERT: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('pramaan-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    COOKIE_SECURE: bool.optional(),
    /** 'strict' when dashboard and API share a site; 'none' (+Secure) when they are on different sites. */
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),
    MAX_EVIDENCE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(8 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    MAX_JSON_BODY_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(10 * 1024 * 1024)
      .default(2 * 1024 * 1024),
    MAX_UPLOAD_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().min(10).default(600),
    RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_SYNC_PER_MIN: z.coerce.number().int().min(1).default(120),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ALLOW_DEMO_SEED: bool.default(false),
    SEED_DEMO_PASSWORD: z.string().optional(),
    /** Allows accounts flagged is_demo to sign in. Defaults to true outside production and false in
     *  production; enabling it in production is an explicit, logged configuration decision. */
    ALLOW_DEMO_LOGIN: bool.optional(),
    /** Interval of the server-side duty exception evaluator (0 disables the timer). */
    EXCEPTION_EVALUATOR_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /** Optional JSON file written by scripts/backup-restore-check.sh; shown on the status page only if present. */
    BACKUP_VERIFICATION_FILE: z.string().optional(),
    FUTURE_SKEW_TOLERANCE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(5 * 60_000),
    RUN_MIGRATIONS_ON_START: bool.default(false),
    DUTY_GRACE_MINUTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .default(120),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production') {
      if (/change|example|dev|test|secret/i.test(v.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'production secret looks like a placeholder',
        });
      }
      if (v.CORS_ORIGINS.split(',').some((o) => o.trim() === '*' || o.includes('localhost'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'production CORS must be an explicit non-localhost allowlist',
        });
      }
      if (v.ALLOW_DEMO_SEED) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOW_DEMO_SEED'],
          message: 'demo seeding must be disabled in production',
        });
      }
      if (v.COOKIE_SECURE === false) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'cookies must be Secure in production',
        });
      }
    }
  });

export type Env = z.infer<typeof schema> & {
  corsOrigins: string[];
  cookieSecure: boolean;
  demoLoginAllowed: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const v = parsed.data;
  return {
    ...v,
    corsOrigins: v.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: v.COOKIE_SECURE ?? v.NODE_ENV === 'production',
    demoLoginAllowed: v.ALLOW_DEMO_LOGIN ?? v.NODE_ENV !== 'production',
  };
}

const dbSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
});

export type DatabaseEnv = z.infer<typeof dbSchema>;

/** Minimal configuration for operator CLIs (migrations, audit verification, user creation). */
export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  const r = dbSchema.safeParse(source);
  if (!r.success) throw new Error(`Invalid configuration: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
