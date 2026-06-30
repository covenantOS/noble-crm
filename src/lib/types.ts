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

// Hono generic: app = new Hono<{ Bindings: Env }>()
export type AppBindings = { Bindings: Env };
