// Reminder message shape enqueued by createJob/updateJob (see src/server/index.ts)
// and consumed by the queue() handler (src/server/index.ts's default export).
// Kept here alongside Env so both the producer and consumer sides can import
// the same type instead of redeclaring it.
export type ReminderMessage = {
  type: "job_reminder";
  job_id: number;
  scheduled_date: string;
};

// Cloudflare bindings + env. Requires @cloudflare/workers-types (dev dependency).
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  // Producer binding for the "westchase-reminders" queue (see wrangler.jsonc's
  // queues.producers/consumers) -- named after the DB/BUCKET style already
  // used for other bindings here, just spelled out for what it's for.
  REMINDERS: Queue<ReminderMessage>;

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
