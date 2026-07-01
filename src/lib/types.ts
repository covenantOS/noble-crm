// Cloudflare bindings + env. Requires @cloudflare/workers-types (dev dependency).
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  // vars
  BETTER_AUTH_URL: string;

  // secrets (wrangler secret put ...)
  BETTER_AUTH_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

// Authenticated user attached to Hono's context via the auth middleware in
// src/server/index.ts (c.set("user", ...)). role mirrors better-auth's
// user.role additional field: 'admin' | 'office' | 'estimator' | 'technician'.
export type AuthUser = { id: string; role: string; name: string; email: string };

// Hono generic: app = new Hono<{ Bindings: Env }>()
export type AppBindings = { Bindings: Env; Variables: { user: AuthUser } };
