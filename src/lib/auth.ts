import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '../db';
import type { Env } from './types';

// better-auth instance, created per request with the env bindings.
//
// Mount in src/server/index.ts (Hono):
//   import { createAuth } from '../lib/auth';
//   app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));
//
// Guard a route:
//   const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
//   if (!session) return c.json({ error: 'unauthorized' }, 401);
//   const role = session.user.role; // 'admin' | 'office' | 'estimator' | 'technician'
export function createAuth(env: Env) {
  const db = getDb(env);
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'office',
          input: false, // role is set by an admin, not at signup
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
