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
//
// ROLES: 'admin' | 'office' | 'estimator' | 'technician' are the working
// roles. 'pending' is a powerless placeholder -- a brand-new account defaults
// to it and gets access to NOTHING (the /api/* middleware in index.ts 403s
// any pending user). This is a security default: an accidental or unauthorized
// self-signup must never land in a privileged role. The ONLY paths that grant
// a real role are (a) the first-run bootstrap in index.ts (first ever signup
// becomes 'admin') and (b) admin-created users via POST /api/users, which set
// the chosen role directly after creation. Because `input: false` below, the
// signup body can never set its own role -- it always starts as this default.
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
          defaultValue: 'pending', // powerless until an admin grants a real role
          input: false, // role is set by an admin, not at signup
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
