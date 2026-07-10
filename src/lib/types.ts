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

  // ── Notification provider keys (Phase 5, GATED) ──
  // All optional. src/lib/notify.ts checks for these at call time: if a key
  // is present it makes the real provider HTTP call; if ABSENT it returns
  // { sent:false, reason:"no provider configured" } and never pretends to send.
  //   - RESEND_API_KEY: Resend email API key (email provider).
  //   - RESEND_FROM: verified "from" address for Resend (e.g.
  //     "Westchase Painting <estimates@nobletampa.com>"). Required alongside
  //     RESEND_API_KEY for email to send.
  //   - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM: Twilio SMS creds
  //     + the sending phone number. All three needed for SMS to send.
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;

  // Optional Claude enhancer for Noble Assistant (C14). Keyless intent matcher
  // always works; when set, future tool-use drafting can call Anthropic.
  ANTHROPIC_API_KEY?: string;
}

// Authenticated user attached to Hono's context via the auth middleware in
// src/server/index.ts (c.set("user", ...)). role mirrors better-auth's
// user.role additional field: 'admin' | 'office' | 'estimator' | 'technician'.
export type AuthUser = { id: string; role: string; name: string; email: string };

// Hono generic: app = new Hono<{ Bindings: Env }>()
export type AppBindings = { Bindings: Env; Variables: { user: AuthUser } };
