// CLI-only config for `@better-auth/cli generate`. Never imported by the
// Worker -- it needs a statically-importable `auth` export with a real
// database handle, but the app's actual src/lib/auth.ts builds its db from
// per-request Cloudflare bindings (env.DB) that don't exist outside a
// Worker request. This file fakes a local sqlite db (better-sqlite3, a
// devDependency only) purely so the CLI can introspect the schema shape.
// Run with: pnpm dlx @better-auth/cli generate --config ./auth.cli-config.ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const db = drizzle(new Database(':memory:'));

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'pending',
        input: false,
      },
    },
  },
});
