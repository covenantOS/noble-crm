import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, asc, desc, eq, or, sql, inArray, type Column, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createAuth } from "../lib/auth.js";
import type { AppBindings, Env, ReminderMessage } from "../lib/types.js";
import { buildDocumentPdf, type PdfLine } from "../lib/pdf.js";
import { sendEmail, escapeHtml } from "../lib/notify.js";
import { createInvoiceCheckout, verifyStripeWebhook } from "../lib/payments.js";
import { ACORN_FINANCE_URL } from "../lib/business.js";

// defaultHook normalizes EVERY Zod request-validation failure across all
// app.openapi routes into a clean 400 { error } shape (first issue's message),
// instead of OpenAPIHono's default verbose ZodError payload. This gives the
// client one consistent error contract for bad input and keeps internal Zod
// structure out of the response.
const app = new OpenAPIHono<AppBindings>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
      return c.json({ error: `${path}${issue?.message || "Invalid request"}` }, 400);
    }
  },
});

// ── Timezone helper ────────────────────────────────────────────────
// The business runs in Tampa (America/New_York). "Today" for user-facing
// calendar logic (which day a job is scheduled for, the recurring-agreement
// due cutoff, dashboard "today's jobs") must be computed in that zone, NOT
// UTC -- a UTC "today" rolls over at 8pm/7pm Tampa time, so an evening job
// created in Tampa would land on tomorrow's date. Intl.DateTimeFormat with an
// explicit timeZone works in the Workers runtime. Returns "YYYY-MM-DD".
// NOTE: only for user-facing "which calendar day" logic -- created_at/
// updated_at audit timestamps stay UTC (that's correct for storage).
const NY_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function todayInTampa(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return NY_DATE_FMT.format(new Date());
}

// ── Reusable validation refinements ────────────────────────────────
// Strict "YYYY-MM-DD" calendar-date validator: rejects garbage ("not-a-date"),
// out-of-range ("2026-13-45"), and empty strings. It isn't enough to regex the
// shape -- "2026-02-30" matches the shape but isn't a real day, so we re-parse
// with Date.UTC and confirm the components round-trip.
function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// z.string() that must be a real calendar date. Use .optional() at the call
// site where the field is optional.
const zDate = z.string().refine(isValidCalendarDate, { message: "Invalid date -- must be a real YYYY-MM-DD calendar date" });

// Adds N calendar months to a "YYYY-MM-DD" date, clamping the day to the
// target month's actual last day (e.g. Jan 31 + 1 month -> Feb 28, or Feb 29
// in a leap year) instead of overflowing into the following month the way a
// naive setMonth/setDate(31) would. Mirrors the same clamp-the-target-month
// approach as advanceByInterval further down (used for service-agreement
// recurrence) -- kept as its own small helper here rather than reusing
// advanceByInterval directly, since that one is keyed on a fixed
// "anchorDay" concept specific to recurring agreements, whereas warranty math
// just needs "N months from THIS date" with no re-clamping anchor to track.
// Used by updateJob's warranty_expires_at computation.
function addCalendarMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const totalMonths = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-indexed, safe for negative months too
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(d, daysInTargetMonth);
  const dt = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  return dt.toISOString().split("T")[0];
}
// 24-hour HH:MM time.
const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Invalid time -- must be HH:MM (24-hour)" });
// A required human-readable name: trimmed, non-empty.
const zName = z.string().trim().min(1, { message: "Required -- cannot be blank" });
// A brand color: "#rgb" or "#rrggbb" only. These values get interpolated
// directly into a raw <style> block on the public customer-facing estimate
// page (see customerPageShell in the public routes below), so a strict format
// here isn't just data hygiene -- it's what keeps that unauthenticated,
// no-escaping render path from being a stored-XSS vector.
const zHexColor = z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/, { message: "Must be a hex color like #1a2b4a" });

// ── Money: integer-cents storage <-> decimal-dollars wire format ──────
// The DB stores every money column as INTEGER CENTS (see the cents-migration
// note atop src/db/schema.ts) -- this eliminates float-drift in tax math and
// running payment balances. The public API/JSON contract is UNCHANGED: every
// request body the client sends and every response body the client receives
// still speaks decimal DOLLARS, exactly as before. These two helpers are the
// ONLY place that conversion happens -- toCents() right where a dollar value
// coming from client input (or computed from other dollar values) is about to
// be written via db.insert/db.update, and fromCents() right where a cents
// value read out of a Drizzle query result is about to be handed to c.json(),
// buildDocumentPdf(), sendEmail(), or createInvoiceCheckout(). If you find
// yourself wanting to touch client .tsx/format.ts/pdf.ts/notify.ts money
// formatting to "fix" a wrong-looking amount, that's a sign a boundary
// conversion is missing HERE, not a reason to change those files.
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
function fromCents(cents: number): number {
  return cents / 100;
}
// Same as fromCents but passes null/undefined through unchanged -- for
// nullable money columns (e.g. estimates.deposit_amount) where "no value" must
// stay null in the API response, not become 0.
function fromCentsNullable(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : fromCents(cents);
}
// Money the client supplies: never negative. (Zero is allowed -- e.g. a $0
// service line or a free item; over-collection/positive-only cases use
// zPositive below.)
const zMoney = z.number().nonnegative({ message: "Must not be negative" });
// Quantities and amounts that must be strictly positive (a payment of $0 or a
// line quantity of 0 is nonsensical).
const zPositive = z.number().positive({ message: "Must be greater than zero" });
// Tax rate as a percentage 0..100.
const zTaxRate = z.number().min(0, { message: "Tax rate cannot be negative" }).max(100, { message: "Tax rate cannot exceed 100" });

// A review-site URL (Google/Yelp/Facebook/etc). Only validated as a URL when
// present -- brands.review_url is nullable/optional (see /api/jobs/{id}/request-review).
const zUrl = z.string().url({ message: "Must be a valid URL" });

// Allowed value sets for previously-free-string status/enum fields. Kept as
// consts so they're reusable in both the Zod schema and any error message.
const JOB_STATUSES = ["scheduled", "confirmed", "in_progress", "completed", "cancelled"] as const;
const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "cancelled"] as const;
const RECURRENCE_INTERVALS = ["weekly", "monthly", "quarterly", "annual"] as const;
// Lead-pipeline value sets for the customers table. status is where the
// customer sits in the sales funnel (defaults to 'lead'); source is how they
// came in (nullable -- may be unknown). Neither auto-transitions.
const CUSTOMER_STATUSES = ["lead", "active", "inactive"] as const;
const CUSTOMER_SOURCES = ["referral", "google", "repeat", "website", "other"] as const;
// Change-order lifecycle -- see /api/change-orders/{id}/approve|reject.
const CHANGE_ORDER_STATUSES = ["pending", "approved", "rejected"] as const;

// The roles an admin may assign. 'pending' is included so an admin can revoke
// access by parking a user back at pending; 'admin' is included so an admin
// can promote a co-owner. See src/lib/auth.ts for what each role means.
const ASSIGNABLE_ROLES = ["admin", "office", "estimator", "technician", "pending"] as const;

// ── Existence-check helper (referential sanity) ────────────────────
// Creating a job/estimate/invoice with an FK id that doesn't exist would
// otherwise surface as a raw 500 D1 constraint error (or, for SET NULL FKs,
// silently succeed with a dangling reference). These helpers let a route
// return a clean 400 "<thing> not found" instead. Each returns true if the id
// exists (or is null/undefined, i.e. "not provided -- nothing to check").
async function customerExists(db: ReturnType<typeof getDb>, id: number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const row = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, id)).get();
  return !!row;
}
// Unlike the *Exists helpers above (which treat null as "not provided, OK"),
// this requires the job to actually exist -- used by the job sub-resource
// create routes (notes/checklist/materials) so a bad job_id path param 404s
// cleanly instead of hitting an FK violation and surfacing as a raw 500.
async function jobExists(db: ReturnType<typeof getDb>, id: number): Promise<boolean> {
  const row = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  return !!row;
}
async function technicianExists(db: ReturnType<typeof getDb>, id: number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const row = await db.select({ id: schema.technicians.id }).from(schema.technicians).where(eq(schema.technicians.id, id)).get();
  return !!row;
}
async function serviceTypeExists(db: ReturnType<typeof getDb>, id: number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const row = await db.select({ id: schema.serviceTypes.id }).from(schema.serviceTypes).where(eq(schema.serviceTypes.id, id)).get();
  return !!row;
}
async function brandExists(db: ReturnType<typeof getDb>, id: number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const row = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, id)).get();
  return !!row;
}

// ── Multi-account (brand) list scoping ─────────────────────────────
// Every list/stats endpoint that returns account-ownable data (customers,
// jobs, estimates, invoices, service agreements, schedule, dashboard stats)
// accepts an optional ?brand_id= filter. Validation contract:
//   - garbage ("abc", "-3", "1.5", "0") -> 400 via the Zod regex below
//     (positive integers only; the defaultHook turns the failure into a
//     clean 400 { error }),
//   - a well-formed id for a brand that doesn't exist -> 404 via
//     resolveBrandFilter,
//   - absent -> null (no filtering -- "All Accounts").
// COMPOSITION RULE (security-critical): the brand condition is always pushed
// into the SAME conditions array as the technician ownership force-filter --
// it composes with (never replaces) that scoping. A technician filtered to a
// brand still only ever sees their own/crew jobs.
const zBrandIdQuery = z.string().regex(/^[1-9]\d*$/, { message: "brand_id must be a positive integer" }).optional();

// { ok:true, brandId:null } = no filter requested; { ok:false } = the id was
// well-formed but no such brand exists (caller returns its own typed 404 --
// OpenAPIHono's typed handlers reject a raw Response minted inside a helper).
async function resolveBrandFilter(
  db: ReturnType<typeof getDb>,
  raw: string | undefined,
): Promise<{ ok: true; brandId: number | null } | { ok: false; brandId?: never }> {
  if (!raw) return { ok: true, brandId: null };
  const brandId = parseInt(raw, 10);
  const row = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, brandId)).get();
  if (!row) return { ok: false };
  return { ok: true, brandId };
}

// ── Auth ───────────────────────────────────────────────────────────
// better-auth owns everything under /api/auth/* (sign-up, sign-in, sign-out,
// session, etc). Mounted before the auth-required middleware below, and the
// middleware explicitly skips this prefix, so these routes stay public.
//
// FIRST-RUN BOOTSTRAP + rate-limit guard sit IN FRONT of the better-auth
// handler for the two sensitive POST endpoints (sign-up, sign-in):
//
//   - Public sign-up is only allowed when the user table is EMPTY. That first
//     account is the owner bootstrapping the system and is promoted to "admin"
//     immediately after creation. Once any user exists, public sign-up is
//     rejected 403 -- all further users are created by an admin via
//     POST /api/users. (better-auth's role defaultValue is "pending", so even
//     if this guard were bypassed the new user would have zero access.)
//   - Basic D1-backed rate limiting by IP on both sign-in and sign-up (see
//     checkAuthRateLimit) blunts brute-force / signup-spam. This is a coarse
//     app-level backstop; production should ALSO enforce Cloudflare's
//     dashboard rate-limiting rules / rate-limit binding at the edge.

// Simple D1-backed fixed-window attempt counter keyed by "ip:bucket". Stored
// in the _meta table (key/value) to avoid a schema migration for this chunk --
// key is `ratelimit:<action>:<ip>:<windowStart>`, value is the count. Returns
// true if the caller is over the limit for the current window. Failures here
// are swallowed (fail-open) so a metadata hiccup never locks out real users.
const RATE_LIMIT_MAX = 10; // attempts per window per IP per action
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes
async function checkAuthRateLimit(db: ReturnType<typeof getDb>, action: string, ip: string): Promise<boolean> {
  try {
    const windowStart = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
    const key = `ratelimit:${action}:${ip}:${windowStart}`;
    const row = await db.select().from(schema.meta).where(eq(schema.meta.key, key)).get();
    const count = row ? parseInt(row.value, 10) || 0 : 0;
    if (count >= RATE_LIMIT_MAX) return true;
    if (row) {
      await db.update(schema.meta).set({ value: String(count + 1) }).where(eq(schema.meta.key, key));
    } else {
      await db.insert(schema.meta).values({ key, value: "1" });
    }
    return false;
  } catch (err) {
    console.error("Rate-limit check failed (failing open):", err);
    return false;
  }
}

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const path = c.req.path;
  const method = c.req.method;
  const db = getDb(c.env);
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";

  // Rate-limit the two sensitive POST endpoints.
  if (method === "POST" && (path.endsWith("/sign-up/email") || path.endsWith("/sign-in/email"))) {
    const action = path.endsWith("/sign-up/email") ? "signup" : "signin";
    if (await checkAuthRateLimit(db, action, ip)) {
      return c.json({ error: "Too many attempts -- please wait a few minutes and try again." }, 429);
    }
  }

  // First-run bootstrap gate on public sign-up.
  if (method === "POST" && path.endsWith("/sign-up/email")) {
    const userCount = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.user).get();
    if ((userCount?.count || 0) > 0) {
      // System already bootstrapped -- no open self-registration. Admins
      // create users via POST /api/users.
      return c.json({ error: "Public sign-up is disabled. Ask an administrator to create your account." }, 403);
    }
    // Empty user table: allow this one signup, then promote to admin. We must
    // read the email out of the (JSON) body to find the just-created row --
    // clone the request so better-auth still gets an unconsumed body.
    let email: string | undefined;
    try {
      const cloned = c.req.raw.clone();
      const body = (await cloned.json()) as { email?: string };
      email = body?.email;
    } catch {
      // If we can't parse the body, let better-auth handle/reject it normally.
    }
    const res = await createAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw);
    // Only promote if the signup actually succeeded and we know the email.
    if (res.ok && email) {
      await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.email, email.toLowerCase()));
    }
    return res;
  }

  return createAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw);
});

// All other /api/* routes require a session. Resolves the better-auth
// session from the request cookie and attaches a normalized user onto
// Hono's context for downstream handlers/authorization checks.
app.use("/api/*", async (c, next) => {
  // Public, token-gated (or provider-signed) surfaces that must NOT require a
  // session, alongside /api/auth/*:
  //   - /api/public/*        : customer estimate view/accept/decline/pdf,
  //                            gated by the unguessable public_token, not a
  //                            session (see the routes below).
  //   - /api/stripe/webhook  : Stripe calls this server-to-server with no
  //                            cookie; it's authenticated by the webhook
  //                            signature (STRIPE_WEBHOOK_SECRET), not a session.
  if (
    c.req.path.startsWith("/api/auth/") ||
    c.req.path.startsWith("/api/public/") ||
    c.req.path === "/api/stripe/webhook"
  ) {
    return next();
  }
  const session = await createAuth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // Default to "pending" (no access) rather than "office" if role is somehow
  // missing -- a missing role must never fall through to a privileged one.
  const role = (session.user as { role?: string }).role || "pending";
  c.set("user", {
    id: session.user.id,
    role,
    name: session.user.name,
    email: session.user.email,
  });
  // A "pending" user has been created but not yet granted a working role by an
  // admin. They can hold a valid session (so the client can show a "your
  // account is awaiting activation" state) but must be denied every data
  // route. This is the safest possible default for an un-provisioned account.
  if (role === "pending") {
    return c.json({ error: "Your account is pending activation by an administrator." }, 403);
  }
  await next();
});

// Blanket role gate for technicians on whole resource families that are
// off-limits to them regardless of ownership (customers, technicians,
// invoices) and on mutating materials/service-types routes (read-only is
// fine for the dashboard, so GET is allowed through). Per-job ownership
// checks (jobs, notes, checklist, job-materials) are handled per-route below
// via requireOwnJobOrForbid since they depend on which job is involved.
app.use("/api/*", async (c, next) => {
  // Public/webhook surfaces never had `user` set (the auth middleware above
  // skips them), so this role-gate must skip them too -- otherwise reading
  // user.role on an unauthenticated public request would throw a 500.
  if (
    c.req.path.startsWith("/api/public/") ||
    c.req.path.startsWith("/api/auth/") ||
    c.req.path === "/api/stripe/webhook"
  ) {
    return next();
  }
  const user = c.get("user");
  if (user.role !== "technician") {
    return next();
  }
  const path = c.req.path;
  const method = c.req.method;
  const isMutating = method === "POST" || method === "PUT" || method === "DELETE";

  if (path.startsWith("/api/customers")) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (path.startsWith("/api/technicians")) {
    return c.json({ error: "forbidden" }, 403);
  }
  // /^\/api\/jobs\/[^/]+\/invoice$/ covers the original singular
  // invoice-from-job route; /invoices (plural, progress billing) and
  // /change-orders are the same class of money-adjacent job sub-resource, so
  // they get the same blanket block here rather than a per-route check.
  if (
    path.startsWith("/api/invoices") || path.startsWith("/api/invoice-lines") ||
    /^\/api\/jobs\/[^/]+\/invoice$/.test(path) ||
    /^\/api\/jobs\/[^/]+\/invoices$/.test(path) ||
    /^\/api\/jobs\/[^/]+\/change-orders$/.test(path) ||
    path.startsWith("/api/change-orders")
  ) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Estimates are a sales/estimating task (admin, office, estimator) --
  // technicians get no access at all, matching the invoices block above.
  // estimate-rooms/estimate-surfaces (the structured builder) are the same
  // sales/estimating surface, so they're blocked the same way.
  if (
    path.startsWith("/api/estimates") || path.startsWith("/api/estimate-lines") ||
    path.startsWith("/api/estimate-rooms") || path.startsWith("/api/estimate-surfaces")
  ) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Service agreements (recurring-job templates) are an office/admin/
  // estimator scheduling task, not field work -- same full block as
  // estimates/invoices above rather than a per-route check, since there's
  // no per-job ownership angle here (these aren't jobs, just templates that
  // generate them).
  if (path.startsWith("/api/service-agreements")) {
    return c.json({ error: "forbidden" }, 403);
  }
  // products (TKC catalog) mirrors materials exactly: read open to
  // technicians, mutations admin/office only.
  if (isMutating && (path.startsWith("/api/materials") || path.startsWith("/api/service-types") || path.startsWith("/api/products"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Job creation assigns customer_id/technician_id arbitrarily -- the same
  // class of "reassign away from myself" risk as the technician_id strip in
  // updateJob below, just with no existing job to check ownership against.
  // Technicians work jobs already assigned to them; dispatch/office creates.
  if (method === "POST" && path === "/api/jobs") {
    return c.json({ error: "forbidden" }, 403);
  }
  return next();
});

// ── Authorization helpers ─────────────────────────────────────────
// Resolve the requesting user's own technician row (if any). Technicians
// are linked to a better-auth user via technicians.userId.
async function getOwnTechnicianId(db: ReturnType<typeof getDb>, userId: string): Promise<number | null> {
  const tech = await db.select({ id: schema.technicians.id }).from(schema.technicians).where(eq(schema.technicians.userId, userId)).get();
  return tech?.id ?? null;
}

// SECURITY-CRITICAL (crews pass): "is this technician allowed to see/act on
// this job" now has TWO ways to be true -- they're jobs.technician_id (the
// "lead", unchanged/backward compatible) OR they're a row in job_crew for
// this job (added crew member). This helper is the single predicate every
// ownership check below is built on (requireOwnJobOrForbid, the job list/
// schedule filters, getJob) -- extending it here, rather than duplicating the
// "OR crew" logic at each call site, is what keeps every one of those call
// sites consistent. Returns true iff ownTechId is non-null AND is either the
// job's lead technician or listed in job_crew for that job.
async function isJobOwnerOrCrew(db: ReturnType<typeof getDb>, jobId: number, ownTechId: number | null): Promise<boolean> {
  if (ownTechId === null) return false;
  const job = await db.select({ technicianId: schema.jobs.technicianId }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) return false;
  if (job.technicianId === ownTechId) return true;
  const crewRow = await db
    .select({ id: schema.jobCrew.id })
    .from(schema.jobCrew)
    .where(and(eq(schema.jobCrew.jobId, jobId), eq(schema.jobCrew.technicianId, ownTechId)))
    .get();
  return !!crewRow;
}

// For technician-restricted mutating routes: confirms the job identified by
// jobId belongs to the requester's own technician (lead OR crew -- see
// isJobOwnerOrCrew). Returns a Response to short-circuit with (403 forbidden)
// if not, or null if the caller may proceed.
async function requireOwnJobOrForbid(c: Context<AppBindings>, db: ReturnType<typeof getDb>, jobId: number) {
  const user = c.get("user");
  const ownTechId = await getOwnTechnicianId(db, user.id);
  if (!(await isJobOwnerOrCrew(db, jobId, ownTechId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

// Brand identity/colors/logo management (create/update/logo upload) is an
// office/admin task -- not sales (estimator) or field work (technician), so
// both of those roles are blocked here in addition to the blanket
// technician gate above. Returns a Response to short-circuit with (403
// forbidden), or null if the caller may proceed.
function requireAdminOrOfficeOrForbid(c: Context<AppBindings>) {
  const role = c.get("user").role;
  if (role !== "admin" && role !== "office") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

// Job-crew add/remove (and other admin/office/estimator, not-technician
// surfaces) -- mirrors the existing gate on reassigning jobs.technician_id in
// updateJob, which is simply "not technician" (the blanket technician
// role-gate middleware already blocks every other role from reaching /api/*
// at all, so this is equivalent to admin|office|estimator). Returns a
// Response to short-circuit with (403 forbidden), or null if the caller may
// proceed.
function requireAdminOrOfficeOrEstimatorOrForbid(c: Context<AppBindings>) {
  if (c.get("user").role === "technician") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

// User management (create/list/change-role/deactivate) is the most sensitive
// surface in the app -- it can hand out any role, including admin -- so it's
// gated to admin ONLY (not office). Returns a Response to short-circuit with
// (403 forbidden), or null if the caller may proceed.
function requireAdminOrForbid(c: Context<AppBindings>) {
  if (c.get("user").role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

// ── Payment tiers ──────────────────────────────────────────────────
// The build plan specifies an "8% / 4% / surcharge structure (cash/check vs
// card surcharge vs financing)" but doesn't pin exact numbers beyond that.
// Judgment call, kept here as a single tunable constant so the business can
// adjust without hunting through the route handler:
//   - cash / check: 8% DISCOUNT off the invoice total. Common contractor
//     practice -- cash/check avoids card-processing fees, so some of that
//     saving is passed back to the customer as an incentive to pay that way.
//   - card: 4% SURCHARGE, covering processor fees (Stripe et al. typically
//     run ~2.9%+30c; 4% leaves the business whole with a little margin).
//   - financing: 6% SURCHARGE. ASSUMPTION (not in the build plan): financing
//     companies (e.g. the Acorn Finance CTA already linked from invoices/
//     estimates) typically charge merchants a higher fee than card
//     processors, so this is set between card's 4% and something clearly
//     "more" -- picked 6% as a round number. Revisit once a real financing
//     partner agreement sets an actual rate.
//
// Sign convention: PAYMENT_TIERS values are signed percentages applied to
// invoice total. Negative = discount (reduces amount owed), positive =
// surcharge (increases amount owed). computePaymentAmount below returns
// surchargeAmount using this same signed convention, so a negative
// surcharge_amount in the payments table always means "this payment method
// discounted the total," never "surcharge of a negative amount."
const PAYMENT_TIERS: Record<"cash" | "check" | "card" | "financing", number> = {
  cash: -0.08,
  check: -0.08,
  card: 0.04,
  financing: 0.06,
};

// Pure function: given an invoice's current total (IN CENTS) and a payment
// method, returns the amount actually owed under that method's tier plus the
// signed surcharge/discount amount that produced it (surchargeAmountCents =
// amountCents - invoiceTotalCents), both IN CENTS. Operates entirely in
// integer-cents space (round at the multiplication step) so the result is
// exact -- no float drift the way `invoiceTotal * 0.04` in dollars could
// produce. Kept free of any DB/request access so it's trivially
// unit-reasonable and reusable (e.g. a future test file could import it
// directly). Callers convert dollars -> cents before calling this and cents ->
// dollars after, same boundary-conversion rule as everywhere else.
function computePaymentAmount(invoiceTotalCents: number, method: "cash" | "check" | "card" | "financing"): { amountCents: number; surchargeAmountCents: number } {
  const rate = PAYMENT_TIERS[method];
  const surchargeAmountCents = Math.round(invoiceTotalCents * rate);
  const amountCents = invoiceTotalCents + surchargeAmountCents;
  return { amountCents, surchargeAmountCents };
}

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");
const OkInvoiceIdSchema = z.object({ ok: z.boolean(), invoice_id: z.number().int() }).openapi("OkInvoiceId");

const CustomerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string(),
  status: z.string(),
  source: z.string().nullable(),
  // NEW (multi-account pass): which account/brand owns this customer.
  brand_id: z.number().int().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  brand_color_primary: z.string().nullable().optional(),
  job_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Customer");

const TechnicianSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  color: z.string(),
  active: z.number().int(),
  job_count: z.number().int().optional(),
  // NEW (1099 pass): purely informational/reporting flag -- no access-control
  // implications. Defaults to 0 (W-2/employee) when not provided.
  is_subcontractor: z.number().int(),
  created_at: z.string(),
}).openapi("Technician");

const ServiceTypeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  default_duration: z.number().int(),
  default_price: z.number(),
  color: z.string(),
  brand_id: z.number().int().nullable().optional(),
  created_at: z.string(),
}).openapi("ServiceType");

const BrandSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  color_primary: z.string().nullable(),
  color_secondary: z.string().nullable(),
  logo_r2_key: z.string().nullable(),
  active: z.number().int(),
  // NEW (review-request pass): nullable review-site URL. See
  // /api/jobs/{id}/request-review.
  review_url: z.string().nullable().optional(),
  // NEW (multi-account pass): 1 marks the resettable demo workspace. Not
  // settable through create/update -- only POST /api/demo/reset mints it.
  is_demo: z.number().int().optional(),
}).openapi("Brand");

const EstimateSchema = z.object({
  id: z.number().int(),
  identifier: z.string().nullable(),
  customer_id: z.number().int(),
  brand_id: z.number().int().nullable().optional(),
  status: z.string(),
  subtotal: z.number().nullable(),
  tax_rate: z.number().nullable(),
  tax_amount: z.number().nullable(),
  total: z.number().nullable(),
  valid_until: z.string().nullable(),
  notes: z.string().nullable(),
  approved_at: z.string().nullable(),
  public_token: z.string().nullable().optional(),
  signed_name: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  brand_color_primary: z.string().nullable().optional(),
  brand_color_secondary: z.string().nullable().optional(),
  // NEW: optional deposit amount (<= estimate total), set while the estimate
  // is draft/sent/approved. See /api/estimates/{id}/deposit.
  deposit_amount: z.number().nullable().optional(),
  created_at: z.string(),
}).openapi("Estimate");

const EstimateLineSchema = z.object({
  id: z.number().int(),
  estimate_id: z.number().int(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  total: z.number().nullable(),
}).openapi("EstimateLine");

// getEstimate's response nests lines onto the base Estimate shape.
const EstimateDetailSchema = EstimateSchema.extend({
  lines: z.array(EstimateLineSchema),
}).openapi("EstimateDetail");

// NEW (structured estimate builder): rooms -> surfaces.
const EstimateSurfaceSchema = z.object({
  id: z.number().int(),
  room_id: z.number().int(),
  surface_type: z.string(),
  measurement: z.number(),
  prep_notes: z.string().nullable(),
  coats: z.number().int(),
  paint_product: z.string().nullable(),
  labor_cost: z.number(),
  material_cost: z.number(),
  sort_order: z.number().int(),
  generated_line_id: z.number().int().nullable(),
}).openapi("EstimateSurface");

const EstimateRoomSchema = z.object({
  id: z.number().int(),
  estimate_id: z.number().int(),
  name: z.string(),
  sort_order: z.number().int(),
  surfaces: z.array(EstimateSurfaceSchema).optional(),
}).openapi("EstimateRoom");

// NEW (change orders): job-scoped, technician-blocked money adjustment.
const ChangeOrderSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  description: z.string(),
  amount: z.number(),
  status: z.string(),
  created_at: z.string(),
}).openapi("ChangeOrder");

const JobNoteSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  content: z.string(),
  created_at: z.string(),
}).openapi("JobNote");

// NEW (crews pass): a job_crew row, with the technician's name/color/
// is_subcontractor denormalized in for display (avatars/badges on job-detail)
// without a second round-trip.
const JobCrewMemberSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  technician_id: z.number().int(),
  role: z.string().nullable(),
  technician_name: z.string().nullable().optional(),
  technician_color: z.string().nullable().optional(),
  is_subcontractor: z.number().int().nullable().optional(),
}).openapi("JobCrewMember");

const AttachmentSchema = z.object({
  id: z.number().int(),
  entity_type: z.string(),
  entity_id: z.number().int(),
  kind: z.string(),
  r2_key: z.string(),
  filename: z.string().nullable(),
  content_type: z.string().nullable(),
  uploaded_by: z.string().nullable(),
  created_at: z.string(),
}).openapi("Attachment");

const PaymentSchema = z.object({
  id: z.number().int(),
  invoice_id: z.number().int(),
  method: z.string(),
  amount: z.number(),
  surcharge_amount: z.number().nullable(),
  processor_ref: z.string().nullable(),
  status: z.string(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
}).openapi("Payment");

// Matches the "joined with denormalized fields" shape shared by
// listInvoices/getInvoice/getInvoiceJoinedById/listJobInvoices/getCustomer's
// nested invoices -- customer_name/job_identifier are only present on some
// of those (left out entirely rather than joined), hence .optional() on both.
const InvoiceSchema = z.object({
  id: z.number().int(),
  identifier: z.string(),
  customer_id: z.number().int(),
  job_id: z.number().int().nullable(),
  status: z.string(),
  subtotal: z.number().nullable(),
  tax_rate: z.number().nullable(),
  tax_amount: z.number().nullable(),
  total: z.number().nullable(),
  notes: z.string().nullable(),
  due_date: z.string().nullable(),
  paid_date: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  brand_id: z.number().int().nullable(),
  customer_name: z.string().nullable().optional(),
  job_identifier: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  brand_color_primary: z.string().nullable().optional(),
  brand_color_secondary: z.string().nullable().optional(),
}).openapi("Invoice");

const InvoiceLineSchema = z.object({
  id: z.number().int(),
  invoice_id: z.number().int(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  total: z.number().nullable(),
}).openapi("InvoiceLine");

// getInvoice's response nests lines + payments onto the base Invoice shape.
const InvoiceDetailSchema = InvoiceSchema.extend({
  lines: z.array(InvoiceLineSchema),
  payments: z.array(PaymentSchema),
}).openapi("InvoiceDetail");

const JobSchema = z.object({
  id: z.number().int(),
  identifier: z.string(),
  customer_id: z.number().int(),
  technician_id: z.number().int().nullable(),
  service_type_id: z.number().int().nullable(),
  status: z.string(),
  priority: z.string(),
  scheduled_date: z.string(),
  scheduled_time: z.string(),
  duration: z.number().int(),
  price: z.number(),
  address: z.string(),
  notes: z.string(),
  completion_notes: z.string(),
  is_recurring: z.number().int(),
  recurrence_interval: z.string(),
  next_recurrence_date: z.string(),
  brand_id: z.number().int().nullable().optional(),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  technician_name: z.string().nullable().optional(),
  technician_color: z.string().nullable().optional(),
  service_type_name: z.string().nullable().optional(),
  service_type_color: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  brand_color_primary: z.string().nullable().optional(),
  brand_color_secondary: z.string().nullable().optional(),
  job_notes: z.array(JobNoteSchema).optional(),
  crew: z.array(JobCrewMemberSchema).optional(),
  // NEW (multi-day jobs): nullable end_date -- null/equal to scheduled_date
  // means a normal single-day job.
  end_date: z.string().nullable().optional(),
  // NEW (warranty pass): nullable warranty term + derived expiry date.
  warranty_months: z.number().int().nullable().optional(),
  warranty_expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Job");

const ServiceAgreementSchema = z.object({
  id: z.number().int(),
  customer_id: z.number().int(),
  brand_id: z.number().int().nullable(),
  service_type_id: z.number().int().nullable(),
  interval: z.enum(["weekly", "monthly", "quarterly", "annual"]),
  next_run_date: z.string().nullable(),
  active: z.number().int(),
  customer_name: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  service_type_name: z.string().nullable().optional(),
}).openapi("ServiceAgreement");

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID" }) });

// ── Helpers ────────────────────────────────────────────────────────

// The original raw-SQL version bound :id as a TEXT param against an INTEGER
// PRIMARY KEY column. SQLite's type-affinity comparison only coerces TEXT to
// NUMERIC when the conversion is lossless (e.g. "5" -> 5), so a malformed id
// like "5abc" never matched any row and every route fell through to its
// not-found / zero-rows-affected path. `parseInt("5abc", 10)` would silently
// truncate to 5 and match a real row instead -- this preserves the original
// "malformed id matches nothing" behavior. -1 is a safe sentinel since every
// id column here is an autoincrement PK starting at 1.
const toId = (id: string): number => (/^\d+$/.test(id) ? Number(id) : -1);

// Escapes SQL LIKE's special characters (%, _) plus the escape character
// itself (\) in user-supplied search text, so a literal "%" or "_" typed by
// a user (e.g. searching for "50% off", or a customer name/address
// containing an underscore) matches literally instead of being interpreted
// as a wildcard. Every search/filter route below wraps its escaped search
// term in %...% itself (to get "contains" matching) and passes the result to
// likeEscaped(), which appends `ESCAPE '\'` so SQLite/D1 honors the
// backslash-escaping instead of treating '\' as a literal character. Drizzle's
// like() has no built-in ESCAPE-clause support, so this is expressed as a raw
// sql fragment rather than composed through like(). Verified against local
// D1 with a search term containing both a literal "%" and "_".
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function likeEscaped(column: Column | SQL, needle: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\'`;
}

// Atomically increments a `_meta` counter row and returns its new value, in a
// single SQL statement (UPDATE ... SET value = value + 1 ... RETURNING value).
// This closes the race condition the old SELECT-then-UPDATE pattern had: two
// concurrent requests reading the same counter value and both writing the
// same "next" value, producing duplicate identifiers (e.g. two invoices both
// named INV-42). D1/SQLite executes the read-modify-write of a single UPDATE
// statement atomically -- there's no gap between reading the current value
// and writing the incremented one for another concurrent request to land in.
// Raw `sql` (via db.get) is used rather than Drizzle's query-builder
// `.update().returning()` -- the counter is stored as TEXT in `_meta.value`,
// so the increment itself has to happen as `CAST(value AS INTEGER) + 1`
// inside SQL either way, and expressing the whole statement (including
// RETURNING) as one raw template is the most direct, unambiguous way to get
// that atomic guarantee against D1 -- confirmed working via `wrangler d1
// execute` and under real concurrent load (see counter test script).
async function incrementCounter(db: ReturnType<typeof getDb>, key: string): Promise<number> {
  const row = await db.get<{ value: number }>(
    sql`UPDATE _meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ${key} RETURNING CAST(value AS INTEGER) as value`
  );
  return row!.value;
}

async function nextIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "identifier_prefix")).get();
  const next = await incrementCounter(db, "job_counter");
  return `${prefixRow?.value || "JOB"}-${next}`;
}

async function nextInvoiceIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "invoice_prefix")).get();
  const next = await incrementCounter(db, "invoice_counter");
  return `${prefixRow?.value || "INV"}-${next}`;
}

async function nextEstimateIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "estimate_prefix")).get();
  const next = await incrementCounter(db, "estimate_counter");
  return `${prefixRow?.value || "EST"}-${next}`;
}

// Shared "job with joined denormalized fields" select shape, matching the
// original SQL `j.*, c.name as customer_name, c.phone as customer_phone,
// t.name as technician_name, t.color as technician_color,
// st.name as service_type_name, st.color as service_type_color`.
function jobJoinedSelect(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: schema.jobs.id,
      identifier: schema.jobs.identifier,
      customer_id: schema.jobs.customerId,
      technician_id: schema.jobs.technicianId,
      service_type_id: schema.jobs.serviceTypeId,
      status: schema.jobs.status,
      priority: schema.jobs.priority,
      scheduled_date: schema.jobs.scheduledDate,
      scheduled_time: sql<string>`COALESCE(${schema.jobs.scheduledTime}, '')`,
      duration: schema.jobs.duration,
      // Raw cents here -- jobJoinedSelectOut() below converts to dollars at
      // the boundary. Every call site of jobJoinedSelect() MUST pipe its
      // result through jobJoinedSelectOut()/jobJoinedSelectOutOne() before it
      // reaches c.json().
      price: schema.jobs.price,
      address: sql<string>`COALESCE(${schema.jobs.address}, '')`,
      notes: sql<string>`COALESCE(${schema.jobs.notes}, '')`,
      completion_notes: sql<string>`COALESCE(${schema.jobs.completionNotes}, '')`,
      is_recurring: schema.jobs.isRecurring,
      recurrence_interval: sql<string>`COALESCE(${schema.jobs.recurrenceInterval}, '')`,
      next_recurrence_date: sql<string>`COALESCE(${schema.jobs.nextRecurrenceDate}, '')`,
      brand_id: schema.jobs.brandId,
      end_date: schema.jobs.endDate,
      warranty_months: schema.jobs.warrantyMonths,
      warranty_expires_at: schema.jobs.warrantyExpiresAt,
      created_at: sql<string>`COALESCE(${schema.jobs.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.jobs.updatedAt}, '')`,
      customer_name: sql<string | undefined>`${schema.customers.name}`,
      customer_phone: sql<string | undefined>`${schema.customers.phone}`,
      technician_name: schema.technicians.name,
      technician_color: schema.technicians.color,
      service_type_name: schema.serviceTypes.name,
      service_type_color: schema.serviceTypes.color,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.jobs)
    .leftJoin(schema.customers, eq(schema.jobs.customerId, schema.customers.id))
    .leftJoin(schema.technicians, eq(schema.jobs.technicianId, schema.technicians.id))
    .leftJoin(schema.serviceTypes, eq(schema.jobs.serviceTypeId, schema.serviceTypes.id))
    .leftJoin(schema.brands, eq(schema.jobs.brandId, schema.brands.id));
}
// Boundary conversion for a single jobJoinedSelect() row: price cents -> dollars.
function jobJoinedSelectOutOne<T extends { price: number }>(row: T): T {
  return { ...row, price: fromCents(row.price) };
}
// Same, for an array of rows (list routes).
function jobJoinedSelectOut<T extends { price: number }>(rows: T[]): T[] {
  return rows.map(jobJoinedSelectOutOne);
}

// Enqueues a reminder message for a job onto the REMINDERS queue. Called
// from createJob (every new job) and updateJob (whenever scheduled_date or
// technician_id changes -- a reschedule/reassignment is exactly the kind of
// change a reminder should reflect). Deliberately simple: no "24 hours
// before" delayed-delivery scheduling here (Queues' delivery_delay is a
// fixed producer-level setting, not a flexible per-message schedule, so
// building real "N hours before scheduled_date" logic is out of scope for
// this pass -- see the queue() consumer below for how this is recorded).
// Failures here are swallowed (logged, not thrown) so a queue hiccup never
// blocks the actual job create/update from succeeding.
async function enqueueJobReminder(env: AppBindings["Bindings"], jobId: number, scheduledDate: string) {
  try {
    await env.REMINDERS.send({ type: "job_reminder", job_id: jobId, scheduled_date: scheduledDate });
  } catch (err) {
    console.error(`Failed to enqueue reminder for job ${jobId}:`, err);
  }
}

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
  request: {
    // Optional account scoping -- see zBrandIdQuery. When present, every
    // brand-ownable number (jobs, customers, revenue, invoices) is computed
    // for that account only. technicians stays global (crew is shared company
    // data, not account-owned).
    query: z.object({ brand_id: zBrandIdQuery }),
  },
  responses: {
    200: {
      description: "Dashboard stats",
      content: { "application/json": { schema: z.object({
        jobs: z.number().int(),
        customers: z.number().int(),
        technicians: z.number().int(),
        service_types: z.number().int(),
        today_jobs: z.number().int(),
        upcoming_jobs: z.number().int(),
        completed_jobs: z.number().int(),
        revenue: z.number(),
        invoices_outstanding: z.number(),
        invoices_overdue: z.number(),
      }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getStats, async (c) => {
  const db = getDb(c.env);
  const brandRes = await resolveBrandFilter(db, c.req.valid("query").brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  // Per-table brand conditions (undefined = unscoped). Composable via and()
  // with each stat's own conditions below.
  const jobBrand = brandFilter === null ? undefined : eq(schema.jobs.brandId, brandFilter);
  const customerBrand = brandFilter === null ? undefined : eq(schema.customers.brandId, brandFilter);
  const invoiceBrand = brandFilter === null ? undefined : eq(schema.invoices.brandId, brandFilter);
  const serviceTypeBrand = brandFilter === null ? undefined : eq(schema.serviceTypes.brandId, brandFilter);

  const jobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(jobBrand).get();
  const customers = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.customers).where(customerBrand).get();
  const technicians = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.technicians).where(eq(schema.technicians.active, 1)).get();
  const serviceTypes = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.serviceTypes).where(serviceTypeBrand).get();
  // "Today" in Tampa (America/New_York), NOT UTC -- a UTC today rolls over in
  // the evening Tampa time and would miscount today's/upcoming jobs.
  const today = todayInTampa();
  const todayJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(and(eq(schema.jobs.scheduledDate, today), jobBrand)).get();
  const upcomingJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs)
    .where(and(inArray(schema.jobs.status, ["scheduled", "confirmed"]), sql`${schema.jobs.scheduledDate} >= ${today}`, jobBrand))
    .get();
  const completedJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(and(eq(schema.jobs.status, "completed"), jobBrand)).get();
  // Revenue = money ACTUALLY collected: the sum of paid payments (net of
  // discounts/surcharges, i.e. the real cash received), NOT completed-job
  // prices (which are pre-invoice, tax-exclusive, and ignore whether anyone
  // actually paid). Brand scoping goes through the payment's invoice (payments
  // have no brand column of their own).
  const revenue = await db.select({ total: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)` })
    .from(schema.payments)
    .leftJoin(schema.invoices, eq(schema.payments.invoiceId, schema.invoices.id))
    .where(and(eq(schema.payments.status, "paid"), invoiceBrand))
    .get();
  // Overdue = already flipped to "overdue" OR still "sent" but past its due
  // date. Computed as a pure COUNT here (no write) so a dashboard load stays
  // idempotent -- the actual status flip happens in the scheduled() cron via
  // updateOverdueInvoices(). Outstanding excludes those now-overdue sent ones.
  const invoicesOutstanding = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.invoices)
    .where(and(eq(schema.invoices.status, "sent"), sql`NOT (${schema.invoices.dueDate} != '' AND ${schema.invoices.dueDate} < ${today})`, invoiceBrand))
    .get();
  const invoicesOverdue = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.invoices)
    .where(and(sql`(${schema.invoices.status} = 'overdue' OR (${schema.invoices.status} = 'sent' AND ${schema.invoices.dueDate} != '' AND ${schema.invoices.dueDate} < ${today}))`, invoiceBrand))
    .get();
  return c.json({
    jobs: jobs?.count || 0,
    customers: customers?.count || 0,
    technicians: technicians?.count || 0,
    service_types: serviceTypes?.count || 0,
    today_jobs: todayJobs?.count || 0,
    upcoming_jobs: upcomingJobs?.count || 0,
    completed_jobs: completedJobs?.count || 0,
    revenue: fromCents(revenue?.total || 0),
    invoices_outstanding: invoicesOutstanding?.count || 0,
    invoices_overdue: invoicesOverdue?.count || 0,
  }, 200);
});

// ── Users (admin-only user management) ─────────────────────────────
// Admin creates/lists/updates the auth users behind the app. All routes here
// are admin-only (requireAdminOrForbid) -- NOT office. Users are created via
// better-auth's server-side API (auth.api.signUpEmail) so the credential/
// account rows and password hashing all go through the same code path as a
// normal signup, then the chosen role is set directly on the user row (the
// signup itself always lands at the "pending" default -- role has input:false).
// Deactivation is a soft revoke: role is set back to "pending", which the
// /api/* middleware 403s on -- avoids needing a schema column for "active".

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  created_at: z.string().nullable(),
}).openapi("User");

const listUsers = createRoute({
  method: "get",
  path: "/api/users",
  responses: {
    200: { description: "All users", content: { "application/json": { schema: z.object({ users: z.array(UserSchema) }) } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listUsers, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.user.role, createdAt: schema.user.createdAt })
    .from(schema.user)
    .orderBy(asc(schema.user.email))
    .all();
  const users = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role ?? "pending",
    // createdAt is a timestamp_ms integer in the auth schema -- surface it as
    // an ISO string for the client.
    created_at: u.createdAt ? new Date(u.createdAt as unknown as number).toISOString() : null,
  }));
  return c.json({ users }, 200);
});

const createUser = createRoute({
  method: "post",
  path: "/api/users",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: zName,
      email: z.string().trim().email({ message: "Invalid email address" }),
      password: z.string().min(8, { message: "Password must be at least 8 characters" }),
      role: z.enum(ASSIGNABLE_ROLES),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: UserSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Email already in use", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createUser, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const data = c.req.valid("json");
  const email = data.email.toLowerCase();

  // Reject a duplicate email up front with a clean 409 rather than letting
  // better-auth throw its own error shape.
  const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).get();
  if (existing) {
    return c.json({ error: "A user with that email already exists." }, 409);
  }

  // Create the auth user through better-auth's server API so password hashing
  // + the credential/account rows are handled identically to a real signup.
  // The signup lands at the "pending" default (role has input:false); we set
  // the chosen role immediately after.
  try {
    await createAuth(c.env, new URL(c.req.url).origin).api.signUpEmail({ body: { name: data.name, email, password: data.password } });
  } catch (err) {
    console.error("Admin createUser signUpEmail failed:", err);
    return c.json({ error: "Could not create user (email may already be in use)." }, 400);
  }
  await db.update(schema.user).set({ role: data.role }).where(eq(schema.user.email, email));

  const row = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.user.role, createdAt: schema.user.createdAt })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .get();
  return c.json({
    id: row!.id,
    name: row!.name,
    email: row!.email,
    role: row!.role ?? data.role,
    created_at: row!.createdAt ? new Date(row!.createdAt as unknown as number).toISOString() : null,
  }, 201);
});

const updateUserRole = createRoute({
  method: "put",
  path: "/api/users/{id}/role",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ role: z.enum(ASSIGNABLE_ROLES) }) } } },
  },
  responses: {
    200: { description: "Role updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateUserRole, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const { role } = c.req.valid("json");
  const existing = await db.select({ id: schema.user.id, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, id)).get();
  if (!existing) return c.json({ error: "User not found" }, 404);

  // Guard against an admin demoting the last remaining admin and locking
  // everyone out of user management.
  if (existing.role === "admin" && role !== "admin") {
    const adminCount = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.user).where(eq(schema.user.role, "admin")).get();
    if ((adminCount?.count || 0) <= 1) {
      return c.json({ error: "Cannot remove the last admin -- promote another user to admin first." }, 400);
    }
  }
  await db.update(schema.user).set({ role }).where(eq(schema.user.id, id));
  return c.json({ ok: true }, 200);
});

const deactivateUser = createRoute({
  method: "delete",
  path: "/api/users/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deactivated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deactivateUser, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const existing = await db.select({ id: schema.user.id, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, id)).get();
  if (!existing) return c.json({ error: "User not found" }, 404);

  // Deactivate = park the user back at "pending" (denied everything by the
  // /api/* middleware) AND kill their active sessions so they're logged out
  // immediately rather than at next session refresh. Soft revoke -- avoids a
  // schema column and keeps the row for audit/re-activation.
  if (existing.role === "admin") {
    const adminCount = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.user).where(eq(schema.user.role, "admin")).get();
    if ((adminCount?.count || 0) <= 1) {
      return c.json({ error: "Cannot deactivate the last admin." }, 400);
    }
  }
  await db.update(schema.user).set({ role: "pending" }).where(eq(schema.user.id, id));
  await db.delete(schema.session).where(eq(schema.session.userId, id));
  return c.json({ ok: true }, 200);
});

// ── Jobs ───────────────────────────────────────────────────────────

const listJobs = createRoute({
  method: "get",
  path: "/api/jobs",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      date: z.string().optional(),
      technician_id: z.string().optional(),
      brand_id: zBrandIdQuery,
    }),
  },
  responses: {
    200: {
      description: "Paginated job list",
      content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema), total: z.number().int() }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listJobs, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const user = c.get("user");
  const conditions = [];
  // Account scoping COMPOSES with (never replaces) the technician ownership
  // force-filter pushed below -- both land in the same AND'd conditions array.
  const brandRes = await resolveBrandFilter(db, q.brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  if (brandFilter !== null) {
    conditions.push(eq(schema.jobs.brandId, brandFilter));
  }
  if (q.search) {
    conditions.push(or(
      likeEscaped(schema.jobs.identifier, q.search),
      likeEscaped(schema.customers.name, q.search),
      likeEscaped(schema.jobs.address, q.search),
    ));
  }
  if (q.status) {
    conditions.push(eq(schema.jobs.status, q.status));
  }
  if (user.role === "technician") {
    // Force-filter to jobs the requester's own technician owns, overriding
    // any technician_id query param -- a technician may only ever see their
    // own jobs. "Own" now means lead (jobs.technician_id) OR crew member
    // (job_crew), same broadened predicate as isJobOwnerOrCrew/
    // requireOwnJobOrForbid -- an id-only IN-subquery is used here (rather
    // than isJobOwnerOrCrew's per-job lookup) since this filters a list, not
    // a single job.
    const ownTechId = await getOwnTechnicianId(db, user.id);
    if (ownTechId === null) {
      return c.json({ jobs: [], total: 0 }, 200);
    }
    const crewJobIds = db.select({ jobId: schema.jobCrew.jobId }).from(schema.jobCrew).where(eq(schema.jobCrew.technicianId, ownTechId));
    conditions.push(or(eq(schema.jobs.technicianId, ownTechId), inArray(schema.jobs.id, crewJobIds)));
  } else if (q.technician_id) {
    conditions.push(eq(schema.jobs.technicianId, parseInt(q.technician_id, 10)));
  }
  if (q.date) {
    conditions.push(eq(schema.jobs.scheduledDate, q.date));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.jobs)
    .leftJoin(schema.customers, eq(schema.jobs.customerId, schema.customers.id))
    .where(where)
    .get();

  const jobs = await jobJoinedSelect(db)
    .where(where)
    .orderBy(asc(schema.jobs.scheduledDate), asc(schema.jobs.scheduledTime))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ jobs: jobJoinedSelectOut(jobs), total: countRow?.count || 0 }, 200);
});

const getJob = createRoute({
  method: "get",
  path: "/api/jobs/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Job detail", content: { "application/json": { schema: z.object({ job: JobSchema }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getJob, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await jobJoinedSelect(db).where(eq(schema.jobs.id, idNum)).get();
  if (!job) return c.json({ error: "Job not found" }, 404);
  const user = c.get("user");
  if (user.role === "technician") {
    const ownTechId = await getOwnTechnicianId(db, user.id);
    // Lead (job.technician_id) OR crew member -- see isJobOwnerOrCrew.
    if (!(await isJobOwnerOrCrew(db, idNum, ownTechId))) {
      return c.json({ error: "Job not found" }, 404);
    }
  }
  const notes = await db.select().from(schema.jobNotes).where(eq(schema.jobNotes.jobId, idNum)).orderBy(desc(schema.jobNotes.createdAt)).all();
  const checklist = await db.select().from(schema.jobChecklist).where(eq(schema.jobChecklist.jobId, idNum)).orderBy(asc(schema.jobChecklist.sortOrder)).all();
  const jobMaterials = await db
    .select({
      id: schema.jobMaterials.id,
      job_id: schema.jobMaterials.jobId,
      material_id: schema.jobMaterials.materialId,
      quantity: schema.jobMaterials.quantity,
      unit_cost: schema.jobMaterials.unitCost,
      material_name: schema.materials.name,
      material_unit: schema.materials.unit,
    })
    .from(schema.jobMaterials)
    .leftJoin(schema.materials, eq(schema.jobMaterials.materialId, schema.materials.id))
    .where(eq(schema.jobMaterials.jobId, idNum))
    .orderBy(asc(schema.jobMaterials.id))
    .all();
  const crewRows = await db
    .select({
      id: schema.jobCrew.id,
      jobId: schema.jobCrew.jobId,
      technicianId: schema.jobCrew.technicianId,
      role: schema.jobCrew.role,
      technicianName: schema.technicians.name,
      technicianColor: schema.technicians.color,
      isSubcontractor: schema.technicians.isSubcontractor,
    })
    .from(schema.jobCrew)
    .leftJoin(schema.technicians, eq(schema.jobCrew.technicianId, schema.technicians.id))
    .where(eq(schema.jobCrew.jobId, idNum))
    .orderBy(asc(schema.jobCrew.id))
    .all();
  const notesOut = notes.map((n) => ({ id: n.id, job_id: n.jobId, content: n.content, created_at: n.createdAt ?? "" }));
  const checklistOut = checklist.map((ch) => ({ id: ch.id, job_id: ch.jobId, label: ch.label, checked: ch.checked, sort_order: ch.sortOrder }));
  const jobMaterialsOut = jobMaterials.map((jm) => ({ ...jm, unit_cost: fromCents(jm.unit_cost) }));
  return c.json({ job: { ...jobJoinedSelectOutOne(job), job_notes: notesOut, checklist: checklistOut, job_materials: jobMaterialsOut, crew: crewRows.map(jobCrewOut) } }, 200);
});

const createJob = createRoute({
  method: "post",
  path: "/api/jobs",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        customer_id: z.number().int(),
        technician_id: z.number().int().nullable().optional(),
        service_type_id: z.number().int().nullable().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        priority: z.enum(JOB_PRIORITIES).optional(),
        scheduled_date: zDate,
        scheduled_time: zTime.optional(),
        duration: z.number().int().positive().optional(),
        price: zMoney.optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        is_recurring: z.number().int().optional(),
        recurrence_interval: z.enum(RECURRENCE_INTERVALS).optional(),
        brand_id: z.number().int().nullable().optional(),
        // NEW (multi-day jobs): nullable -- null/omitted means a normal
        // single-day job. Cross-field (>= scheduled_date) validated below,
        // not in the Zod schema, since it needs scheduled_date's own value.
        end_date: zDate.nullable().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: JobSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createJob, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");

  // Referential sanity: reject dangling FK ids with a clean 400 rather than a
  // raw D1 constraint 500 (customer_id) or a silent dangling reference
  // (technician_id/service_type_id/brand_id are SET NULL FKs).
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await technicianExists(db, data.technician_id))) return c.json({ error: "Technician not found" }, 400);
  if (!(await serviceTypeExists(db, data.service_type_id))) return c.json({ error: "Service type not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  if (data.end_date != null && data.end_date < data.scheduled_date) {
    return c.json({ error: "end_date cannot be before scheduled_date" }, 400);
  }

  // Multi-account default: when the caller doesn't mention brand_id at all,
  // inherit the customer's account. An EXPLICIT null ("no brand") is
  // respected unchanged -- only an omitted field defaults.
  let brandId: number | null = data.brand_id ?? null;
  if (data.brand_id === undefined) {
    const custBrand = await db.select({ brandId: schema.customers.brandId }).from(schema.customers).where(eq(schema.customers.id, data.customer_id)).get();
    brandId = custBrand?.brandId ?? null;
  }

  const identifier = await nextIdentifier(db);

  // If address is empty, use customer address
  let address = data.address || "";
  if (!address) {
    const cust = await db
      .select({ address: schema.customers.address, city: schema.customers.city, state: schema.customers.state, zip: schema.customers.zip })
      .from(schema.customers)
      .where(eq(schema.customers.id, data.customer_id))
      .get();
    if (cust) {
      address = [cust.address, cust.city, cust.state, cust.zip].filter(Boolean).join(", ");
    }
  }

  // Default price/duration from service type
  let duration = data.duration || 60;
  let price = data.price || 0;
  if (data.service_type_id && (!data.duration || !data.price)) {
    const st = await db
      .select({ default_duration: schema.serviceTypes.defaultDuration, default_price: schema.serviceTypes.defaultPrice })
      .from(schema.serviceTypes)
      .where(eq(schema.serviceTypes.id, data.service_type_id))
      .get();
    if (st) {
      if (!data.duration) duration = st.default_duration;
      if (!data.price) price = st.default_price;
    }
  }

  await db.insert(schema.jobs).values({
    identifier,
    customerId: data.customer_id,
    technicianId: data.technician_id ?? null,
    serviceTypeId: data.service_type_id ?? null,
    status: data.status || "scheduled",
    priority: data.priority || "normal",
    scheduledDate: data.scheduled_date,
    scheduledTime: data.scheduled_time || "09:00",
    duration,
    price: toCents(price),
    address,
    notes: data.notes || "",
    isRecurring: data.is_recurring || 0,
    recurrenceInterval: data.recurrence_interval || "",
    brandId,
    endDate: data.end_date ?? null,
  });

  const job = await jobJoinedSelect(db).where(eq(schema.jobs.identifier, identifier)).get();
  // Every new job gets a reminder queued -- see enqueueJobReminder's comment
  // for why this doesn't try to be "24 hours before".
  await enqueueJobReminder(c.env, job!.id, job!.scheduled_date);
  return c.json(jobJoinedSelectOutOne(job!), 201);
});

const updateJob = createRoute({
  method: "put",
  path: "/api/jobs/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        customer_id: z.number().int().optional(),
        technician_id: z.number().int().nullable().optional(),
        service_type_id: z.number().int().nullable().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        priority: z.enum(JOB_PRIORITIES).optional(),
        scheduled_date: zDate.optional(),
        scheduled_time: zTime.optional(),
        duration: z.number().int().positive().optional(),
        price: zMoney.optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        completion_notes: z.string().optional(),
        is_recurring: z.number().int().optional(),
        // Allow "" (not recurring) OR a valid interval -- the client's Job type
        // carries recurrence_interval as a plain string that can be empty.
        recurrence_interval: z.union([z.literal(""), z.enum(RECURRENCE_INTERVALS)]).optional(),
        brand_id: z.number().int().nullable().optional(),
        // NEW (multi-day jobs): nullable -- see createJob's comment.
        end_date: zDate.nullable().optional(),
        // NEW (warranty pass): optionally accepted alongside status:"completed"
        // (or any update once the job is already completed) -- when provided
        // and > 0, warranty_expires_at is computed server-side from the
        // completion date. 0/omitted leaves warranty untouched.
        warranty_months: z.number().int().positive().nullable().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateJob, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const data = c.req.valid("json");
  const existing = await db.select().from(schema.jobs).where(eq(schema.jobs.id, idNum)).get();
  if (!existing) return c.json({ error: "Job not found" }, 404);

  // Referential sanity on any FK being changed.
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await technicianExists(db, data.technician_id))) return c.json({ error: "Technician not found" }, 400);
  if (!(await serviceTypeExists(db, data.service_type_id))) return c.json({ error: "Service type not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  if (data.end_date != null) {
    const scheduledDate = data.scheduled_date ?? existing.scheduledDate;
    if (data.end_date < scheduledDate) {
      return c.json({ error: "end_date cannot be before scheduled_date" }, 400);
    }
  }

  const user = c.get("user");
  const isTechnician = user.role === "technician";
  if (isTechnician) {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }

  const updates: Record<string, unknown> = {};
  // Technicians may update their own job's working fields (status, notes,
  // schedule, etc.) but not reassign who it belongs to -- otherwise a
  // technician could PUT their own job to a different technician_id and
  // immediately lock themselves out of it (requireOwnJobOrForbid only
  // checks ownership of the pre-update state).
  if (!isTechnician) {
    if (data.customer_id !== undefined) updates.customerId = data.customer_id;
    if (data.technician_id !== undefined) updates.technicianId = data.technician_id;
  }
  if (data.service_type_id !== undefined) updates.serviceTypeId = data.service_type_id;
  if (data.status !== undefined) updates.status = data.status;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.scheduled_date !== undefined) updates.scheduledDate = data.scheduled_date;
  if (data.scheduled_time !== undefined) updates.scheduledTime = data.scheduled_time;
  if (data.duration !== undefined) updates.duration = data.duration;
  if (data.price !== undefined) updates.price = toCents(data.price);
  if (data.address !== undefined) updates.address = data.address;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.completion_notes !== undefined) updates.completionNotes = data.completion_notes;
  if (data.is_recurring !== undefined) updates.isRecurring = data.is_recurring;
  if (data.recurrence_interval !== undefined) updates.recurrenceInterval = data.recurrence_interval;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (data.end_date !== undefined) updates.endDate = data.end_date;

  // Warranty: only computed when warranty_months is provided AND > 0 (the
  // Zod schema already enforces positive-or-null/undefined, but 0 can't
  // occur -- z.number().int().positive() rejects 0). Uses the completion
  // date -- the job's status AFTER this update (either being set to
  // "completed" right now, or already completed) -- as the anchor for
  // warranty_expires_at, via addCalendarMonths for month-length-safe math.
  // A job going to "completed" without an updated_at yet still has today's
  // date as its effective completion day, so today (Tampa) is used as the
  // anchor rather than reading back updated_at.
  if (data.warranty_months != null) {
    const resultingStatus = data.status ?? existing.status;
    if (resultingStatus !== "completed") {
      return c.json({ error: "warranty_months can only be set when the job is completed" }, 400);
    }
    updates.warrantyMonths = data.warranty_months;
    updates.warrantyExpiresAt = addCalendarMonths(todayInTampa(), data.warranty_months);
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = sql`(datetime('now'))`;
    await db.update(schema.jobs).set(updates).where(eq(schema.jobs.id, idNum));
  }
  // Reschedule (scheduled_date) or reassignment (technician_id) both change
  // who/when a reminder is relevant for, so re-enqueue on either -- not on
  // every field (e.g. a notes edit shouldn't spam a new reminder).
  if (data.scheduled_date !== undefined || data.technician_id !== undefined) {
    const scheduledDate = data.scheduled_date ?? existing.scheduledDate;
    await enqueueJobReminder(c.env, idNum, scheduledDate);
  }
  return c.json({ ok: true }, 200);
});

const deleteJob = createRoute({
  method: "delete",
  path: "/api/jobs/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteJob, async (c) => {
  // Technicians can never delete jobs, regardless of ownership.
  if (c.get("user").role === "technician") {
    return c.json({ error: "forbidden" }, 403);
  }
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.jobs).where(eq(schema.jobs.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Job Crew (many-to-many job<->technician) ──────────────────────
// jobs.technician_id remains the "lead" technician, unchanged -- job_crew is
// ADDITIONAL crew beyond the lead. Adding/removing crew is admin/office/
// estimator only (mirrors the existing gate on reassigning technician_id via
// updateJob, which is also blocked for technicians) -- NOT technicians, even
// for their own job, since this changes who else can act on it (an access
// grant), not a working-field edit.
function jobCrewOut(row: { id: number; jobId: number; technicianId: number; role: string | null; technicianName?: string | null; technicianColor?: string | null; isSubcontractor?: number | null }) {
  return {
    id: row.id,
    job_id: row.jobId,
    technician_id: row.technicianId,
    role: row.role,
    technician_name: row.technicianName ?? null,
    technician_color: row.technicianColor ?? null,
    is_subcontractor: row.isSubcontractor ?? null,
  };
}

const listJobCrew = createRoute({
  method: "get",
  path: "/api/jobs/{id}/crew",
  request: { params: IdParam },
  responses: {
    200: { description: "Crew for a job", content: { "application/json": { schema: z.object({ crew: z.array(JobCrewMemberSchema) }) } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listJobCrew, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (!(await jobExists(db, idNum))) return c.json({ error: "Job not found" }, 404);
  // Technicians may read crew for jobs they own (lead or crew) -- same
  // ownership predicate as everywhere else; not a blanket technician block
  // since crew membership is exactly what job-detail needs to render for them.
  if (c.get("user").role === "technician") {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }
  const rows = await db
    .select({
      id: schema.jobCrew.id,
      jobId: schema.jobCrew.jobId,
      technicianId: schema.jobCrew.technicianId,
      role: schema.jobCrew.role,
      technicianName: schema.technicians.name,
      technicianColor: schema.technicians.color,
      isSubcontractor: schema.technicians.isSubcontractor,
    })
    .from(schema.jobCrew)
    .leftJoin(schema.technicians, eq(schema.jobCrew.technicianId, schema.technicians.id))
    .where(eq(schema.jobCrew.jobId, idNum))
    .orderBy(asc(schema.jobCrew.id))
    .all();
  return c.json({ crew: rows.map(jobCrewOut) }, 200);
});

const addJobCrew = createRoute({
  method: "post",
  path: "/api/jobs/{id}/crew",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      technician_id: z.number().int(),
      role: z.string().trim().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Added", content: { "application/json": { schema: JobCrewMemberSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Job not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Already on crew", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addJobCrew, async (c) => {
  const forbidden = requireAdminOrOfficeOrEstimatorOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (!(await jobExists(db, idNum))) return c.json({ error: "Job not found" }, 404);
  const data = c.req.valid("json");
  if (!(await technicianExists(db, data.technician_id))) return c.json({ error: "Technician not found" }, 400);
  const existing = await db
    .select({ id: schema.jobCrew.id })
    .from(schema.jobCrew)
    .where(and(eq(schema.jobCrew.jobId, idNum), eq(schema.jobCrew.technicianId, data.technician_id)))
    .get();
  if (existing) return c.json({ error: "Technician is already on this job's crew" }, 409);
  await db.insert(schema.jobCrew).values({ jobId: idNum, technicianId: data.technician_id, role: data.role || null });
  const row = await db
    .select({
      id: schema.jobCrew.id,
      jobId: schema.jobCrew.jobId,
      technicianId: schema.jobCrew.technicianId,
      role: schema.jobCrew.role,
      technicianName: schema.technicians.name,
      technicianColor: schema.technicians.color,
      isSubcontractor: schema.technicians.isSubcontractor,
    })
    .from(schema.jobCrew)
    .leftJoin(schema.technicians, eq(schema.jobCrew.technicianId, schema.technicians.id))
    .where(and(eq(schema.jobCrew.jobId, idNum), eq(schema.jobCrew.technicianId, data.technician_id)))
    .get();
  return c.json(jobCrewOut(row!), 201);
});

const deleteJobCrew = createRoute({
  method: "delete",
  path: "/api/jobs/{id}/crew/{crewId}",
  request: { params: z.object({ id: z.string(), crewId: z.string() }) },
  responses: {
    200: { description: "Removed", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteJobCrew, async (c) => {
  const forbidden = requireAdminOrOfficeOrEstimatorOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id, crewId } = c.req.valid("param");
  const idNum = toId(id);
  const crewIdNum = toId(crewId);
  const row = await db.select({ id: schema.jobCrew.id }).from(schema.jobCrew).where(and(eq(schema.jobCrew.id, crewIdNum), eq(schema.jobCrew.jobId, idNum))).get();
  if (!row) return c.json({ error: "Crew member not found" }, 404);
  await db.delete(schema.jobCrew).where(eq(schema.jobCrew.id, crewIdNum));
  return c.json({ ok: true }, 200);
});

// ── Review request ──────────────────────────────────────────────────
// admin/office/estimator only (not technicians -- same gate as job crew
// above). Honest { sent, reason } shape, same contract as sendEmail/the
// estimate-send flow -- never a fake success when unconfigured/no key/no
// review_url/no customer email. Reuses the EXISTING sendEmail() from
// src/lib/notify.ts rather than reinventing delivery.
const requestJobReview = createRoute({
  method: "post",
  path: "/api/jobs/{id}/request-review",
  request: { params: IdParam },
  responses: {
    200: { description: "Attempted", content: { "application/json": { schema: z.object({ sent: z.boolean(), reason: z.string().optional() }) } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(requestJobReview, async (c) => {
  const forbidden = requireAdminOrOfficeOrEstimatorOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db
    .select({ id: schema.jobs.id, brandId: schema.jobs.brandId, customerId: schema.jobs.customerId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, idNum))
    .get();
  if (!job) return c.json({ error: "Job not found" }, 404);

  if (!job.brandId) {
    return c.json({ sent: false, reason: "job has no brand" }, 200);
  }
  const brand = await db.select({ name: schema.brands.name, reviewUrl: schema.brands.reviewUrl }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).get();
  if (!brand?.reviewUrl) {
    return c.json({ sent: false, reason: "brand has no review_url configured" }, 200);
  }
  const customer = await db.select({ name: schema.customers.name, email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, job.customerId)).get();
  if (!customer?.email) {
    return c.json({ sent: false, reason: "customer has no email on file" }, 200);
  }

  const result = await sendEmail(c.env, {
    to: customer.email,
    subject: `How did we do, ${customer.name || "there"}?`,
    html:
      `<div style="font-family:Georgia,serif;color:#1a2b4a">` +
      `<p>Hi ${escapeHtml(customer.name || "there")},</p>` +
      `<p>Thank you for choosing ${escapeHtml(brand.name)}! We'd love to hear about your experience.</p>` +
      `<p><a href="${brand.reviewUrl}" style="display:inline-block;padding:10px 18px;background:#1a2b4a;color:#fff;text-decoration:none;border-radius:6px">Leave us a review</a></p>` +
      `<p style="font-size:13px;color:#5a6478">Or paste this link into your browser:<br>${escapeHtml(brand.reviewUrl)}</p>` +
      `<p style="font-size:13px;color:#5a6478">Thank you,<br>${escapeHtml(brand.name)} — Tampa, FL</p>` +
      `</div>`,
    text: `Thank you for choosing ${brand.name}! We'd love your feedback: ${brand.reviewUrl}`,
  });
  return c.json({ sent: result.sent, reason: result.reason }, 200);
});

// ── Job Notes ──────────────────────────────────────────────────────

const addJobNote = createRoute({
  method: "post",
  path: "/api/jobs/{id}/notes",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ content: z.string() }) } } },
  },
  responses: {
    201: { description: "Note added", content: { "application/json": { schema: JobNoteSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Job not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addJobNote, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (!(await jobExists(db, idNum))) return c.json({ error: "Job not found" }, 404);
  if (c.get("user").role === "technician") {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }
  const { content } = c.req.valid("json");
  await db.insert(schema.jobNotes).values({ jobId: idNum, content });
  const note = await db.select().from(schema.jobNotes).where(eq(schema.jobNotes.jobId, idNum)).orderBy(desc(schema.jobNotes.id)).limit(1).get();
  return c.json({ id: note!.id, job_id: note!.jobId, content: note!.content, created_at: note!.createdAt! }, 201);
});

const deleteJobNote = createRoute({
  method: "delete",
  path: "/api/notes/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteJobNote, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (c.get("user").role === "technician") {
    const note = await db.select({ jobId: schema.jobNotes.jobId }).from(schema.jobNotes).where(eq(schema.jobNotes.id, idNum)).get();
    if (note) {
      const forbidden = await requireOwnJobOrForbid(c, db, note.jobId);
      if (forbidden) return forbidden;
    }
  }
  await db.delete(schema.jobNotes).where(eq(schema.jobNotes.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Attachments (photos/docs on jobs, estimates, customers) ──────────
// Not covered by the blanket technician role-gate above (unlike
// /api/estimates, /api/customers, /api/invoices) because authorization here
// depends on which entity_type/entity_id the caller is targeting, which
// only the route handler can resolve (entity_type/entity_id live in the
// request body or query string, not the URL path). Each handler below
// enforces:
//   - entity_type "job": same per-job ownership rule as job notes/checklist/
//     materials -- technician may act only on jobs they own, via
//     requireOwnJobOrForbid.
//   - entity_type "estimate" or "customer": technician is blocked outright
//     (403), matching how those resource families are already fully
//     blocked for that role elsewhere.
//   - admin/office/estimator: full access regardless of entity_type (no
//     extra check needed -- the technician-only checks below simply don't
//     apply to them).
const ATTACHMENT_ENTITY_TYPES = ["job", "estimate", "customer"] as const;
type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

// Server-side upload guards for /api/attachments (job photos/docs) and
// /api/brands/:id/logo -- neither route capped size or content-type before
// this pass, so R2 would silently store an arbitrarily large file and
// `await file.arrayBuffer()` would read the whole thing into Worker memory
// first. `file.size` is checked BEFORE that read so an oversized upload is
// rejected with a clean 400 instead of the arrayBuffer() call itself
// blowing up. Content-type is checked against a server-side allowlist AND
// against the file's actual magic bytes (sniffFileType below) -- the
// declared multipart Content-Type header alone is trivially spoofable (an
// .exe renamed with Content-Type: image/png sailed straight through an
// allowlist-only check; caught live by adversarial review before this was
// added).
const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024; // 15MB -- plenty for job photos/docs
const ATTACHMENT_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "application/pdf"];
const LOGO_MAX_BYTES = 3 * 1024 * 1024; // 3MB -- plenty for a brand logo image
const LOGO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

// Checks the file's ACTUAL bytes against the format its declaredType claims
// to be. Not full antivirus/format validation -- just enough to catch "this
// isn't remotely the format it claims to be" (e.g. an MZ-header executable
// uploaded with a spoofed image/* Content-Type). Most formats are checked by
// magic-byte signature; SVG is text so it's checked for a real <svg> tag
// instead.
function sniffFileType(bytes: Uint8Array, declaredType: string): boolean {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const asciiAt = (offset: number, len: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + len));

  switch (declaredType) {
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return asciiAt(0, 6) === "GIF87a" || asciiAt(0, 6) === "GIF89a";
    case "image/webp":
      return asciiAt(0, 4) === "RIFF" && asciiAt(8, 4) === "WEBP";
    case "image/heic":
      // ISO base media file format: "ftyp" box at offset 4, brand at offset 8.
      return asciiAt(4, 4) === "ftyp" && /^(heic|heix|heim|heis|hevc|hevx|mif1)\0*$/.test(asciiAt(8, 4));
    case "application/pdf":
      return asciiAt(0, 5) === "%PDF-";
    case "image/svg+xml": {
      // Text format, not magic bytes: confirm a real <svg> tag appears near
      // the start (after an optional BOM/XML prolog/DOCTYPE/comments) rather
      // than trusting the declared type alone.
      const head = new TextDecoder("utf-8", { fatal: false })
        .decode(bytes.slice(0, Math.min(bytes.length, 1024)))
        .replace(/^﻿/, "")
        .trimStart();
      return /^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
    }
    default:
      return false;
  }
}

function attachmentOut(row: typeof schema.attachments.$inferSelect) {
  return {
    id: row.id,
    entity_type: row.entityType,
    entity_id: row.entityId,
    kind: row.kind,
    r2_key: row.r2Key,
    filename: row.filename,
    content_type: row.contentType,
    uploaded_by: row.uploadedBy,
    created_at: row.createdAt ?? "",
  };
}

// Technician authorization for an attachment operation against a given
// entity_type/entity_id pair. Returns a Response to short-circuit with (403
// forbidden) if the technician may not act on it, or null if they may (or
// the caller isn't a technician, in which case this isn't even called).
async function requireAttachmentAccessOrForbid(c: Context<AppBindings>, db: ReturnType<typeof getDb>, entityType: string, entityId: number) {
  if (entityType === "job") {
    return requireOwnJobOrForbid(c, db, entityId);
  }
  // estimate | customer -- technicians get no access at all, matching the
  // blanket block on those resource families.
  return c.json({ error: "forbidden" }, 403);
}

// Upload is a plain Hono route (not app.openapi/Zod), same rationale as the
// brand logo upload route above: multipart file bodies don't fit the
// JSON-schema request shape the rest of this file uses.
//
// R2 key scheme: attachments/{entity_type}/{entity_id}/{uuid}-{filename}.
// crypto.randomUUID() (available in the Workers runtime) avoids collisions
// between concurrent uploads to the same entity without relying on
// Date.now()/Math.random() -- two uploads landing in the same millisecond
// would otherwise be able to collide. The original filename is kept as a
// suffix purely so the key stays human-readable in the R2 dashboard; it
// plays no role in uniqueness.
app.post("/api/attachments", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.parseBody();

  const entityType = String(body["entity_type"] || "");
  const entityIdRaw = String(body["entity_id"] || "");
  const kind = String(body["kind"] || "doc");
  const file = body["file"];

  if (!ATTACHMENT_ENTITY_TYPES.includes(entityType as AttachmentEntityType)) {
    return c.json({ error: `Invalid entity_type -- must be one of: ${ATTACHMENT_ENTITY_TYPES.join(", ")}` }, 400);
  }
  const entityId = toId(entityIdRaw);
  if (entityId === -1) {
    return c.json({ error: "Invalid entity_id" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file upload (multipart field \"file\")" }, 400);
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return c.json({ error: `File too large -- max ${ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB` }, 400);
  }
  if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: `Invalid file type -- must be one of: ${ATTACHMENT_ALLOWED_TYPES.join(", ")}` }, 400);
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffFileType(fileBytes, file.type)) {
    return c.json({ error: `File content doesn't match its declared type (${file.type}).` }, 400);
  }

  const user = c.get("user");
  if (user.role === "technician") {
    const forbidden = await requireAttachmentAccessOrForbid(c, db, entityType, entityId);
    if (forbidden) return forbidden;
  }

  const key = `attachments/${entityType}/${entityId}/${crypto.randomUUID()}-${file.name}`;
  await c.env.BUCKET.put(key, fileBytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  await db.insert(schema.attachments).values({
    entityType,
    entityId,
    kind,
    r2Key: key,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    uploadedBy: user.id,
  });
  const row = await db.select().from(schema.attachments).where(eq(schema.attachments.r2Key, key)).orderBy(desc(schema.attachments.id)).limit(1).get();
  return c.json(attachmentOut(row!), 201);
});

const listAttachments = createRoute({
  method: "get",
  path: "/api/attachments",
  request: {
    query: z.object({
      entity_type: z.string(),
      entity_id: z.string(),
    }),
  },
  responses: {
    200: { description: "Attachments for an entity", content: { "application/json": { schema: z.object({ attachments: z.array(AttachmentSchema) }) } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listAttachments, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  if (!ATTACHMENT_ENTITY_TYPES.includes(q.entity_type as AttachmentEntityType)) {
    return c.json({ error: `Invalid entity_type -- must be one of: ${ATTACHMENT_ENTITY_TYPES.join(", ")}` }, 400);
  }
  const entityId = toId(q.entity_id);
  if (entityId === -1) {
    return c.json({ error: "Invalid entity_id" }, 400);
  }

  const user = c.get("user");
  if (user.role === "technician") {
    const forbidden = await requireAttachmentAccessOrForbid(c, db, q.entity_type, entityId);
    if (forbidden) return forbidden;
  }

  const rows = await db
    .select()
    .from(schema.attachments)
    .where(and(eq(schema.attachments.entityType, q.entity_type), eq(schema.attachments.entityId, entityId)))
    .orderBy(desc(schema.attachments.createdAt))
    .all();
  return c.json({ attachments: rows.map(attachmentOut) }, 200);
});

const deleteAttachment = createRoute({
  method: "delete",
  path: "/api/attachments/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteAttachment, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const row = await db.select().from(schema.attachments).where(eq(schema.attachments.id, idNum)).get();
  if (!row) return c.json({ error: "Attachment not found" }, 404);

  const user = c.get("user");
  if (user.role === "technician") {
    const forbidden = await requireAttachmentAccessOrForbid(c, db, row.entityType, row.entityId);
    if (forbidden) return forbidden;
  }

  // Delete the R2 object first -- if this throws, the D1 row is left intact
  // so the attachment can be retried/deleted again rather than silently
  // leaking an orphaned row that points at a (possibly still-present, if
  // the throw was transient) object with no DB record.
  await c.env.BUCKET.delete(row.r2Key);
  await db.delete(schema.attachments).where(eq(schema.attachments.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Customers ──────────────────────────────────────────────────────

const listCustomers = createRoute({
  method: "get",
  path: "/api/customers",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      brand_id: zBrandIdQuery,
    }),
  },
  responses: {
    200: {
      description: "Paginated customer list",
      content: { "application/json": { schema: z.object({ customers: z.array(CustomerSchema), total: z.number().int() }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listCustomers, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const conditions = [];
  const brandRes = await resolveBrandFilter(db, q.brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  if (brandFilter !== null) {
    conditions.push(eq(schema.customers.brandId, brandFilter));
  }
  if (q.search) {
    conditions.push(or(
      likeEscaped(schema.customers.name, q.search),
      likeEscaped(schema.customers.email, q.search),
      likeEscaped(schema.customers.phone, q.search),
      likeEscaped(schema.customers.address, q.search),
    ));
  }
  if (q.status) {
    conditions.push(eq(schema.customers.status, q.status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countRow = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.customers).where(where).get();

  const jobCountSub = db.$with("jc").as(
    db.select({ customerId: schema.jobs.customerId, cnt: sql<number>`COUNT(*)`.as("cnt") })
      .from(schema.jobs)
      .groupBy(schema.jobs.customerId)
  );

  const customers = await db
    .with(jobCountSub)
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      email: schema.customers.email,
      phone: schema.customers.phone,
      address: schema.customers.address,
      city: schema.customers.city,
      state: schema.customers.state,
      zip: schema.customers.zip,
      notes: schema.customers.notes,
      status: schema.customers.status,
      source: schema.customers.source,
      brand_id: schema.customers.brandId,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      created_at: sql<string>`COALESCE(${schema.customers.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.customers.updatedAt}, '')`,
      job_count: sql<number>`COALESCE(${jobCountSub.cnt}, 0)`,
    })
    .from(schema.customers)
    .leftJoin(jobCountSub, eq(jobCountSub.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.customers.brandId, schema.brands.id))
    .where(where)
    .orderBy(asc(schema.customers.name))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ customers, total: countRow?.count || 0 }, 200);
});

const listAllCustomers = createRoute({
  method: "get",
  path: "/api/customers/all",
  request: {
    query: z.object({ brand_id: zBrandIdQuery }),
  },
  responses: {
    200: {
      description: "All customers (for dropdowns)",
      content: { "application/json": { schema: z.object({ customers: z.array(z.object({ id: z.number().int(), name: z.string(), address: z.string(), brand_id: z.number().int().nullable() })) }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listAllCustomers, async (c) => {
  const db = getDb(c.env);
  const brandRes = await resolveBrandFilter(db, c.req.valid("query").brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  const customers = await db
    .select({ id: schema.customers.id, name: schema.customers.name, address: schema.customers.address, brand_id: schema.customers.brandId })
    .from(schema.customers)
    .where(brandFilter === null ? undefined : eq(schema.customers.brandId, brandFilter))
    .orderBy(asc(schema.customers.name))
    .all();
  return c.json({ customers }, 200);
});

const getCustomer = createRoute({
  method: "get",
  path: "/api/customers/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Customer detail", content: { "application/json": { schema: z.object({
      customer: CustomerSchema,
      jobs: z.array(JobSchema),
      estimates: z.array(EstimateSchema),
      invoices: z.array(InvoiceSchema),
      outstanding_balance: z.number(),
    }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const customer = await db.select().from(schema.customers).where(eq(schema.customers.id, idNum)).get();
  if (!customer) return c.json({ error: "Customer not found" }, 404);
  const customerBrand = customer.brandId
    ? await db.select({ name: schema.brands.name, colorPrimary: schema.brands.colorPrimary }).from(schema.brands).where(eq(schema.brands.id, customer.brandId)).get()
    : null;
  const customerOut = {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    notes: customer.notes,
    status: customer.status,
    source: customer.source,
    brand_id: customer.brandId,
    brand_name: customerBrand?.name ?? null,
    brand_color_primary: customerBrand?.colorPrimary ?? null,
    created_at: customer.createdAt ?? "",
    updated_at: customer.updatedAt ?? "",
  };
  const jobs = await db
    .select({
      id: schema.jobs.id,
      identifier: schema.jobs.identifier,
      customer_id: schema.jobs.customerId,
      technician_id: schema.jobs.technicianId,
      service_type_id: schema.jobs.serviceTypeId,
      status: schema.jobs.status,
      priority: schema.jobs.priority,
      scheduled_date: schema.jobs.scheduledDate,
      scheduled_time: sql<string>`COALESCE(${schema.jobs.scheduledTime}, '')`,
      duration: schema.jobs.duration,
      price: schema.jobs.price,
      address: sql<string>`COALESCE(${schema.jobs.address}, '')`,
      notes: sql<string>`COALESCE(${schema.jobs.notes}, '')`,
      completion_notes: sql<string>`COALESCE(${schema.jobs.completionNotes}, '')`,
      is_recurring: schema.jobs.isRecurring,
      recurrence_interval: sql<string>`COALESCE(${schema.jobs.recurrenceInterval}, '')`,
      next_recurrence_date: sql<string>`COALESCE(${schema.jobs.nextRecurrenceDate}, '')`,
      brand_id: schema.jobs.brandId,
      created_at: sql<string>`COALESCE(${schema.jobs.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.jobs.updatedAt}, '')`,
      technician_name: schema.technicians.name,
      technician_color: schema.technicians.color,
      service_type_name: schema.serviceTypes.name,
      service_type_color: schema.serviceTypes.color,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.jobs)
    .leftJoin(schema.technicians, eq(schema.jobs.technicianId, schema.technicians.id))
    .leftJoin(schema.serviceTypes, eq(schema.jobs.serviceTypeId, schema.serviceTypes.id))
    .leftJoin(schema.brands, eq(schema.jobs.brandId, schema.brands.id))
    .where(eq(schema.jobs.customerId, idNum))
    .orderBy(desc(schema.jobs.scheduledDate))
    .limit(50)
    .all();

  // ── Money rollup: this customer's estimates + invoices, plus the total
  // outstanding balance across invoices that aren't fully paid/cancelled. ──
  const estimates = await estimateJoinedSelect(db)
    .where(eq(schema.estimates.customerId, idNum))
    .orderBy(desc(schema.estimates.createdAt))
    .all();

  const invoices = await db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      customer_id: schema.invoices.customerId,
      job_id: schema.invoices.jobId,
      status: schema.invoices.status,
      subtotal: schema.invoices.subtotal,
      tax_rate: schema.invoices.taxRate,
      tax_amount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      due_date: schema.invoices.dueDate,
      paid_date: schema.invoices.paidDate,
      created_at: schema.invoices.createdAt,
      updated_at: schema.invoices.updatedAt,
      brand_id: schema.invoices.brandId,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.invoices)
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(eq(schema.invoices.customerId, idNum))
    .orderBy(desc(schema.invoices.createdAt))
    .all();

  // Outstanding balance = sum of the still-owed portion of every invoice that
  // is sent/overdue/draft (i.e. not fully paid and not cancelled). Per-invoice
  // owed = total - raw credit already collected (amount - surcharge for each
  // paid payment, mirroring recordPayment's raw-credit accounting), floored at
  // 0. This whole computation runs in CENTS (invoices/payments are read raw
  // from the DB, pre-conversion) -- exact integer math, no float drift -- and
  // is converted to dollars only once, at the very end via fromCents().
  const paidPayments = await db
    .select({ invoiceId: schema.payments.invoiceId, amount: schema.payments.amount, surchargeAmount: schema.payments.surchargeAmount })
    .from(schema.payments)
    .leftJoin(schema.invoices, eq(schema.payments.invoiceId, schema.invoices.id))
    .where(and(eq(schema.invoices.customerId, idNum), eq(schema.payments.status, "paid")))
    .all();
  const rawCreditByInvoiceCents = new Map<number, number>();
  for (const p of paidPayments) {
    const prev = rawCreditByInvoiceCents.get(p.invoiceId) || 0;
    rawCreditByInvoiceCents.set(p.invoiceId, prev + ((p.amount || 0) - (p.surchargeAmount || 0)));
  }
  let outstandingBalanceCents = 0;
  for (const inv of invoices) {
    if (inv.status === "paid" || inv.status === "cancelled") continue;
    const owedCents = (inv.total || 0) - (rawCreditByInvoiceCents.get(inv.id) || 0);
    if (owedCents > 0) outstandingBalanceCents += owedCents;
  }

  const jobsOut = jobJoinedSelectOut(jobs);
  const invoicesOut = invoices.map((inv) => ({
    ...inv,
    subtotal: fromCentsNullable(inv.subtotal),
    tax_amount: fromCentsNullable(inv.tax_amount),
    total: fromCentsNullable(inv.total),
  }));

  return c.json({
    customer: customerOut,
    jobs: jobsOut,
    estimates: estimateJoinedSelectOut(estimates),
    invoices: invoicesOut,
    outstanding_balance: fromCents(outstandingBalanceCents),
  }, 200);
});

const createCustomer = createRoute({
  method: "post",
  path: "/api/customers",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: zName,
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        notes: z.string().optional(),
        // Lead pipeline: status defaults to 'lead' when omitted; source is
        // optional and may be explicitly null (unknown).
        status: z.enum(CUSTOMER_STATUSES).optional(),
        source: z.enum(CUSTOMER_SOURCES).nullable().optional(),
        // Multi-account: which account/brand owns this customer. Optional and
        // nullable (an unassigned customer is legal); validated to exist below.
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: CustomerSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createCustomer, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  await db.insert(schema.customers).values({
    name: data.name,
    email: data.email || "",
    phone: data.phone || "",
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    zip: data.zip || "",
    notes: data.notes || "",
    status: data.status || "lead",
    source: data.source ?? null,
    brandId: data.brand_id ?? null,
  });
  const customer = await db.select().from(schema.customers).orderBy(desc(schema.customers.id)).limit(1).get();
  const customerOut = {
    id: customer!.id,
    name: customer!.name,
    email: customer!.email,
    phone: customer!.phone,
    address: customer!.address,
    city: customer!.city,
    state: customer!.state,
    zip: customer!.zip,
    notes: customer!.notes,
    status: customer!.status,
    source: customer!.source,
    brand_id: customer!.brandId,
    created_at: customer!.createdAt ?? "",
    updated_at: customer!.updatedAt ?? "",
  };
  return c.json(customerOut, 201);
});

const updateCustomer = createRoute({
  method: "put",
  path: "/api/customers/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        // If name is sent at all it must be non-blank (can't blank out an
        // existing customer's name); omitting it leaves the name unchanged.
        name: zName.optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(CUSTOMER_STATUSES).optional(),
        source: z.enum(CUSTOMER_SOURCES).nullable().optional(),
        // Multi-account: reassign (or clear) the owning account.
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.email !== undefined) updates.email = data.email;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.address !== undefined) updates.address = data.address;
  if (data.city !== undefined) updates.city = data.city;
  if (data.state !== undefined) updates.state = data.state;
  if (data.zip !== undefined) updates.zip = data.zip;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.status !== undefined) updates.status = data.status;
  if (data.source !== undefined) updates.source = data.source;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = sql`(datetime('now'))`;
    await db.update(schema.customers).set(updates).where(eq(schema.customers.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

const deleteCustomer = createRoute({
  method: "delete",
  path: "/api/customers/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Has billing history", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const customer = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, idNum)).get();
  if (!customer) return c.json({ error: "Customer not found" }, 404);

  // Delete guard: never destroy financial records by cascade. A customer with
  // any invoices (or payments against those invoices) has billing history that
  // must be preserved for accounting/audit -- block the delete with a 409.
  // Jobs alone don't block (jobs cascade-delete and carry no money on their
  // own beyond the price snapshot); the financial trail is what we protect.
  const invoiceRow = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.customerId, idNum)).get();
  if (invoiceRow) {
    return c.json({ error: "Cannot delete a customer with billing history (invoices exist)." }, 409);
  }
  // Belt-and-suspenders: also block if any payment row exists against this
  // customer's invoices (covers any orphaned/edge case where an invoice was
  // removed but its payments weren't).
  const paymentRow = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .leftJoin(schema.invoices, eq(schema.payments.invoiceId, schema.invoices.id))
    .where(eq(schema.invoices.customerId, idNum))
    .get();
  if (paymentRow) {
    return c.json({ error: "Cannot delete a customer with billing history (payments exist)." }, 409);
  }

  await db.delete(schema.customers).where(eq(schema.customers.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Technicians ────────────────────────────────────────────────────

const listTechnicians = createRoute({
  method: "get",
  path: "/api/technicians",
  responses: {
    200: {
      description: "All technicians",
      content: { "application/json": { schema: z.object({ technicians: z.array(TechnicianSchema) }) } },
    },
  },
});

app.openapi(listTechnicians, async (c) => {
  const db = getDb(c.env);
  const jobCountSub = db.$with("jc").as(
    db.select({ technicianId: schema.jobs.technicianId, cnt: sql<number>`COUNT(*)`.as("cnt") })
      .from(schema.jobs)
      .where(inArray(schema.jobs.status, ["scheduled", "confirmed", "in_progress"]))
      .groupBy(schema.jobs.technicianId)
  );
  const technicians = await db
    .with(jobCountSub)
    .select({
      id: schema.technicians.id,
      name: schema.technicians.name,
      email: schema.technicians.email,
      phone: schema.technicians.phone,
      color: schema.technicians.color,
      active: schema.technicians.active,
      is_subcontractor: schema.technicians.isSubcontractor,
      created_at: sql<string>`COALESCE(${schema.technicians.createdAt}, '')`,
      job_count: sql<number>`COALESCE(${jobCountSub.cnt}, 0)`,
    })
    .from(schema.technicians)
    .leftJoin(jobCountSub, eq(jobCountSub.technicianId, schema.technicians.id))
    .orderBy(asc(schema.technicians.name))
    .all();
  return c.json({ technicians }, 200);
});

const listAllTechnicians = createRoute({
  method: "get",
  path: "/api/technicians/all",
  responses: {
    200: {
      description: "Active technicians (for dropdowns)",
      content: { "application/json": { schema: z.object({ technicians: z.array(z.object({ id: z.number().int(), name: z.string(), color: z.string() })) }) } },
    },
  },
});

app.openapi(listAllTechnicians, async (c) => {
  const db = getDb(c.env);
  const technicians = await db
    .select({ id: schema.technicians.id, name: schema.technicians.name, color: schema.technicians.color })
    .from(schema.technicians)
    .where(eq(schema.technicians.active, 1))
    .orderBy(asc(schema.technicians.name))
    .all();
  return c.json({ technicians }, 200);
});

const createTechnician = createRoute({
  method: "post",
  path: "/api/technicians",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: zName,
        email: z.string().optional(),
        phone: z.string().optional(),
        color: z.string().optional(),
        is_subcontractor: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TechnicianSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createTechnician, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  await db.insert(schema.technicians).values({
    name: data.name,
    email: data.email || "",
    phone: data.phone || "",
    color: data.color || "#16a34a",
    isSubcontractor: data.is_subcontractor || 0,
  });
  const tech = await db.select().from(schema.technicians).orderBy(desc(schema.technicians.id)).limit(1).get();
  const techOut = {
    id: tech!.id,
    name: tech!.name,
    email: tech!.email,
    phone: tech!.phone,
    color: tech!.color,
    active: tech!.active,
    is_subcontractor: tech!.isSubcontractor,
    created_at: tech!.createdAt ?? "",
  };
  return c.json(techOut, 201);
});

const updateTechnician = createRoute({
  method: "put",
  path: "/api/technicians/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        name: zName.optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        color: z.string().optional(),
        active: z.number().int().optional(),
        is_subcontractor: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(updateTechnician, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.email !== undefined) updates.email = data.email;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.color !== undefined) updates.color = data.color;
  if (data.active !== undefined) updates.active = data.active;
  if (data.is_subcontractor !== undefined) updates.isSubcontractor = data.is_subcontractor;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.technicians).set(updates).where(eq(schema.technicians.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

const deleteTechnician = createRoute({
  method: "delete",
  path: "/api/technicians/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteTechnician, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.technicians).where(eq(schema.technicians.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Service Types ──────────────────────────────────────────────────

const listServiceTypes = createRoute({
  method: "get",
  path: "/api/service-types",
  responses: {
    200: {
      description: "All service types",
      content: { "application/json": { schema: z.object({ service_types: z.array(ServiceTypeSchema) }) } },
    },
  },
});

app.openapi(listServiceTypes, async (c) => {
  const db = getDb(c.env);
  const types = await db
    .select({
      id: schema.serviceTypes.id,
      name: schema.serviceTypes.name,
      description: schema.serviceTypes.description,
      default_duration: schema.serviceTypes.defaultDuration,
      default_price: schema.serviceTypes.defaultPrice,
      color: schema.serviceTypes.color,
      brand_id: schema.serviceTypes.brandId,
      created_at: sql<string>`COALESCE(${schema.serviceTypes.createdAt}, '')`,
    })
    .from(schema.serviceTypes)
    .orderBy(asc(schema.serviceTypes.name))
    .all();
  return c.json({ service_types: types }, 200);
});

const createServiceType = createRoute({
  method: "post",
  path: "/api/service-types",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: zName,
        description: z.string().optional(),
        default_duration: z.number().int().positive().optional(),
        default_price: zMoney.optional(),
        color: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ServiceTypeSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createServiceType, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  await db.insert(schema.serviceTypes).values({
    name: data.name,
    description: data.description || "",
    defaultDuration: data.default_duration || 60,
    defaultPrice: data.default_price || 0,
    color: data.color || "#6b7280",
    brandId: data.brand_id ?? null,
  });
  const st = await db.select().from(schema.serviceTypes).orderBy(desc(schema.serviceTypes.id)).limit(1).get();
  const stOut = {
    id: st!.id,
    name: st!.name,
    description: st!.description,
    default_duration: st!.defaultDuration,
    default_price: st!.defaultPrice,
    color: st!.color,
    brand_id: st!.brandId,
    created_at: st!.createdAt ?? "",
  };
  return c.json(stOut, 201);
});

const updateServiceType = createRoute({
  method: "put",
  path: "/api/service-types/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        name: zName.optional(),
        description: z.string().optional(),
        default_duration: z.number().int().positive().optional(),
        default_price: zMoney.optional(),
        color: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateServiceType, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.default_duration !== undefined) updates.defaultDuration = data.default_duration;
  if (data.default_price !== undefined) updates.defaultPrice = data.default_price;
  if (data.color !== undefined) updates.color = data.color;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.serviceTypes).set(updates).where(eq(schema.serviceTypes.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

const deleteServiceType = createRoute({
  method: "delete",
  path: "/api/service-types/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteServiceType, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.serviceTypes).where(eq(schema.serviceTypes.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Brands ─────────────────────────────────────────────────────────
// Low-sensitivity read (GET) is open to all authenticated roles, including
// technician, since brand-tagged UI (colored pills, logos) shows up
// everywhere -- jobs, invoices, schedule. Mutations (create/update/logo
// upload) are office/admin only via requireAdminOrOfficeOrForbid, since
// brand identity management is neither a sales (estimator) nor field
// (technician) task.

const listBrands = createRoute({
  method: "get",
  path: "/api/brands",
  responses: {
    200: {
      description: "All brands",
      content: { "application/json": { schema: z.object({ brands: z.array(BrandSchema) }) } },
    },
  },
});

app.openapi(listBrands, async (c) => {
  const db = getDb(c.env);
  const brands = await db
    .select({
      id: schema.brands.id,
      name: schema.brands.name,
      slug: schema.brands.slug,
      color_primary: schema.brands.colorPrimary,
      color_secondary: schema.brands.colorSecondary,
      logo_r2_key: schema.brands.logoR2Key,
      active: schema.brands.active,
      review_url: schema.brands.reviewUrl,
      is_demo: schema.brands.isDemo,
    })
    .from(schema.brands)
    .orderBy(asc(schema.brands.name))
    .all();
  return c.json({ brands }, 200);
});

// review_url: accepts a real URL, "" (explicitly clear it), or omitted --
// only validated as a URL when a non-empty value is present, matching the
// build instruction ("validated as a URL when present").
const zReviewUrl = z.union([zUrl, z.literal("")]).optional();

const createBrand = createRoute({
  method: "post",
  path: "/api/brands",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: zName,
        slug: zName,
        color_primary: zHexColor.optional(),
        color_secondary: zHexColor.optional(),
        active: z.number().int().optional(),
        review_url: zReviewUrl,
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: BrandSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createBrand, async (c) => {
  const forbidden = requireAdminOrOfficeOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const data = c.req.valid("json");
  await db.insert(schema.brands).values({
    name: data.name,
    slug: data.slug,
    colorPrimary: data.color_primary ?? null,
    colorSecondary: data.color_secondary ?? null,
    active: data.active ?? 1,
    reviewUrl: data.review_url || null,
  });
  const brand = await db.select().from(schema.brands).orderBy(desc(schema.brands.id)).limit(1).get();
  const brandOut = {
    id: brand!.id,
    name: brand!.name,
    slug: brand!.slug,
    color_primary: brand!.colorPrimary,
    color_secondary: brand!.colorSecondary,
    logo_r2_key: brand!.logoR2Key,
    active: brand!.active,
    review_url: brand!.reviewUrl,
    is_demo: brand!.isDemo,
  };
  return c.json(brandOut, 201);
});

const updateBrand = createRoute({
  method: "put",
  path: "/api/brands/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        name: zName.optional(),
        slug: zName.optional(),
        color_primary: zHexColor.optional(),
        color_secondary: zHexColor.optional(),
        active: z.number().int().optional(),
        review_url: zReviewUrl,
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateBrand, async (c) => {
  const forbidden = requireAdminOrOfficeOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.slug !== undefined) updates.slug = data.slug;
  if (data.color_primary !== undefined) updates.colorPrimary = data.color_primary;
  if (data.color_secondary !== undefined) updates.colorSecondary = data.color_secondary;
  if (data.active !== undefined) updates.active = data.active;
  if (data.review_url !== undefined) updates.reviewUrl = data.review_url || null;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.brands).set(updates).where(eq(schema.brands.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

// Logo upload/serve are plain Hono routes (not app.openapi/Zod) -- multipart
// file bodies and binary streaming responses don't fit the JSON-schema
// request/response shape the rest of this file uses, so these two
// deliberately step outside that pattern rather than force a bad fit.
//
// Upload: multipart/form-data with a single "file" field (chosen over a raw
// binary body + content-type header because c.req.parseBody() is Hono's
// built-in, documented way to handle file uploads and keeps the filename's
// extension available without a separate query param or header).
app.post("/api/brands/:id/logo", async (c) => {
  const forbidden = requireAdminOrOfficeOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const idNum = toId(c.req.param("id"));
  const brand = await db.select().from(schema.brands).where(eq(schema.brands.id, idNum)).get();
  if (!brand) return c.json({ error: "Brand not found" }, 404);

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file upload (multipart field \"file\")" }, 400);
  }
  if (file.size > LOGO_MAX_BYTES) {
    return c.json({ error: `File too large -- max ${LOGO_MAX_BYTES / (1024 * 1024)}MB` }, 400);
  }
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: `Invalid file type -- must be one of: ${LOGO_ALLOWED_TYPES.join(", ")}` }, 400);
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffFileType(fileBytes, file.type)) {
    return c.json({ error: `File content doesn't match its declared type (${file.type}).` }, 400);
  }

  const extFromName = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const extFromType = file.type ? file.type.split("/").pop()!.toLowerCase() : "";
  const ext = (extFromName || extFromType || "png").replace(/[^a-z0-9]/g, "") || "png";
  const key = `brands/${brand.slug}-logo.${ext}`;

  await c.env.BUCKET.put(key, fileBytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await db.update(schema.brands).set({ logoR2Key: key }).where(eq(schema.brands.id, idNum));

  return c.json({ ok: true, logo_r2_key: key }, 200);
});

// General-purpose R2 read-through proxy, scoped to an allowlist of key
// prefixes so it can't be used to read arbitrary bucket contents. This is
// what lets <img src="/api/r2/brands/..."> (or "/api/r2/attachments/...")
// render an uploaded logo/photo -- R2 objects aren't otherwise reachable
// from the browser (no public bucket domain configured), and this keeps
// everything behind the same session-auth middleware as the rest of the API
// rather than standing up a separate public asset route.
//
// "attachments/" was added in the attachments feature (Part A) alongside
// the original "brands/" prefix -- extend this array for future R2-backed
// features rather than duplicating the route.
const R2_PROXY_ALLOWED_PREFIXES = ["brands/", "attachments/", "signatures/"];

const EXT_CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

app.get("/api/r2/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/r2\//, "");
  if (!R2_PROXY_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Attachment keys are "attachments/{entity_type}/{entity_id}/...", so a
  // technician's per-job ownership rule can be enforced straight from the
  // key shape without a DB lookup keyed on r2_key -- this mirrors the same
  // rule enforced in the /api/attachments routes so a technician can't view
  // (or leak, via the URL) a photo on a job/estimate/customer they aren't
  // allowed to see.
  const user = c.get("user");
  if (user.role === "technician") {
    if (key.startsWith("attachments/")) {
      const [, entityType, entityIdRaw] = key.split("/");
      const db = getDb(c.env);
      const forbidden = await requireAttachmentAccessOrForbid(c, db, entityType, toId(entityIdRaw));
      if (forbidden) return forbidden;
    } else if (key.startsWith("signatures/")) {
      // E-signature images belong to estimates. Technicians have zero access
      // to estimates at all (the blanket /api/estimates block above), so this
      // is a flat forbid rather than an ownership check -- unlike attachments,
      // there's no "own it" case where a technician should ever see one.
      return c.json({ error: "forbidden" }, 403);
    }
  }
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!headers.get("content-type")) {
    // Objects uploaded without httpMetadata.contentType (e.g. seeded
    // directly via `wrangler r2 object put` rather than through the
    // POST /api/brands/:id/logo route, which always sets it) fall back to
    // an extension guess so <img> tags still render them instead of
    // downloading as application/octet-stream.
    const ext = key.includes(".") ? key.split(".").pop()!.toLowerCase() : "";
    headers.set("content-type", EXT_CONTENT_TYPES[ext] || "application/octet-stream");
  }
  return new Response(obj.body, { headers });
});

// ── Schedule (calendar view) ───────────────────────────────────────

const getSchedule = createRoute({
  method: "get",
  path: "/api/schedule",
  request: {
    query: z.object({
      start: z.string(),
      end: z.string(),
      technician_id: z.string().optional(),
      brand_id: zBrandIdQuery,
    }),
  },
  responses: {
    200: {
      description: "Jobs within date range",
      content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema) }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getSchedule, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const user = c.get("user");
  const conditions: SQL[] = [sql`${schema.jobs.scheduledDate} >= ${q.start}`, sql`${schema.jobs.scheduledDate} <= ${q.end}`];
  // Account scoping composes with the technician force-filter below (same
  // AND'd conditions array) -- it can never widen what a technician sees.
  const brandRes = await resolveBrandFilter(db, q.brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  if (brandFilter !== null) {
    conditions.push(eq(schema.jobs.brandId, brandFilter));
  }
  if (user.role === "technician") {
    // Force-filter to the requester's own technician (lead OR crew -- see
    // isJobOwnerOrCrew/listJobs), overriding any technician_id query param.
    const ownTechId = await getOwnTechnicianId(db, user.id);
    if (ownTechId === null) {
      return c.json({ jobs: [] }, 200);
    }
    const crewJobIds = db.select({ jobId: schema.jobCrew.jobId }).from(schema.jobCrew).where(eq(schema.jobCrew.technicianId, ownTechId));
    // Non-null assert: or() is only undefined when called with zero
    // arguments, and it's always given exactly two here.
    conditions.push(or(eq(schema.jobs.technicianId, ownTechId), inArray(schema.jobs.id, crewJobIds))!);
  } else if (q.technician_id) {
    conditions.push(eq(schema.jobs.technicianId, parseInt(q.technician_id, 10)));
  }
  const jobs = await jobJoinedSelect(db)
    .where(and(...conditions))
    .orderBy(asc(schema.jobs.scheduledDate), asc(schema.jobs.scheduledTime))
    .all();
  return c.json({ jobs: jobJoinedSelectOut(jobs) }, 200);
});

// ── Job Checklist ──────────────────────────────────────────────────

const addChecklistItem = createRoute({
  method: "post",
  path: "/api/jobs/{id}/checklist",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ label: z.string() }) } } },
  },
  responses: {
    201: { description: "Added", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Job not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (!(await jobExists(db, idNum))) return c.json({ error: "Job not found" }, 404);
  if (c.get("user").role === "technician") {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }
  const { label } = c.req.valid("json");
  const maxOrder = await db
    .select({ m: sql<number>`COALESCE(MAX(${schema.jobChecklist.sortOrder}), 0)` })
    .from(schema.jobChecklist)
    .where(eq(schema.jobChecklist.jobId, idNum))
    .get();
  await db.insert(schema.jobChecklist).values({ jobId: idNum, label, sortOrder: (maxOrder?.m || 0) + 1 });
  return c.json({ ok: true }, 201);
});

const toggleChecklistItem = createRoute({
  method: "put",
  path: "/api/checklist/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Toggled", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(toggleChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (c.get("user").role === "technician") {
    const item = await db.select({ jobId: schema.jobChecklist.jobId }).from(schema.jobChecklist).where(eq(schema.jobChecklist.id, idNum)).get();
    if (item) {
      const forbidden = await requireOwnJobOrForbid(c, db, item.jobId);
      if (forbidden) return forbidden;
    }
  }
  await db
    .update(schema.jobChecklist)
    .set({ checked: sql`CASE WHEN ${schema.jobChecklist.checked} = 0 THEN 1 ELSE 0 END` })
    .where(eq(schema.jobChecklist.id, idNum));
  return c.json({ ok: true }, 200);
});

const deleteChecklistItem = createRoute({
  method: "delete",
  path: "/api/checklist/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (c.get("user").role === "technician") {
    const item = await db.select({ jobId: schema.jobChecklist.jobId }).from(schema.jobChecklist).where(eq(schema.jobChecklist.id, idNum)).get();
    if (item) {
      const forbidden = await requireOwnJobOrForbid(c, db, item.jobId);
      if (forbidden) return forbidden;
    }
  }
  await db.delete(schema.jobChecklist).where(eq(schema.jobChecklist.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Materials ──────────────────────────────────────────────────────

const listMaterials = createRoute({
  method: "get",
  path: "/api/materials",
  responses: {
    200: {
      description: "All materials",
      content: { "application/json": { schema: z.object({ materials: z.array(z.object({
        id: z.number().int(),
        name: z.string(),
        unit: z.string(),
        unit_cost: z.number(),
        in_stock: z.number(),
        created_at: z.string(),
      })) }) } },
    },
  },
});

app.openapi(listMaterials, async (c) => {
  const db = getDb(c.env);
  const materials = await db
    .select({
      id: schema.materials.id,
      name: schema.materials.name,
      unit: schema.materials.unit,
      unit_cost: schema.materials.unitCost,
      in_stock: schema.materials.inStock,
      created_at: sql<string>`COALESCE(${schema.materials.createdAt}, '')`,
    })
    .from(schema.materials)
    .orderBy(asc(schema.materials.name))
    .all();
  return c.json({ materials: materials.map((m) => ({ ...m, unit_cost: fromCents(m.unit_cost) })) }, 200);
});

const createMaterial = createRoute({
  method: "post",
  path: "/api/materials",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: zName,
      unit: z.string().optional(),
      unit_cost: zMoney.optional(),
      in_stock: zMoney.optional(),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createMaterial, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  await db.insert(schema.materials).values({
    name: data.name,
    unit: data.unit || "ea",
    unitCost: toCents(data.unit_cost || 0),
    inStock: data.in_stock || 0,
  });
  return c.json({ ok: true }, 201);
});

const updateMaterial = createRoute({
  method: "put",
  path: "/api/materials/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: zName.optional(),
      unit: z.string().optional(),
      unit_cost: zMoney.optional(),
      in_stock: zMoney.optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.unit_cost !== undefined) updates.unitCost = toCents(data.unit_cost);
  if (data.in_stock !== undefined) updates.inStock = data.in_stock;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.materials).set(updates).where(eq(schema.materials.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

const deleteMaterial = createRoute({
  method: "delete",
  path: "/api/materials/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.materials).where(eq(schema.materials.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Products (TKC catalog) ────────────────────────────────────────
// A product catalog distinct from the painting `materials` table above --
// Tampa Kitchen Cabinets (a second brand on this platform) sells door
// styles/hardware/countertops, not paint materials. CRUD mirrors the
// materials routes' pattern exactly: list is readable by everyone incl.
// technicians (no role check in the handler, gated only by the general
// auth-required middleware), mutations are blocked for technicians by the
// same blanket "isMutating && /api/materials" style rule in the technician
// role-gate middleware above (extended to /api/products alongside it).

const ProductSchema = z.object({
  id: z.number().int(),
  brand_id: z.number().int().nullable(),
  name: z.string(),
  sku: z.string().nullable(),
  category: z.string().nullable(),
  unit_cost: z.number(),
  unit: z.string(),
  active: z.number().int(),
  brand_name: z.string().nullable().optional(),
}).openapi("Product");

const listProducts = createRoute({
  method: "get",
  path: "/api/products",
  request: { query: z.object({ brand_id: z.string().optional() }) },
  responses: {
    200: {
      description: "All products",
      content: { "application/json": { schema: z.object({ products: z.array(ProductSchema) }) } },
    },
  },
});

app.openapi(listProducts, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const conditions = [];
  if (q.brand_id) conditions.push(eq(schema.products.brandId, parseInt(q.brand_id, 10)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const products = await db
    .select({
      id: schema.products.id,
      brand_id: schema.products.brandId,
      name: schema.products.name,
      sku: schema.products.sku,
      category: schema.products.category,
      unit_cost: schema.products.unitCost,
      unit: schema.products.unit,
      active: schema.products.active,
      brand_name: schema.brands.name,
    })
    .from(schema.products)
    .leftJoin(schema.brands, eq(schema.products.brandId, schema.brands.id))
    .where(where)
    .orderBy(asc(schema.products.name))
    .all();
  return c.json({ products: products.map((p) => ({ ...p, unit_cost: fromCents(p.unit_cost) })) }, 200);
});

const createProduct = createRoute({
  method: "post",
  path: "/api/products",
  request: {
    body: { content: { "application/json": { schema: z.object({
      brand_id: z.number().int().nullable().optional(),
      name: zName,
      sku: z.string().optional(),
      category: z.string().optional(),
      unit_cost: zMoney.optional(),
      unit: z.string().optional(),
      active: z.number().int().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createProduct, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  await db.insert(schema.products).values({
    brandId: data.brand_id ?? null,
    name: data.name,
    sku: data.sku || null,
    category: data.category || null,
    unitCost: toCents(data.unit_cost || 0),
    unit: data.unit || "ea",
    active: data.active ?? 1,
  });
  return c.json({ ok: true }, 201);
});

const updateProduct = createRoute({
  method: "put",
  path: "/api/products/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      brand_id: z.number().int().nullable().optional(),
      name: zName.optional(),
      sku: z.string().optional(),
      category: z.string().optional(),
      unit_cost: zMoney.optional(),
      unit: z.string().optional(),
      active: z.number().int().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateProduct, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  const updates: Record<string, unknown> = {};
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (data.name !== undefined) updates.name = data.name;
  if (data.sku !== undefined) updates.sku = data.sku;
  if (data.category !== undefined) updates.category = data.category;
  if (data.unit_cost !== undefined) updates.unitCost = toCents(data.unit_cost);
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.active !== undefined) updates.active = data.active;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.products).set(updates).where(eq(schema.products.id, toId(id)));
  }
  return c.json({ ok: true }, 200);
});

const deleteProduct = createRoute({
  method: "delete",
  path: "/api/products/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteProduct, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.products).where(eq(schema.products.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Job Materials ──────────────────────────────────────────────────

const addJobMaterial = createRoute({
  method: "post",
  path: "/api/jobs/{id}/materials",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      material_id: z.number().int(),
      quantity: zPositive,
      unit_cost: zMoney.optional(),
    }) } } },
  },
  responses: {
    201: { description: "Added", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Job not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addJobMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (!(await jobExists(db, idNum))) return c.json({ error: "Job not found" }, 404);
  if (c.get("user").role === "technician") {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }
  const data = c.req.valid("json");
  // Reject a dangling material_id with a clean 400 rather than a raw FK 500.
  const mat = await db.select({ unit_cost: schema.materials.unitCost }).from(schema.materials).where(eq(schema.materials.id, data.material_id)).get();
  if (!mat) return c.json({ error: "Material not found" }, 400);
  // data.unit_cost (if provided) is a DOLLARS value from the client -- convert
  // to cents before comparing/storing alongside mat.unit_cost, which is
  // already raw cents straight from the DB. Mixing an unconverted dollars
  // value with a raw cents value here would silently store a value 100x too
  // small.
  const costCents = data.unit_cost !== undefined ? toCents(data.unit_cost) : (mat.unit_cost || 0);
  await db.insert(schema.jobMaterials).values({
    jobId: idNum,
    materialId: data.material_id,
    quantity: data.quantity,
    unitCost: costCents,
  });
  return c.json({ ok: true }, 201);
});

const deleteJobMaterial = createRoute({
  method: "delete",
  path: "/api/job-materials/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteJobMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (c.get("user").role === "technician") {
    const jm = await db.select({ jobId: schema.jobMaterials.jobId }).from(schema.jobMaterials).where(eq(schema.jobMaterials.id, idNum)).get();
    if (jm) {
      const forbidden = await requireOwnJobOrForbid(c, db, jm.jobId);
      if (forbidden) return forbidden;
    }
  }
  await db.delete(schema.jobMaterials).where(eq(schema.jobMaterials.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Invoices ───────────────────────────────────────────────────────

const listInvoices = createRoute({
  method: "get",
  path: "/api/invoices",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      brand_id: zBrandIdQuery,
    }),
  },
  responses: {
    200: {
      description: "Paginated invoice list",
      content: { "application/json": { schema: z.object({
        invoices: z.array(InvoiceSchema),
        total: z.number().int(),
      }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listInvoices, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const conditions = [];
  const brandRes = await resolveBrandFilter(db, q.brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  if (brandFilter !== null) {
    conditions.push(eq(schema.invoices.brandId, brandFilter));
  }
  if (q.status) {
    conditions.push(eq(schema.invoices.status, q.status));
  }
  if (q.search) {
    conditions.push(or(
      likeEscaped(schema.invoices.identifier, q.search),
      likeEscaped(schema.customers.name, q.search),
    ));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .where(where)
    .get();

  const invoices = await db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      customer_id: schema.invoices.customerId,
      job_id: schema.invoices.jobId,
      status: schema.invoices.status,
      subtotal: schema.invoices.subtotal,
      tax_rate: schema.invoices.taxRate,
      tax_amount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      due_date: schema.invoices.dueDate,
      paid_date: schema.invoices.paidDate,
      created_at: schema.invoices.createdAt,
      updated_at: schema.invoices.updatedAt,
      brand_id: schema.invoices.brandId,
      customer_name: schema.customers.name,
      job_identifier: schema.jobs.identifier,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.jobs, eq(schema.invoices.jobId, schema.jobs.id))
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(where)
    .orderBy(desc(schema.invoices.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ invoices: invoices.map(invoiceMoneyOut), total: countRow?.count || 0 }, 200);
});

// Boundary conversion for an invoices-select row: subtotal/tax_amount/total
// cents -> dollars. Reused by every invoice list/detail route below.
function invoiceMoneyOut<T extends { subtotal: number | null; tax_amount: number | null; total: number | null }>(row: T): T {
  return { ...row, subtotal: fromCentsNullable(row.subtotal), tax_amount: fromCentsNullable(row.tax_amount), total: fromCentsNullable(row.total) };
}
// Boundary conversion for an invoice_lines row: unit_price/total cents -> dollars.
function invoiceLineOut(l: typeof schema.invoiceLines.$inferSelect) {
  return {
    id: l.id,
    invoice_id: l.invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_price: fromCentsNullable(l.unitPrice),
    total: fromCentsNullable(l.total),
  };
}

const getInvoice = createRoute({
  method: "get",
  path: "/api/invoices/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Invoice detail", content: { "application/json": { schema: z.object({ invoice: InvoiceDetailSchema }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getInvoice, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const invoice = await db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      customer_id: schema.invoices.customerId,
      job_id: schema.invoices.jobId,
      status: schema.invoices.status,
      subtotal: schema.invoices.subtotal,
      tax_rate: schema.invoices.taxRate,
      tax_amount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      due_date: schema.invoices.dueDate,
      paid_date: schema.invoices.paidDate,
      created_at: schema.invoices.createdAt,
      updated_at: schema.invoices.updatedAt,
      brand_id: schema.invoices.brandId,
      customer_name: schema.customers.name,
      job_identifier: schema.jobs.identifier,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.jobs, eq(schema.invoices.jobId, schema.jobs.id))
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(eq(schema.invoices.id, idNum))
    .get();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  const lines = await db
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, idNum))
    .orderBy(asc(schema.invoiceLines.id))
    .all();
  const linesOut = lines.map(invoiceLineOut);
  // Nested "payments" array, same pattern as "lines" above -- lets
  // invoice-detail.tsx render the payment history without a second request.
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.invoiceId, idNum))
    .orderBy(desc(schema.payments.id))
    .all();
  const paymentsOut = payments.map(paymentOut);
  return c.json({ invoice: { ...invoiceMoneyOut(invoice), lines: linesOut, payments: paymentsOut } }, 200);
});

// Shared invoice-line shape used by createInvoice, invoiceFromJob's progress-
// billing sibling, and change-order approval -- kept in one place so the
// subtotal/tax/total math (and the invoice-row insert shape) is never
// duplicated across those call sites.
const invoiceLineInput = z.object({
  description: zName,
  quantity: zPositive,
  unit_price: zMoney,
});

// Inserts a new invoice + its lines, computing subtotal/tax_amount/total from
// the lines exactly like createInvoice's route handler does. Returns the new
// invoice's id. Does NOT do referential-sanity checks on customer_id/job_id/
// brand_id (callers that accept those as raw client input, like createInvoice,
// still do their own checks before calling this -- callers that derive
// customer_id/job_id from an already-loaded job/estimate row, like the
// progress-billing and change-order routes, don't need to re-check).
//
// input.lines[].unit_price is DOLLARS (every caller passes client-facing/
// already-converted-to-dollars values) -- converted to cents once at the top,
// then every internal computation (line totals, subtotal, tax, grand total)
// runs in exact integer-cents space before being written to the (cents)
// invoices/invoice_lines columns.
async function createInvoiceWithLines(
  db: ReturnType<typeof getDb>,
  input: { customerId: number; jobId: number | null; taxRate: number; notes: string; dueDate: string; brandId: number | null; status?: string; lines: { description: string; quantity: number; unit_price: number }[] },
): Promise<number> {
  const identifier = await nextInvoiceIdentifier(db);
  const lineTotalsCents = input.lines.map((line) => Math.round(line.quantity * toCents(line.unit_price)));
  const subtotalCents = lineTotalsCents.reduce((sum, t) => sum + t, 0);
  const taxAmountCents = Math.round(subtotalCents * (input.taxRate / 100));
  const totalCents = subtotalCents + taxAmountCents;

  await db.insert(schema.invoices).values({
    identifier,
    customerId: input.customerId,
    jobId: input.jobId,
    status: input.status || "draft",
    subtotal: subtotalCents,
    taxRate: input.taxRate,
    taxAmount: taxAmountCents,
    total: totalCents,
    notes: input.notes,
    dueDate: input.dueDate,
    brandId: input.brandId,
  });
  const invoice = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.identifier, identifier)).get();
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    await db.insert(schema.invoiceLines).values({
      invoiceId: invoice!.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: toCents(line.unit_price),
      total: lineTotalsCents[i],
    });
  }
  return invoice!.id;
}

const createInvoice = createRoute({
  method: "post",
  path: "/api/invoices",
  request: {
    body: { content: { "application/json": { schema: z.object({
      customer_id: z.number().int(),
      job_id: z.number().int().nullable().optional(),
      tax_rate: zTaxRate.optional(),
      notes: z.string().optional(),
      // due_date is optional; if provided it must be a real calendar date.
      // "" (empty) is NOT a valid date -- the client sends the field omitted
      // (undefined) rather than "" when the user leaves it blank.
      due_date: zDate.optional(),
      brand_id: z.number().int().nullable().optional(),
      // At least one line item required on create.
      lines: z.array(z.object({
        description: zName,
        quantity: zPositive,
        unit_price: zMoney,
      })).min(1, { message: "An invoice must have at least one line item" }),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: InvoiceSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// Single-invoice "joined with denormalized fields" lookup by id -- the same
// shape createInvoice/invoiceFromJob's siblings return, factored out so it's
// not retyped at every call site that needs to return a freshly created or
// updated invoice.
async function getInvoiceJoinedById(db: ReturnType<typeof getDb>, invoiceId: number) {
  return db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      customer_id: schema.invoices.customerId,
      job_id: schema.invoices.jobId,
      status: schema.invoices.status,
      subtotal: schema.invoices.subtotal,
      tax_rate: schema.invoices.taxRate,
      tax_amount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      due_date: schema.invoices.dueDate,
      paid_date: schema.invoices.paidDate,
      created_at: schema.invoices.createdAt,
      updated_at: schema.invoices.updatedAt,
      brand_id: schema.invoices.brandId,
      customer_name: schema.customers.name,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(eq(schema.invoices.id, invoiceId))
    .get();
}

app.openapi(createInvoice, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  // Referential sanity before we mint an identifier / insert.
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  if (data.job_id !== null && data.job_id !== undefined) {
    const jobRow = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, data.job_id)).get();
    if (!jobRow) return c.json({ error: "Job not found" }, 400);
  }
  // Multi-account default: omitted brand_id inherits the customer's account
  // (explicit null stays null) -- same rule as createJob/createEstimate.
  let brandId: number | null = data.brand_id ?? null;
  if (data.brand_id === undefined) {
    const custBrand = await db.select({ brandId: schema.customers.brandId }).from(schema.customers).where(eq(schema.customers.id, data.customer_id)).get();
    brandId = custBrand?.brandId ?? null;
  }
  const invoiceId = await createInvoiceWithLines(db, {
    customerId: data.customer_id,
    jobId: data.job_id ?? null,
    taxRate: data.tax_rate || 0,
    notes: data.notes || "",
    dueDate: data.due_date || "",
    brandId,
    lines: data.lines,
  });
  const result = await getInvoiceJoinedById(db, invoiceId);
  return c.json(invoiceMoneyOut(result!), 201);
});

// Recomputes and persists an invoice's subtotal/tax_amount/total from its
// current set of invoice_lines rows, mirroring recomputeEstimateTotals. Called
// after any line add/delete so the parent invoice's totals never drift from
// its line items.
// All money here (lines' total, invoices.subtotal/tax_amount/total) is raw
// cents straight from/to the DB -- this function never crosses the JSON
// boundary, so no toCents/fromCents calls are needed, only Math.round at the
// tax multiplication (now exact integer-cents math, no float drift).
async function recomputeInvoiceTotals(db: ReturnType<typeof getDb>, invoiceId: number) {
  const lines = await db.select({ total: schema.invoiceLines.total }).from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).all();
  const subtotalCents = lines.reduce((sum, l) => sum + (l.total || 0), 0);
  const invoice = await db.select({ taxRate: schema.invoices.taxRate }).from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
  const taxRate = invoice?.taxRate || 0;
  const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
  const totalCents = subtotalCents + taxAmountCents;
  await db.update(schema.invoices).set({ subtotal: subtotalCents, taxAmount: taxAmountCents, total: totalCents, updatedAt: sql`(datetime('now'))` }).where(eq(schema.invoices.id, invoiceId));
}

const updateInvoice = createRoute({
  method: "put",
  path: "/api/invoices/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      status: z.enum(INVOICE_STATUSES).optional(),
      notes: z.string().optional(),
      // "" clears the date (the date input sends "" when the user clears it);
      // any non-empty value must be a real calendar date.
      due_date: z.union([z.literal(""), zDate]).optional(),
      paid_date: z.union([z.literal(""), zDate]).optional(),
      // Editable tax rate (0-100). invoiceFromJob defaults tax_rate to 0; this
      // lets the office add real tax after the invoice exists. Recomputes
      // tax_amount/total from the current lines-derived subtotal.
      tax_rate: zTaxRate.optional(),
      brand_id: z.number().int().nullable().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked invoice", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateInvoice, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const data = c.req.valid("json");
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  const existing = await db.select({ subtotal: schema.invoices.subtotal, status: schema.invoices.status }).from(schema.invoices).where(eq(schema.invoices.id, idNum)).get();
  if (!existing) return c.json({ error: "Invoice not found" }, 404);
  // Don't let a money-affecting edit (tax rate) silently desync a paid or
  // cancelled invoice's total from the payment(s) already recorded against it.
  if (data.tax_rate !== undefined && (existing.status === "paid" || existing.status === "cancelled")) {
    return c.json({ error: `Cannot change the tax rate on a ${existing.status} invoice.` }, 409);
  }
  const updates: Record<string, unknown> = {};
  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.due_date !== undefined) updates.dueDate = data.due_date;
  if (data.paid_date !== undefined) updates.paidDate = data.paid_date;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  // Recompute tax_amount/total if tax_rate changes -- subtotal stays derived
  // from lines (this route never touches lines directly), so reuse the
  // existing subtotal (already raw cents from the DB), exactly like
  // updateEstimate does. Math.round keeps the result an exact integer-cents
  // value.
  if (data.tax_rate !== undefined) {
    const subtotalCents = existing.subtotal || 0;
    const taxAmountCents = Math.round(subtotalCents * (data.tax_rate / 100));
    updates.taxRate = data.tax_rate;
    updates.taxAmount = taxAmountCents;
    updates.total = subtotalCents + taxAmountCents;
  }
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = sql`(datetime('now'))`;
    await db.update(schema.invoices).set(updates).where(eq(schema.invoices.id, idNum));
  }
  return c.json({ ok: true }, 200);
});

const deleteInvoice = createRoute({
  method: "delete",
  path: "/api/invoices/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteInvoice, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.invoices).where(eq(schema.invoices.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Payments ───────────────────────────────────────────────────────
// Lives under /api/invoices/{id}/payments, so it's already covered by the
// blanket technician role-gate's `path.startsWith("/api/invoices")` check
// above (confirmed by reading that check directly, not assumed) -- no
// separate block needed here, same as how /api/jobs/{id}/invoice piggybacks
// on the same prefix check via its own regex.

function paymentOut(row: typeof schema.payments.$inferSelect) {
  return {
    id: row.id,
    invoice_id: row.invoiceId,
    method: row.method,
    amount: fromCents(row.amount),
    surcharge_amount: fromCentsNullable(row.surchargeAmount),
    processor_ref: row.processorRef,
    status: row.status,
    paid_at: row.paidAt,
    created_at: row.createdAt ?? "",
  };
}

const PAYMENT_METHODS = ["cash", "check", "card", "financing"] as const;

const listPayments = createRoute({
  method: "get",
  path: "/api/invoices/{id}/payments",
  request: { params: IdParam },
  responses: {
    200: { description: "Payments for an invoice", content: { "application/json": { schema: z.object({ payments: z.array(PaymentSchema) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listPayments, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const invoice = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.id, idNum)).get();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  const rows = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, idNum)).orderBy(desc(schema.payments.id)).all();
  return c.json({ payments: rows.map(paymentOut) }, 200);
});

const recordPayment = createRoute({
  method: "post",
  path: "/api/invoices/{id}/payments",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      method: z.enum(PAYMENT_METHODS),
      // An explicit amount (partial/manual payment) must be strictly positive.
      // Omit it to auto-compute the tier amount for the remaining balance.
      amount: zPositive.optional(),
    }) } } },
  },
  responses: {
    201: { description: "Payment recorded", content: { "application/json": { schema: z.object({ payment: PaymentSchema, invoice_status: z.string() }) } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(recordPayment, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const data = c.req.valid("json");
  const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, idNum)).get();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);

  // Everything below runs in CENTS (integer, exact) -- invoice.total and the
  // prior payments' amount/surchargeAmount are raw DB reads (already cents),
  // and data.amount (if provided) is the one DOLLARS value here, converted to
  // cents immediately via toCents(). No float epsilon is needed anymore for
  // the over-collection guard (unlike the old dollars-space version) because
  // integer cents comparisons are exact.
  const invoiceTotalCents = invoice.total || 0;

  // Track remaining balance in RAW (pre-discount/surcharge) cents so multiple
  // payments against one invoice never over-collect. For any payment row,
  // (amount - surchargeAmount) always equals the raw-cents slice of
  // invoiceTotalCents that payment cleared -- true by construction for auto/
  // tier payments (see below) and true by definition for manual ones
  // (surchargeAmount is always 0 for those, so amount IS the raw slice).
  const priorPayments = await db.select({ amount: schema.payments.amount, surchargeAmount: schema.payments.surchargeAmount })
    .from(schema.payments).where(and(eq(schema.payments.invoiceId, idNum), eq(schema.payments.status, "paid"))).all();
  const priorRawCreditCents = priorPayments.reduce((sum, p) => sum + ((p.amount || 0) - (p.surchargeAmount || 0)), 0);
  const remainingRawCents = Math.max(0, invoiceTotalCents - priorRawCreditCents);

  // Reject over-collection at the API. The raw balance owed is
  // remainingRawCents (invoice total minus prior raw credit). A manual amount
  // that exceeds it -- or any payment against an already-fully-paid invoice --
  // is rejected with a 400 that states the max allowed.
  if (remainingRawCents <= 0) {
    return c.json({ error: "This invoice is already paid in full." }, 400);
  }
  const dataAmountCents = data.amount !== undefined ? toCents(data.amount) : undefined;
  if (dataAmountCents !== undefined && dataAmountCents > remainingRawCents) {
    return c.json({ error: `Payment exceeds the balance owed. Maximum allowed is ${fromCents(remainingRawCents).toFixed(2)}.` }, 400);
  }

  // amount defaults to the tier-computed amount for what's actually still
  // owed (not the full invoice total) -- so a second auto payment after a
  // partial one only charges the remainder, never re-charges the full tier
  // amount again. An explicit amount (e.g. a partial payment, or an office
  // override) is taken as-is without re-deriving a surcharge from it --
  // surcharge_amount only reflects the tier math, so a manually-entered
  // amount is recorded with surcharge_amount 0 rather than a misleading
  // inferred figure.
  let amountCents: number;
  let surchargeAmountCents: number;
  if (dataAmountCents !== undefined) {
    amountCents = dataAmountCents;
    surchargeAmountCents = 0;
  } else {
    const computed = computePaymentAmount(remainingRawCents, data.method);
    amountCents = computed.amountCents;
    surchargeAmountCents = computed.surchargeAmountCents;
  }

  await db.insert(schema.payments).values({
    invoiceId: idNum,
    method: data.method,
    amount: amountCents,
    surchargeAmount: surchargeAmountCents,
    // No real processor integration yet (Phase 5 Stripe work) -- cash/
    // check/card/financing are all recorded as immediately "paid" with no
    // processor_ref, matching the build plan's note that this app doesn't
    // integrate a real processor yet.
    status: "paid",
    paidAt: sql`(datetime('now'))`,
  });
  const payment = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, idNum)).orderBy(desc(schema.payments.id)).limit(1).get();

  // This payment's own raw credit (auto payments are computed to exactly
  // clear remainingRawCents, so they always zero it out in one shot; manual
  // payments only clear as much raw balance as their cents amount).
  const thisRawCreditCents = amountCents - surchargeAmountCents;
  const totalRawCreditCents = priorRawCreditCents + thisRawCreditCents;
  // Flip to "paid" (the same 4-value status enum already used elsewhere in
  // this file -- draft/sent/paid/overdue/cancelled -- no new "partial"
  // status invented) once accumulated raw credit covers the invoice total.
  // Exact integer-cents comparison -- no epsilon needed.
  let invoiceStatus = invoice.status;
  if (totalRawCreditCents >= invoiceTotalCents) {
    invoiceStatus = "paid";
    await db.update(schema.invoices).set({ status: "paid", paidDate: todayInTampa(), updatedAt: sql`(datetime('now'))` }).where(eq(schema.invoices.id, idNum));
  }

  return c.json({ payment: paymentOut(payment!), invoice_status: invoiceStatus }, 201);
});

// ── Create invoice from job ────────────────────────────────────────

const invoiceFromJob = createRoute({
  method: "post",
  path: "/api/jobs/{id}/invoice",
  request: { params: IdParam },
  responses: {
    201: { description: "Invoice created from job", content: { "application/json": { schema: OkInvoiceIdSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(invoiceFromJob, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db
    .select({
      id: schema.jobs.id,
      customer_id: schema.jobs.customerId,
      price: schema.jobs.price,
      brand_id: schema.jobs.brandId,
      service_type_name: schema.serviceTypes.name,
    })
    .from(schema.jobs)
    .leftJoin(schema.serviceTypes, eq(schema.jobs.serviceTypeId, schema.serviceTypes.id))
    .where(eq(schema.jobs.id, idNum))
    .get();
  if (!job) return c.json({ error: "Job not found" }, 404);

  const identifier = await nextInvoiceIdentifier(db);
  // NOTE: job.price and m.unit_cost below are raw, UNCONVERTED cents reads
  // (this route never calls fromCents on them) -- that's correct here, not a
  // missed boundary: this whole block computes subtotal/unit_price/total in
  // cents-space and writes them straight into the (now-cents) invoices/
  // invoice_lines columns below. The route's only JSON response is
  // { ok, invoice_id } -- no money value is ever returned to the client, so
  // there is no dollars boundary to cross here.
  const price = job.price;

  // Gather materials used
  const mats = await db
    .select({
      id: schema.jobMaterials.id,
      job_id: schema.jobMaterials.jobId,
      material_id: schema.jobMaterials.materialId,
      quantity: schema.jobMaterials.quantity,
      unit_cost: schema.jobMaterials.unitCost,
      material_name: schema.materials.name,
    })
    .from(schema.jobMaterials)
    .leftJoin(schema.materials, eq(schema.jobMaterials.materialId, schema.materials.id))
    .where(eq(schema.jobMaterials.jobId, idNum))
    .all();

  let subtotal = price;
  const lines: { description: string; quantity: number; unit_price: number; total: number }[] = [
    { description: job.service_type_name || "Service", quantity: 1, unit_price: price, total: price },
  ];
  for (const m of mats) {
    const lineTotal = m.quantity * m.unit_cost;
    lines.push({
      description: m.material_name as string,
      quantity: m.quantity,
      unit_price: m.unit_cost,
      total: lineTotal,
    });
    subtotal += lineTotal;
  }

  await db.insert(schema.invoices).values({
    identifier,
    customerId: job.customer_id,
    jobId: job.id,
    status: "draft",
    subtotal,
    taxRate: 0,
    taxAmount: 0,
    total: subtotal,
    notes: "",
    dueDate: "",
    brandId: job.brand_id ?? null,
  });

  const inv = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.identifier, identifier)).get();
  for (const line of lines) {
    await db.insert(schema.invoiceLines).values({
      invoiceId: inv!.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      total: line.total,
    });
  }

  return c.json({ ok: true, invoice_id: inv!.id }, 201);
});

// ── Progress billing (additional invoices on a job) ────────────────
// A job may already have one or more invoices (the initial invoiceFromJob
// above, a deposit invoice from convertEstimate, prior progress invoices) --
// this route adds ANOTHER one for a progress payment, reusing
// createInvoiceWithLines rather than duplicating the total-computation
// logic. Accepts either a single { description, amount, tax_rate } shape or
// a full lines array (matching the existing invoice-lines shape) so the
// caller can bill either a lump-sum progress payment or an itemized one.

// GET a job's full invoice history (every invoice with job_id = this job,
// not just the most recent) -- lets job-detail.tsx show deposit + final +
// any progress invoices together instead of just one.
const listJobInvoices = createRoute({
  method: "get",
  path: "/api/jobs/{id}/invoices",
  request: { params: IdParam },
  responses: {
    200: { description: "Invoices for a job", content: { "application/json": { schema: z.object({ invoices: z.array(InvoiceSchema) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listJobInvoices, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, idNum)).get();
  if (!job) return c.json({ error: "Job not found" }, 404);
  const rows = await db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      customer_id: schema.invoices.customerId,
      job_id: schema.invoices.jobId,
      status: schema.invoices.status,
      subtotal: schema.invoices.subtotal,
      tax_rate: schema.invoices.taxRate,
      tax_amount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      due_date: schema.invoices.dueDate,
      paid_date: schema.invoices.paidDate,
      created_at: schema.invoices.createdAt,
      updated_at: schema.invoices.updatedAt,
      brand_id: schema.invoices.brandId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.jobId, idNum))
    .orderBy(asc(schema.invoices.createdAt))
    .all();
  return c.json({ invoices: rows.map(invoiceMoneyOut) }, 200);
});

const jobProgressInvoice = createRoute({
  method: "post",
  path: "/api/jobs/{id}/invoices",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.union([
      z.object({
        description: zName,
        // zPositive (not zMoney) -- a $0 progress invoice is pointless
        // invoice-history clutter, not a legitimate zero-value bill.
        amount: zPositive,
        tax_rate: zTaxRate.optional(),
        due_date: zDate.optional(),
      }),
      z.object({
        lines: z.array(invoiceLineInput).min(1, { message: "An invoice must have at least one line item" }),
        tax_rate: zTaxRate.optional(),
        due_date: zDate.optional(),
      }),
    ]) } } },
  },
  responses: {
    201: { description: "Progress invoice created", content: { "application/json": { schema: InvoiceSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(jobProgressInvoice, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db.select({ id: schema.jobs.id, customerId: schema.jobs.customerId, brandId: schema.jobs.brandId }).from(schema.jobs).where(eq(schema.jobs.id, idNum)).get();
  if (!job) return c.json({ error: "Job not found" }, 404);

  const data = c.req.valid("json");
  const lines = "lines" in data ? data.lines : [{ description: data.description, quantity: 1, unit_price: data.amount }];

  const invoiceId = await createInvoiceWithLines(db, {
    customerId: job.customerId,
    jobId: job.id,
    taxRate: data.tax_rate || 0,
    notes: "",
    dueDate: data.due_date || "",
    brandId: job.brandId ?? null,
    lines,
  });
  const result = await getInvoiceJoinedById(db, invoiceId);
  return c.json(invoiceMoneyOut(result!), 201);
});

// ── Invoice line management ────────────────────────────────────────
// Mirrors the estimate line routes (add/delete + recompute). Technicians are
// already 403'd on the whole /api/invoices family by the blanket role-gate,
// so no per-route role check is needed here.

const addInvoiceLine = createRoute({
  method: "post",
  path: "/api/invoices/{id}/lines",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      description: zName,
      quantity: zPositive,
      unit_price: zMoney,
    }) } } },
  },
  responses: {
    201: { description: "Line added", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addInvoiceLine, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const invoice = await db.select({ id: schema.invoices.id, status: schema.invoices.status }).from(schema.invoices).where(eq(schema.invoices.id, idNum)).get();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    return c.json({ error: `Cannot add a line to a ${invoice.status} invoice.` }, 409);
  }
  const data = c.req.valid("json");
  // data.unit_price is DOLLARS (client input) -- convert to cents before the
  // line-total multiplication so both unit_price and total are stored as
  // exact integer cents.
  const unitPriceCents = toCents(data.unit_price);
  const lineTotalCents = Math.round(data.quantity * unitPriceCents);
  await db.insert(schema.invoiceLines).values({
    invoiceId: idNum,
    description: data.description,
    quantity: data.quantity,
    unitPrice: unitPriceCents,
    total: lineTotalCents,
  });
  await recomputeInvoiceTotals(db, idNum);
  return c.json({ ok: true }, 201);
});

const deleteInvoiceLine = createRoute({
  method: "delete",
  path: "/api/invoice-lines/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "Locked invoice", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteInvoiceLine, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const line = await db.select({ invoiceId: schema.invoiceLines.invoiceId }).from(schema.invoiceLines).where(eq(schema.invoiceLines.id, idNum)).get();
  if (line) {
    const inv = await db.select({ status: schema.invoices.status }).from(schema.invoices).where(eq(schema.invoices.id, line.invoiceId)).get();
    if (inv && (inv.status === "paid" || inv.status === "cancelled")) {
      return c.json({ error: `Cannot remove a line from a ${inv.status} invoice.` }, 409);
    }
  }
  await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.id, idNum));
  if (line) {
    await recomputeInvoiceTotals(db, line.invoiceId);
  }
  return c.json({ ok: true }, 200);
});

// ── Estimates ──────────────────────────────────────────────────────
// Sales/estimating task: admin, office, and estimator all get full access.
// Technicians are blocked entirely by the blanket role-gate middleware
// above (mirrors the /api/invoices block).

// Shared "estimate with joined denormalized fields" select shape, matching
// the invoices join pattern (customer_name + brand_*).
function estimateJoinedSelect(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: schema.estimates.id,
      identifier: schema.estimates.identifier,
      customer_id: schema.estimates.customerId,
      brand_id: schema.estimates.brandId,
      status: schema.estimates.status,
      subtotal: schema.estimates.subtotal,
      tax_rate: schema.estimates.taxRate,
      tax_amount: schema.estimates.taxAmount,
      total: schema.estimates.total,
      valid_until: schema.estimates.validUntil,
      notes: schema.estimates.notes,
      approved_at: schema.estimates.approvedAt,
      // Customer-facing loop fields, so estimate-detail can show/copy the
      // public link and surface who signed + when.
      public_token: schema.estimates.publicToken,
      signed_name: schema.estimates.signedName,
      signed_at: schema.estimates.signedAt,
      deposit_amount: schema.estimates.depositAmount,
      created_at: schema.estimates.createdAt,
      customer_name: schema.customers.name,
      brand_name: schema.brands.name,
      brand_color_primary: schema.brands.colorPrimary,
      brand_color_secondary: schema.brands.colorSecondary,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.estimates.brandId, schema.brands.id));
}
// Boundary conversion for an estimateJoinedSelect() row: subtotal/tax_amount/
// total/deposit_amount cents -> dollars. deposit_amount is nullable, so it
// uses fromCentsNullable (must stay null, not become 0).
function estimateJoinedSelectOutOne<T extends { subtotal: number | null; tax_amount: number | null; total: number | null; deposit_amount: number | null }>(row: T): T {
  return {
    ...row,
    subtotal: fromCentsNullable(row.subtotal),
    tax_amount: fromCentsNullable(row.tax_amount),
    total: fromCentsNullable(row.total),
    deposit_amount: fromCentsNullable(row.deposit_amount),
  };
}
function estimateJoinedSelectOut<T extends { subtotal: number | null; tax_amount: number | null; total: number | null; deposit_amount: number | null }>(rows: T[]): T[] {
  return rows.map(estimateJoinedSelectOutOne);
}

const listEstimates = createRoute({
  method: "get",
  path: "/api/estimates",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      brand_id: zBrandIdQuery,
    }),
  },
  responses: {
    200: {
      description: "Paginated estimate list",
      content: { "application/json": { schema: z.object({ estimates: z.array(EstimateSchema), total: z.number().int() }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listEstimates, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const conditions = [];
  const brandRes = await resolveBrandFilter(db, q.brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  if (brandFilter !== null) {
    conditions.push(eq(schema.estimates.brandId, brandFilter));
  }
  if (q.status) {
    conditions.push(eq(schema.estimates.status, q.status));
  }
  if (q.search) {
    conditions.push(or(
      likeEscaped(schema.estimates.identifier, q.search),
      likeEscaped(schema.customers.name, q.search),
    ));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .where(where)
    .get();

  const estimates = await estimateJoinedSelect(db)
    .where(where)
    .orderBy(desc(schema.estimates.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ estimates: estimateJoinedSelectOut(estimates), total: countRow?.count || 0 }, 200);
});

// Boundary conversion for an estimate_lines row: unit_price/total cents -> dollars.
function estimateLineOut(l: typeof schema.estimateLines.$inferSelect) {
  return {
    id: l.id,
    estimate_id: l.estimateId,
    description: l.description,
    quantity: l.quantity,
    unit_price: fromCentsNullable(l.unitPrice),
    total: fromCentsNullable(l.total),
  };
}

const getEstimate = createRoute({
  method: "get",
  path: "/api/estimates/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Estimate detail", content: { "application/json": { schema: z.object({ estimate: EstimateDetailSchema }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await estimateJoinedSelect(db).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  const lines = await db
    .select()
    .from(schema.estimateLines)
    .where(eq(schema.estimateLines.estimateId, idNum))
    .orderBy(asc(schema.estimateLines.id))
    .all();
  const linesOut = lines.map(estimateLineOut);
  return c.json({ estimate: { ...estimateJoinedSelectOutOne(estimate), lines: linesOut } }, 200);
});

const createEstimate = createRoute({
  method: "post",
  path: "/api/estimates",
  request: {
    body: { content: { "application/json": { schema: z.object({
      customer_id: z.number().int(),
      brand_id: z.number().int().nullable().optional(),
      tax_rate: zTaxRate.optional(),
      valid_until: zDate.optional(),
      notes: z.string().optional(),
      // At least one line item required on create.
      lines: z.array(z.object({
        description: zName,
        quantity: zPositive,
        unit_price: zMoney,
      })).min(1, { message: "An estimate must have at least one line item" }),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: EstimateSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createEstimate, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  // Multi-account default: omitted brand_id inherits the customer's account
  // (explicit null stays null) -- same rule as createJob/createInvoice.
  let brandId: number | null = data.brand_id ?? null;
  if (data.brand_id === undefined) {
    const custBrand = await db.select({ brandId: schema.customers.brandId }).from(schema.customers).where(eq(schema.customers.id, data.customer_id)).get();
    brandId = custBrand?.brandId ?? null;
  }
  const identifier = await nextEstimateIdentifier(db);
  const taxRate = data.tax_rate || 0;

  // data.lines[].unit_price is DOLLARS (client input) -- convert to cents up
  // front, then every sum/multiply below is exact integer-cents math.
  const lineTotalsCents = data.lines.map((line) => Math.round(line.quantity * toCents(line.unit_price)));
  const subtotalCents = lineTotalsCents.reduce((sum, t) => sum + t, 0);
  const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
  const totalCents = subtotalCents + taxAmountCents;

  await db.insert(schema.estimates).values({
    identifier,
    customerId: data.customer_id,
    brandId,
    status: "draft",
    subtotal: subtotalCents,
    taxRate,
    taxAmount: taxAmountCents,
    total: totalCents,
    validUntil: data.valid_until || null,
    notes: data.notes || "",
  });

  const estimate = await db.select({ id: schema.estimates.id }).from(schema.estimates).where(eq(schema.estimates.identifier, identifier)).get();
  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    await db.insert(schema.estimateLines).values({
      estimateId: estimate!.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: toCents(line.unit_price),
      total: lineTotalsCents[i],
    });
  }

  const result = await estimateJoinedSelect(db).where(eq(schema.estimates.id, estimate!.id)).get();
  return c.json(estimateJoinedSelectOutOne(result!), 201);
});

const updateEstimate = createRoute({
  method: "put",
  path: "/api/estimates/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      // Deliberately no "status" field here -- status changes must go
      // through /send, /approve, /decline, /convert, each of which enforces
      // its own transition rule. A generic status write here would let a
      // caller skip straight to "approved" (or resurrect a declined/
      // converted estimate) with none of those checks.
      notes: z.string().optional(),
      // "" clears the date; any non-empty value must be a real calendar date.
      valid_until: z.union([z.literal(""), zDate]).optional(),
      tax_rate: zTaxRate.optional(),
      brand_id: z.number().int().nullable().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const data = c.req.valid("json");
  const existing = await db.select().from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!existing) return c.json({ error: "Estimate not found" }, 404);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);

  const updates: Record<string, unknown> = {};
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.valid_until !== undefined) updates.validUntil = data.valid_until;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  // Recompute tax_amount/total if tax_rate changes -- subtotal stays
  // derived from lines (this route never touches lines directly), so it's
  // safe to reuse the existing subtotal (already raw cents from the DB) in
  // the recompute. Math.round keeps the result an exact integer-cents value.
  if (data.tax_rate !== undefined) {
    const subtotalCents = existing.subtotal || 0;
    const taxAmountCents = Math.round(subtotalCents * (data.tax_rate / 100));
    updates.taxRate = data.tax_rate;
    updates.taxAmount = taxAmountCents;
    updates.total = subtotalCents + taxAmountCents;
  }
  if (Object.keys(updates).length > 0) {
    await db.update(schema.estimates).set(updates).where(eq(schema.estimates.id, idNum));
  }
  return c.json({ ok: true }, 200);
});

const deleteEstimate = createRoute({
  method: "delete",
  path: "/api/estimates/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  // estimate_lines.estimate_id has no ON DELETE CASCADE at the DB level
  // (unlike invoice_lines/job_notes/etc), so the FK constraint would reject
  // deleting an estimate that still has lines -- clear the children first.
  await db.delete(schema.estimateLines).where(eq(schema.estimateLines.estimateId, idNum));
  await db.delete(schema.estimates).where(eq(schema.estimates.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Estimate status transitions ───────────────────────────────────

// Builds the absolute base URL (scheme+host) for the current request, so the
// public customer link/email and Stripe redirect URLs point at the same origin
// the app is actually being served from (localhost in dev, the real domain in
// prod) rather than a hard-coded host.
function requestBaseUrl(c: Context<AppBindings>): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

const sendEstimate = createRoute({
  method: "post",
  path: "/api/estimates/{id}/send",
  request: { params: IdParam },
  responses: {
    200: { description: "Sent", content: { "application/json": { schema: z.object({ ok: z.boolean(), public_token: z.string(), public_url: z.string(), email_sent: z.boolean(), email_reason: z.string().optional() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(sendEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db
    .select({
      status: schema.estimates.status,
      publicToken: schema.estimates.publicToken,
      identifier: schema.estimates.identifier,
      customerId: schema.estimates.customerId,
      brandId: schema.estimates.brandId,
    })
    .from(schema.estimates)
    .where(eq(schema.estimates.id, idNum))
    .get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot send an estimate with status "${estimate.status}" -- only draft estimates can be sent` }, 409);
  }

  // Mint an unguessable public token if the estimate doesn't already have one
  // (a re-send keeps the same link). crypto.randomUUID() is available in the
  // Workers runtime.
  const token = estimate.publicToken || crypto.randomUUID();
  await db.update(schema.estimates).set({ status: "sent", publicToken: token }).where(eq(schema.estimates.id, idNum));

  const publicUrl = `${requestBaseUrl(c)}/p/e/${token}`;

  // GATED: try to email the customer their estimate link. When RESEND_API_KEY
  // (+ RESEND_FROM) is set AND the customer has an email, this actually sends;
  // otherwise sendEmail returns { sent:false, reason } and the estimate is
  // still marked sent (the link is always copyable from the UI).
  const customer = await db
    .select({ name: schema.customers.name, email: schema.customers.email })
    .from(schema.customers)
    .where(eq(schema.customers.id, estimate.customerId))
    .get();
  let brandName = "Noble Tampa";
  if (estimate.brandId) {
    const b = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, estimate.brandId)).get();
    if (b?.name) brandName = b.name;
  }
  const emailResult = await sendEmail(c.env, {
    to: customer?.email || "",
    subject: `Your estimate from ${brandName}`,
    html:
      `<div style="font-family:Georgia,serif;color:#1a2b4a">` +
      `<p>Hi ${escapeHtml(customer?.name || "there")},</p>` +
      `<p>Your estimate <strong>${escapeHtml(estimate.identifier || "")}</strong> from ${escapeHtml(brandName)} is ready to review.</p>` +
      `<p><a href="${publicUrl}" style="display:inline-block;padding:10px 18px;background:#1a2b4a;color:#fff;text-decoration:none;border-radius:6px">Review &amp; Approve Your Estimate</a></p>` +
      `<p style="font-size:13px;color:#5a6478">Or paste this link into your browser:<br>${publicUrl}</p>` +
      `<p style="font-size:13px;color:#5a6478">Thank you,<br>${escapeHtml(brandName)} — Tampa, FL</p>` +
      `</div>`,
    text: `Your estimate ${estimate.identifier || ""} from ${brandName} is ready. Review and approve it here: ${publicUrl}`,
  });

  return c.json(
    { ok: true, public_token: token, public_url: publicUrl, email_sent: emailResult.sent, email_reason: emailResult.reason },
    200,
  );
});

const approveEstimate = createRoute({
  method: "post",
  path: "/api/estimates/{id}/approve",
  request: { params: IdParam },
  responses: {
    200: { description: "Approved", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(approveEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  // "sent" is the normal path, but a paper-signed estimate (customer signs
  // in person before the office ever formally "sends" it) can go straight
  // from draft -> approved, so both are accepted here.
  if (estimate.status !== "sent" && estimate.status !== "draft") {
    return c.json({ error: `Cannot approve an estimate with status "${estimate.status}" -- only draft or sent estimates can be approved` }, 409);
  }
  await db.update(schema.estimates).set({ status: "approved", approvedAt: sql`(datetime('now'))` }).where(eq(schema.estimates.id, idNum));
  return c.json({ ok: true }, 200);
});

const declineEstimate = createRoute({
  method: "post",
  path: "/api/estimates/{id}/decline",
  request: { params: IdParam },
  responses: {
    200: { description: "Declined", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(declineEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  // Same source states as approve -- an already-approved (customer signed
  // off) or already-converted (real job/invoice exist) estimate can't be
  // silently declined after the fact.
  if (estimate.status !== "draft" && estimate.status !== "sent") {
    return c.json({ error: `Cannot decline an estimate with status "${estimate.status}" -- only draft or sent estimates can be declined` }, 409);
  }
  await db.update(schema.estimates).set({ status: "declined" }).where(eq(schema.estimates.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Estimate line management ───────────────────────────────────────

// Recomputes and persists an estimate's subtotal/tax_amount/total from its
// current set of estimate_lines rows. Called after any line add/remove so
// the parent estimate's totals never drift from its line items.
// All money here (lines' total, estimates.subtotal/tax_amount/total) is raw
// cents straight from/to the DB -- no toCents/fromCents needed, only
// Math.round at the tax multiplication (exact integer-cents math).
async function recomputeEstimateTotals(db: ReturnType<typeof getDb>, estimateId: number) {
  const lines = await db.select({ total: schema.estimateLines.total }).from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, estimateId)).all();
  const subtotalCents = lines.reduce((sum, l) => sum + (l.total || 0), 0);
  const estimate = await db.select({ taxRate: schema.estimates.taxRate }).from(schema.estimates).where(eq(schema.estimates.id, estimateId)).get();
  const taxRate = estimate?.taxRate || 0;
  const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
  const totalCents = subtotalCents + taxAmountCents;
  await db.update(schema.estimates).set({ subtotal: subtotalCents, taxAmount: taxAmountCents, total: totalCents }).where(eq(schema.estimates.id, estimateId));
}

const addEstimateLine = createRoute({
  method: "post",
  path: "/api/estimates/{id}/lines",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      description: zName,
      quantity: zPositive,
      unit_price: zMoney,
    }) } } },
  },
  responses: {
    201: { description: "Line added", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addEstimateLine, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ id: schema.estimates.id }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  const data = c.req.valid("json");
  // data.unit_price is DOLLARS (client input) -- convert to cents before the
  // line-total multiplication.
  const unitPriceCents = toCents(data.unit_price);
  const lineTotalCents = Math.round(data.quantity * unitPriceCents);
  await db.insert(schema.estimateLines).values({
    estimateId: idNum,
    description: data.description,
    quantity: data.quantity,
    unitPrice: unitPriceCents,
    total: lineTotalCents,
  });
  await recomputeEstimateTotals(db, idNum);
  return c.json({ ok: true }, 201);
});

const deleteEstimateLine = createRoute({
  method: "delete",
  path: "/api/estimate-lines/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteEstimateLine, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const line = await db.select({ estimateId: schema.estimateLines.estimateId }).from(schema.estimateLines).where(eq(schema.estimateLines.id, idNum)).get();
  await db.delete(schema.estimateLines).where(eq(schema.estimateLines.id, idNum));
  if (line) {
    await recomputeEstimateTotals(db, line.estimateId);
  }
  return c.json({ ok: true }, 200);
});

// ── Structured estimate builder (rooms -> surfaces) ────────────────
// Optional, additive layer on top of the plain estimate_lines model: an
// estimate can still use flat lines directly (the ~10 seeded estimates keep
// their existing lines untouched -- nothing here ever runs against an
// estimate that has no rooms). Only editable while the parent estimate is
// 'draft', mirroring the existing edit-lock pattern used for paid/cancelled
// invoices elsewhere in this file. Every mutation here auto-syncs a matching
// estimate_lines row so the existing subtotal/tax/total, PDF, and convert
// pipelines keep working unmodified.

// Builds the human-readable generated-line description for a surface, e.g.
// "Living Room -- Walls (2 coats, Sherwin Williams Duration)".
function surfaceLineDescription(roomName: string, surfaceType: string, coats: number, paintProduct: string | null | undefined): string {
  const coatsPart = `${coats} coat${coats === 1 ? "" : "s"}`;
  const productPart = paintProduct && paintProduct.trim() ? `, ${paintProduct.trim()}` : "";
  return `${roomName} -- ${surfaceType} (${coatsPart}${productPart})`;
}

// Inserts/updates/removes the single estimate_lines row generated from a
// surface, keeping estimate_surfaces.generated_line_id pointed at it, then
// recomputes the parent estimate's totals. Called after every surface
// create/update/delete so estimate_lines never drifts from the builder.
// Deliberately does everything needed for one surface in one place so every
// call site (create/update/delete surface, delete room) stays a single call.
// surface.laborCost/materialCost are raw cents (straight from a Drizzle row,
// never converted) -- this function stays entirely in cents-space, writing
// the summed total straight into the (cents) estimate_lines.unitPrice/total
// columns. No toCents/fromCents needed here.
async function syncEstimateLineForSurface(
  db: ReturnType<typeof getDb>,
  estimateId: number,
  roomName: string,
  surface: { id: number; surfaceType: string; coats: number; paintProduct: string | null; laborCost: number; materialCost: number; generatedLineId: number | null },
): Promise<void> {
  const description = surfaceLineDescription(roomName, surface.surfaceType, surface.coats, surface.paintProduct);
  const total = (surface.laborCost || 0) + (surface.materialCost || 0);
  if (surface.generatedLineId) {
    const existingLine = await db.select({ id: schema.estimateLines.id }).from(schema.estimateLines).where(eq(schema.estimateLines.id, surface.generatedLineId)).get();
    if (existingLine) {
      await db.update(schema.estimateLines).set({ description, quantity: 1, unitPrice: total, total }).where(eq(schema.estimateLines.id, surface.generatedLineId));
      return;
    }
  }
  await db.insert(schema.estimateLines).values({ estimateId, description, quantity: 1, unitPrice: total, total });
  const inserted = await db.select({ id: schema.estimateLines.id }).from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, estimateId)).orderBy(desc(schema.estimateLines.id)).limit(1).get();
  await db.update(schema.estimateSurfaces).set({ generatedLineId: inserted!.id }).where(eq(schema.estimateSurfaces.id, surface.id));
}

// Removes a surface's generated estimate_lines row (used when the surface or
// its parent room is deleted).
async function removeGeneratedLine(db: ReturnType<typeof getDb>, generatedLineId: number | null): Promise<void> {
  if (!generatedLineId) return;
  await db.delete(schema.estimateLines).where(eq(schema.estimateLines.id, generatedLineId));
}

function estimateSurfaceOut(row: typeof schema.estimateSurfaces.$inferSelect) {
  return {
    id: row.id,
    room_id: row.roomId,
    surface_type: row.surfaceType,
    measurement: row.measurement,
    prep_notes: row.prepNotes,
    coats: row.coats,
    paint_product: row.paintProduct,
    labor_cost: fromCents(row.laborCost),
    material_cost: fromCents(row.materialCost),
    sort_order: row.sortOrder,
    generated_line_id: row.generatedLineId,
  };
}

function estimateRoomOut(row: typeof schema.estimateRooms.$inferSelect) {
  return { id: row.id, estimate_id: row.estimateId, name: row.name, sort_order: row.sortOrder };
}

// GET /api/estimates/{id}/rooms -- rooms with their nested surfaces. Viewable
// regardless of estimate status (read-only once frozen); only the write
// routes below enforce the draft-only edit lock.
const listEstimateRooms = createRoute({
  method: "get",
  path: "/api/estimates/{id}/rooms",
  request: { params: IdParam },
  responses: {
    200: { description: "Rooms with surfaces", content: { "application/json": { schema: z.object({ rooms: z.array(EstimateRoomSchema) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listEstimateRooms, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ id: schema.estimates.id }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  const rooms = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.estimateId, idNum)).orderBy(asc(schema.estimateRooms.sortOrder), asc(schema.estimateRooms.id)).all();
  const surfaces = await db
    .select()
    .from(schema.estimateSurfaces)
    .innerJoin(schema.estimateRooms, eq(schema.estimateSurfaces.roomId, schema.estimateRooms.id))
    .where(eq(schema.estimateRooms.estimateId, idNum))
    .orderBy(asc(schema.estimateSurfaces.sortOrder), asc(schema.estimateSurfaces.id))
    .all();
  const byRoom = new Map<number, ReturnType<typeof estimateSurfaceOut>[]>();
  for (const row of surfaces) {
    const s = row.estimate_surfaces;
    const list = byRoom.get(s.roomId) || [];
    list.push(estimateSurfaceOut(s));
    byRoom.set(s.roomId, list);
  }
  const roomsOut = rooms.map((r) => ({ ...estimateRoomOut(r), surfaces: byRoom.get(r.id) || [] }));
  return c.json({ rooms: roomsOut }, 200);
});

const addEstimateRoom = createRoute({
  method: "post",
  path: "/api/estimates/{id}/rooms",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ name: zName, sort_order: z.number().int().optional() }) } } },
  },
  responses: {
    201: { description: "Room created", content: { "application/json": { schema: EstimateRoomSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addEstimateRoom, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ id: schema.estimates.id, status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  const data = c.req.valid("json");
  await db.insert(schema.estimateRooms).values({ estimateId: idNum, name: data.name, sortOrder: data.sort_order ?? 0 });
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.estimateId, idNum)).orderBy(desc(schema.estimateRooms.id)).limit(1).get();
  return c.json(estimateRoomOut(room!), 201);
});

const updateEstimateRoom = createRoute({
  method: "put",
  path: "/api/estimate-rooms/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ name: zName.optional(), sort_order: z.number().int().optional() }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateEstimateRoom, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.id, idNum)).get();
  if (!room) return c.json({ error: "Room not found" }, 404);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, room.estimateId)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.sort_order !== undefined) updates.sortOrder = data.sort_order;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.estimateRooms).set(updates).where(eq(schema.estimateRooms.id, idNum));
  }
  // Renaming a room changes every surface's generated line description
  // (the room name is baked into it) -- re-sync all of them so the lines
  // stay accurate.
  if (data.name !== undefined) {
    const surfaces = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.roomId, idNum)).all();
    for (const s of surfaces) {
      await syncEstimateLineForSurface(db, room.estimateId, data.name, {
        id: s.id, surfaceType: s.surfaceType, coats: s.coats, paintProduct: s.paintProduct,
        laborCost: s.laborCost, materialCost: s.materialCost, generatedLineId: s.generatedLineId,
      });
    }
    await recomputeEstimateTotals(db, room.estimateId);
  }
  return c.json({ ok: true }, 200);
});

const deleteEstimateRoom = createRoute({
  method: "delete",
  path: "/api/estimate-rooms/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteEstimateRoom, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.id, idNum)).get();
  if (!room) return c.json({ error: "Room not found" }, 404);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, room.estimateId)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  // Remove every surface's generated line before the cascade delete removes
  // the surfaces themselves (estimate_surfaces has ON DELETE CASCADE off
  // estimate_rooms, but estimate_lines has no FK back to estimate_surfaces,
  // so those generated lines would otherwise be orphaned).
  const surfaces = await db.select({ generatedLineId: schema.estimateSurfaces.generatedLineId }).from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.roomId, idNum)).all();
  for (const s of surfaces) {
    await removeGeneratedLine(db, s.generatedLineId);
  }
  await db.delete(schema.estimateRooms).where(eq(schema.estimateRooms.id, idNum));
  await recomputeEstimateTotals(db, room.estimateId);
  return c.json({ ok: true }, 200);
});

const addEstimateSurface = createRoute({
  method: "post",
  path: "/api/estimate-rooms/{id}/surfaces",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      surface_type: zName,
      measurement: zMoney.optional(),
      prep_notes: z.string().optional(),
      coats: z.number().int().positive().optional(),
      paint_product: z.string().optional(),
      labor_cost: zMoney.optional(),
      material_cost: zMoney.optional(),
      sort_order: z.number().int().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Surface created", content: { "application/json": { schema: EstimateSurfaceSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addEstimateSurface, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.id, idNum)).get();
  if (!room) return c.json({ error: "Room not found" }, 404);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, room.estimateId)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  const data = c.req.valid("json");
  await db.insert(schema.estimateSurfaces).values({
    roomId: idNum,
    surfaceType: data.surface_type,
    // measurement is sqft/linear ft, NOT money -- stays as-is.
    measurement: data.measurement ?? 0,
    prepNotes: data.prep_notes || null,
    coats: data.coats ?? 2,
    paintProduct: data.paint_product || null,
    laborCost: toCents(data.labor_cost ?? 0),
    materialCost: toCents(data.material_cost ?? 0),
    sortOrder: data.sort_order ?? 0,
  });
  const surface = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.roomId, idNum)).orderBy(desc(schema.estimateSurfaces.id)).limit(1).get();
  // Atomic-with-the-mutation sync: the generated estimate_lines row is
  // created (and totals recomputed) as part of this same request, before the
  // response is returned -- there's no window where estimate_lines reflects
  // a stale/missing state relative to the surfaces that exist.
  await syncEstimateLineForSurface(db, room.estimateId, room.name, {
    id: surface!.id, surfaceType: surface!.surfaceType, coats: surface!.coats, paintProduct: surface!.paintProduct,
    laborCost: surface!.laborCost, materialCost: surface!.materialCost, generatedLineId: surface!.generatedLineId,
  });
  await recomputeEstimateTotals(db, room.estimateId);
  const fresh = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.id, surface!.id)).get();
  return c.json(estimateSurfaceOut(fresh!), 201);
});

const updateEstimateSurface = createRoute({
  method: "put",
  path: "/api/estimate-surfaces/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      surface_type: zName.optional(),
      measurement: zMoney.optional(),
      prep_notes: z.string().optional(),
      coats: z.number().int().positive().optional(),
      paint_product: z.string().optional(),
      labor_cost: zMoney.optional(),
      material_cost: zMoney.optional(),
      sort_order: z.number().int().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateEstimateSurface, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const surface = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.id, idNum)).get();
  if (!surface) return c.json({ error: "Surface not found" }, 404);
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.id, surface.roomId)).get();
  if (!room) return c.json({ error: "Room not found" }, 404);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, room.estimateId)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.surface_type !== undefined) updates.surfaceType = data.surface_type;
  if (data.measurement !== undefined) updates.measurement = data.measurement;
  if (data.prep_notes !== undefined) updates.prepNotes = data.prep_notes || null;
  if (data.coats !== undefined) updates.coats = data.coats;
  if (data.paint_product !== undefined) updates.paintProduct = data.paint_product || null;
  if (data.labor_cost !== undefined) updates.laborCost = toCents(data.labor_cost);
  if (data.material_cost !== undefined) updates.materialCost = toCents(data.material_cost);
  if (data.sort_order !== undefined) updates.sortOrder = data.sort_order;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.estimateSurfaces).set(updates).where(eq(schema.estimateSurfaces.id, idNum));
  }
  const fresh = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.id, idNum)).get();
  await syncEstimateLineForSurface(db, room.estimateId, room.name, {
    id: fresh!.id, surfaceType: fresh!.surfaceType, coats: fresh!.coats, paintProduct: fresh!.paintProduct,
    laborCost: fresh!.laborCost, materialCost: fresh!.materialCost, generatedLineId: fresh!.generatedLineId,
  });
  await recomputeEstimateTotals(db, room.estimateId);
  return c.json({ ok: true }, 200);
});

const deleteEstimateSurface = createRoute({
  method: "delete",
  path: "/api/estimate-surfaces/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Locked", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteEstimateSurface, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const surface = await db.select().from(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.id, idNum)).get();
  if (!surface) return c.json({ error: "Surface not found" }, 404);
  const room = await db.select().from(schema.estimateRooms).where(eq(schema.estimateRooms.id, surface.roomId)).get();
  if (!room) return c.json({ error: "Room not found" }, 404);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, room.estimateId)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot edit the structured builder on a ${estimate.status} estimate -- only draft estimates can be edited.` }, 409);
  }
  await removeGeneratedLine(db, surface.generatedLineId);
  await db.delete(schema.estimateSurfaces).where(eq(schema.estimateSurfaces.id, idNum));
  await recomputeEstimateTotals(db, room.estimateId);
  return c.json({ ok: true }, 200);
});

// ── Estimate deposit ────────────────────────────────────────────────

const setEstimateDeposit = createRoute({
  method: "put",
  path: "/api/estimates/{id}/deposit",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      // null/0 clears the deposit.
      deposit_amount: zMoney.nullable(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(setEstimateDeposit, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ status: schema.estimates.status, total: schema.estimates.total }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  // Settable while the estimate is still "live" -- draft/sent/approved.
  // Once converted/declined/expired the deposit either already moved money
  // (converted) or is moot (declined/expired), so it's frozen like the rest
  // of the document at that point.
  if (!["draft", "sent", "approved"].includes(estimate.status)) {
    return c.json({ error: `Cannot set a deposit on a ${estimate.status} estimate.` }, 409);
  }
  const data = c.req.valid("json");
  // data.deposit_amount is DOLLARS (client input) -- convert to cents before
  // comparing against estimate.total, which is already raw cents from the DB.
  // Mixing an unconverted dollars value with a raw cents value here would
  // silently accept a deposit ~100x too large.
  const depositAmountCents = data.deposit_amount === null ? null : toCents(data.deposit_amount);
  const estimateTotalCents = estimate.total || 0;
  if (depositAmountCents !== null && depositAmountCents > estimateTotalCents) {
    return c.json({ error: `Deposit cannot exceed the estimate total (${fromCents(estimateTotalCents).toFixed(2)}).` }, 400);
  }
  // Store 0 the same as null -- both mean "no deposit" (convertEstimate's
  // `depositAmount && depositAmount > 0` guard already treats them the same,
  // but normalizing here too keeps the stored value matching the "null/0
  // clears the deposit" contract above instead of leaving a stray literal 0).
  const storedDepositCents = depositAmountCents === null || depositAmountCents === 0 ? null : depositAmountCents;
  await db.update(schema.estimates).set({ depositAmount: storedDepositCents }).where(eq(schema.estimates.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Convert estimate to job + invoice ──────────────────────────────
// Only valid when status is "approved". Creates a new scheduled job priced
// at the estimate's total, plus a new draft invoice whose lines are a 1:1
// copy of the estimate's lines (same description/quantity/unit_price/total
// for each row -- no re-derivation), with the invoice's job_id pointing at
// the newly created job.

const convertEstimate = createRoute({
  method: "post",
  path: "/api/estimates/{id}/convert",
  request: { params: IdParam },
  responses: {
    201: { description: "Converted", content: { "application/json": { schema: z.object({ ok: z.boolean(), job_id: z.number().int(), invoice_id: z.number().int(), deposit_invoice_id: z.number().int().nullable() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(convertEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select().from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "approved") {
    return c.json({ error: `Cannot convert an estimate with status "${estimate.status}" -- only approved estimates can be converted` }, 409);
  }

  const lines = await db.select().from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, idNum)).orderBy(asc(schema.estimateLines.id)).all();

  // NOTE: this entire route operates on raw, UNCONVERTED cents values --
  // estimate.subtotal/total/depositAmount and line.unitPrice/total are all
  // read straight from Drizzle (no fromCents), and every value written below
  // (jobs.price, invoices.subtotal/total, invoiceLines.unitPrice/total) goes
  // straight into the corresponding (cents) column. That's correct, not a
  // missed boundary: this route's only JSON response is
  // { ok, job_id, invoice_id, deposit_invoice_id } -- no money crosses the
  // wire here, so the deposit-credit-on-final-invoice math below (offsetting
  // "Less: Deposit paid" line) is exact integer-cents arithmetic with no
  // float drift, same as the original dollars-space version but now provably
  // exact.

  // ── Create the job ──
  // createJob's Zod schema only requires customer_id + scheduled_date;
  // everything else has a server-side default. scheduled_date defaults to
  // today since an approved estimate has no other date signal to draw
  // from -- office/dispatch can reschedule from the job detail view same
  // as any other job.
  const jobIdentifier = await nextIdentifier(db);
  // Default the new job to today in Tampa (America/New_York), not UTC.
  const today = todayInTampa();
  // The job carries the PRE-TAX subtotal, never the tax-inclusive total --
  // tax lives on the invoice, not the job (the invoice below keeps the full
  // subtotal/tax/total breakdown). Baking tax into job.price would
  // double-count it and inflate every job-price-based figure.
  const jobPrice = estimate.subtotal || 0;
  // Copy the customer's address onto the job, same address-from-customer
  // fallback createJob uses -- an estimate has no address of its own, so
  // without this the converted job would have a blank address.
  let jobAddress = "";
  const cust = await db
    .select({ address: schema.customers.address, city: schema.customers.city, state: schema.customers.state, zip: schema.customers.zip })
    .from(schema.customers)
    .where(eq(schema.customers.id, estimate.customerId))
    .get();
  if (cust) {
    jobAddress = [cust.address, cust.city, cust.state, cust.zip].filter(Boolean).join(", ");
  }
  await db.insert(schema.jobs).values({
    identifier: jobIdentifier,
    customerId: estimate.customerId,
    status: "scheduled",
    priority: "normal",
    scheduledDate: today,
    scheduledTime: "09:00",
    duration: 60,
    price: jobPrice,
    address: jobAddress,
    notes: estimate.notes || "",
    brandId: estimate.brandId ?? null,
  });
  const job = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.identifier, jobIdentifier)).get();
  const jobId = job!.id;

  // ── Create the draft invoice, lines copied 1:1 from the estimate ──
  const invoiceIdentifier = await nextInvoiceIdentifier(db);
  await db.insert(schema.invoices).values({
    identifier: invoiceIdentifier,
    customerId: estimate.customerId,
    jobId,
    status: "draft",
    subtotal: estimate.subtotal || 0,
    taxRate: estimate.taxRate || 0,
    taxAmount: estimate.taxAmount || 0,
    total: estimate.total || 0,
    notes: estimate.notes || "",
    dueDate: "",
    brandId: estimate.brandId ?? null,
  });
  const invoice = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.identifier, invoiceIdentifier)).get();
  const invoiceId = invoice!.id;

  for (const line of lines) {
    await db.insert(schema.invoiceLines).values({
      invoiceId,
      description: line.description,
      quantity: line.quantity ?? 0,
      unitPrice: line.unitPrice ?? 0,
      total: line.total ?? 0,
    });
  }

  // ── Deposit invoice ──
  // If the estimate has a deposit_amount set (> 0), mint a SECOND invoice for
  // just that amount: status "sent" (due immediately -- a deposit is
  // typically collected right away, not left in draft), a single "Deposit"
  // line, linked to the same job_id. invoices.job_id has no uniqueness
  // constraint (confirmed against migrations/meta/0003_snapshot.json's
  // invoices table indexes -- idx_invoices_job is non-unique), so two
  // invoices on one job is already schema-legal.
  //
  // The deposit is a credit toward the job total, not an addition to it: the
  // "final" invoice gets an offsetting negative "Less: Deposit paid" line
  // (via the same recomputeInvoiceTotals() every other line-mutating route
  // uses) so the two invoices always sum to exactly the estimate's total --
  // never an over-collection. An earlier version of this left the final
  // invoice at full value, which double-billed the deposit; adversarial
  // review caught it live (estimate total $110 + $40 deposit produced $150 of
  // invoices) before this shipped.
  let depositInvoiceId: number | null = null;
  const depositAmount = estimate.depositAmount;
  if (depositAmount && depositAmount > 0) {
    const depositIdentifier = await nextInvoiceIdentifier(db);
    await db.insert(schema.invoices).values({
      identifier: depositIdentifier,
      customerId: estimate.customerId,
      jobId,
      status: "sent",
      subtotal: depositAmount,
      taxRate: 0,
      taxAmount: 0,
      total: depositAmount,
      notes: `Deposit for estimate ${estimate.identifier || ""}`.trim(),
      dueDate: today,
      brandId: estimate.brandId ?? null,
    });
    const depositInvoice = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.identifier, depositIdentifier)).get();
    depositInvoiceId = depositInvoice!.id;
    await db.insert(schema.invoiceLines).values({
      invoiceId: depositInvoiceId,
      description: "Deposit",
      quantity: 1,
      unitPrice: depositAmount,
      total: depositAmount,
    });

    // Credit the deposit against the final invoice so the two never sum to
    // more than the estimate's total -- for ANY tax rate, not just 0%.
    //
    // A plain recomputeInvoiceTotals() call here would re-derive tax as
    // (subtotal_after_credit * taxRate), which UNDER-collects tax whenever
    // tax_rate > 0: it effectively taxes the deposit portion at 0% instead of
    // the estimate's real rate. (Adversarial review on the cents migration
    // caught this: a $530.70 estimate with a 6% rate + $100.25 deposit summed
    // to only $524.68 across the two invoices -- $6.02 short.) The deposit is
    // a credit against an already-fully-taxed total, not a pre-tax discount,
    // so tax_amount must be carried over UNCHANGED from the estimate, and
    // only subtotal/total shift by the deposit -- total lands on exactly
    // estimate.total - depositAmount for every tax rate, not just 0%.
    await db.insert(schema.invoiceLines).values({
      invoiceId,
      description: "Less: Deposit paid",
      quantity: 1,
      unitPrice: -depositAmount,
      total: -depositAmount,
    });
    await db.update(schema.invoices).set({
      subtotal: (estimate.subtotal || 0) - depositAmount,
      taxAmount: estimate.taxAmount || 0,
      total: (estimate.total || 0) - depositAmount,
      updatedAt: sql`(datetime('now'))`,
    }).where(eq(schema.invoices.id, invoiceId));
  }

  // Mark converted so a second call 409s (the `status !== "approved"` check
  // above) instead of silently minting a duplicate job+invoice. Without
  // this, clicking Convert twice -- or retrying after a slow response --
  // creates a second real job and invoice for the same estimate.
  await db.update(schema.estimates).set({ status: "converted" }).where(eq(schema.estimates.id, idNum));

  return c.json({ ok: true, job_id: jobId, invoice_id: invoiceId, deposit_invoice_id: depositInvoiceId }, 201);
});

// ── Change Orders ───────────────────────────────────────────────────
// Job-scoped money adjustments. Technicians get zero access (blocked by the
// blanket role-gate middleware above, matching the /api/invoices and
// /api/estimates blanket blocks). Approving a change order moves money onto
// an invoice; rejecting one does not.

function changeOrderOut(row: typeof schema.changeOrders.$inferSelect) {
  return { id: row.id, job_id: row.jobId, description: row.description, amount: fromCents(row.amount), status: row.status, created_at: row.createdAt ?? "" };
}

const listJobChangeOrders = createRoute({
  method: "get",
  path: "/api/jobs/{id}/change-orders",
  request: { params: IdParam },
  responses: {
    200: { description: "Change orders for a job", content: { "application/json": { schema: z.object({ change_orders: z.array(ChangeOrderSchema) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listJobChangeOrders, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, idNum)).get();
  if (!job) return c.json({ error: "Job not found" }, 404);
  const rows = await db.select().from(schema.changeOrders).where(eq(schema.changeOrders.jobId, idNum)).orderBy(desc(schema.changeOrders.id)).all();
  return c.json({ change_orders: rows.map(changeOrderOut) }, 200);
});

const createChangeOrder = createRoute({
  method: "post",
  path: "/api/jobs/{id}/change-orders",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      description: zName,
      amount: zPositive,
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ChangeOrderSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createChangeOrder, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const job = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, idNum)).get();
  if (!job) return c.json({ error: "Job not found" }, 404);
  const data = c.req.valid("json");
  await db.insert(schema.changeOrders).values({ jobId: idNum, description: data.description, amount: toCents(data.amount), status: "pending" });
  const row = await db.select().from(schema.changeOrders).where(eq(schema.changeOrders.jobId, idNum)).orderBy(desc(schema.changeOrders.id)).limit(1).get();
  return c.json(changeOrderOut(row!), 201);
});

const approveChangeOrder = createRoute({
  method: "put",
  path: "/api/change-orders/{id}/approve",
  request: { params: IdParam },
  responses: {
    200: { description: "Approved", content: { "application/json": { schema: z.object({ ok: z.boolean(), invoice_id: z.number().int() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(approveChangeOrder, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const changeOrder = await db.select().from(schema.changeOrders).where(eq(schema.changeOrders.id, idNum)).get();
  if (!changeOrder) return c.json({ error: "Change order not found" }, 404);
  if (changeOrder.status !== "pending") {
    return c.json({ error: `Cannot approve a change order with status "${changeOrder.status}" -- only pending change orders can be approved` }, 409);
  }

  // Find the job's most recent invoice still in draft/sent (i.e. not paid/
  // cancelled) to add the change-order amount onto as a new line. "Most
  // recent" = highest id, matching created_at order without a second sort key.
  const targetInvoice = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.jobId, changeOrder.jobId), inArray(schema.invoices.status, ["draft", "sent"])))
    .orderBy(desc(schema.invoices.id))
    .limit(1)
    .get();

  let invoiceId: number;
  if (targetInvoice) {
    invoiceId = targetInvoice.id;
    // changeOrder.amount is raw cents (straight from the DB) -- write it
    // straight into the (cents) invoice_lines columns, no conversion.
    const lineTotalCents = changeOrder.amount;
    await db.insert(schema.invoiceLines).values({
      invoiceId,
      description: `Change Order: ${changeOrder.description}`,
      quantity: 1,
      unitPrice: lineTotalCents,
      total: lineTotalCents,
    });
    await recomputeInvoiceTotals(db, invoiceId);
  } else {
    // No draft/sent invoice exists on this job (e.g. it's brand new, or every
    // existing invoice is already paid/cancelled) -- create a new invoice for
    // just the change-order amount, reusing the same createInvoiceWithLines
    // path progress billing uses. createInvoiceWithLines expects its
    // lines[].unit_price in DOLLARS (it converts to cents internally) --
    // changeOrder.amount is raw cents, so it must be converted back to
    // dollars here first, or this would silently double-convert (divide by
    // 100 twice) and store an amount 100x too small.
    const job = await db.select({ customerId: schema.jobs.customerId, brandId: schema.jobs.brandId }).from(schema.jobs).where(eq(schema.jobs.id, changeOrder.jobId)).get();
    invoiceId = await createInvoiceWithLines(db, {
      customerId: job!.customerId,
      jobId: changeOrder.jobId,
      taxRate: 0,
      notes: "",
      dueDate: "",
      brandId: job!.brandId ?? null,
      status: "sent",
      lines: [{ description: `Change Order: ${changeOrder.description}`, quantity: 1, unit_price: fromCents(changeOrder.amount) }],
    });
  }

  await db.update(schema.changeOrders).set({ status: "approved" }).where(eq(schema.changeOrders.id, idNum));
  return c.json({ ok: true, invoice_id: invoiceId }, 200);
});

const rejectChangeOrder = createRoute({
  method: "put",
  path: "/api/change-orders/{id}/reject",
  request: { params: IdParam },
  responses: {
    200: { description: "Rejected", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(rejectChangeOrder, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const changeOrder = await db.select({ status: schema.changeOrders.status }).from(schema.changeOrders).where(eq(schema.changeOrders.id, idNum)).get();
  if (!changeOrder) return c.json({ error: "Change order not found" }, 404);
  if (changeOrder.status !== "pending") {
    return c.json({ error: `Cannot reject a change order with status "${changeOrder.status}" -- only pending change orders can be rejected` }, 409);
  }
  await db.update(schema.changeOrders).set({ status: "rejected" }).where(eq(schema.changeOrders.id, idNum));
  return c.json({ ok: true }, 200);
});

// ── Service Agreements (recurring-job templates) ──────────────────
// Full access for admin/office/estimator; technicians are 403'd entirely by
// the blanket role-gate middleware above (path.startsWith("/api/service-
// agreements")), same pattern as estimates/invoices -- no per-route check
// needed here.

const SERVICE_AGREEMENT_INTERVALS = ["weekly", "monthly", "quarterly", "annual"] as const;
type ServiceAgreementInterval = (typeof SERVICE_AGREEMENT_INTERVALS)[number];

function serviceAgreementJoinedSelect(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: schema.serviceAgreements.id,
      customer_id: schema.serviceAgreements.customerId,
      brand_id: schema.serviceAgreements.brandId,
      service_type_id: schema.serviceAgreements.serviceTypeId,
      // The column is plain `text` in schema.ts, so cast the narrowed enum
      // shape here (application-level invariant: only createServiceAgreement/
      // updateServiceAgreement ever write this column, and both validate
      // against SERVICE_AGREEMENT_INTERVALS via the Zod enum below).
      interval: sql<ServiceAgreementInterval>`${schema.serviceAgreements.interval}`,
      next_run_date: schema.serviceAgreements.nextRunDate,
      active: schema.serviceAgreements.active,
      customer_name: schema.customers.name,
      brand_name: schema.brands.name,
      service_type_name: schema.serviceTypes.name,
    })
    .from(schema.serviceAgreements)
    .leftJoin(schema.customers, eq(schema.serviceAgreements.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.serviceAgreements.brandId, schema.brands.id))
    .leftJoin(schema.serviceTypes, eq(schema.serviceAgreements.serviceTypeId, schema.serviceTypes.id));
}

const listServiceAgreements = createRoute({
  method: "get",
  path: "/api/service-agreements",
  request: {
    query: z.object({ brand_id: zBrandIdQuery }),
  },
  responses: {
    200: {
      description: "All service agreements",
      content: { "application/json": { schema: z.object({ service_agreements: z.array(ServiceAgreementSchema) }) } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Brand not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listServiceAgreements, async (c) => {
  const db = getDb(c.env);
  const brandRes = await resolveBrandFilter(db, c.req.valid("query").brand_id);
  if (!brandRes.ok) return c.json({ error: "Brand not found" }, 404);
  const brandFilter = brandRes.brandId;
  const agreements = await serviceAgreementJoinedSelect(db)
    .where(brandFilter === null ? undefined : eq(schema.serviceAgreements.brandId, brandFilter))
    .orderBy(asc(schema.serviceAgreements.nextRunDate))
    .all();
  return c.json({ service_agreements: agreements }, 200);
});

const createServiceAgreement = createRoute({
  method: "post",
  path: "/api/service-agreements",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        customer_id: z.number().int(),
        brand_id: z.number().int().nullable().optional(),
        service_type_id: z.number().int().nullable().optional(),
        interval: z.enum(SERVICE_AGREEMENT_INTERVALS),
        next_run_date: zDate,
        active: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ServiceAgreementSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createServiceAgreement, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  if (!(await serviceTypeExists(db, data.service_type_id))) return c.json({ error: "Service type not found" }, 400);
  await db.insert(schema.serviceAgreements).values({
    customerId: data.customer_id,
    brandId: data.brand_id ?? null,
    serviceTypeId: data.service_type_id ?? null,
    interval: data.interval,
    nextRunDate: data.next_run_date,
    // Fixed at creation from the starting date's day-of-month -- see
    // advanceByInterval's comment for why this must never be re-derived
    // from a later (possibly already-clamped) next_run_date.
    anchorDay: parseInt(data.next_run_date.split("-")[2], 10),
    active: data.active ?? 1,
  });
  const row = await db.select().from(schema.serviceAgreements).orderBy(desc(schema.serviceAgreements.id)).limit(1).get();
  const out = await serviceAgreementJoinedSelect(db).where(eq(schema.serviceAgreements.id, row!.id)).get();
  return c.json(out!, 201);
});

const updateServiceAgreement = createRoute({
  method: "put",
  path: "/api/service-agreements/{id}",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: z.object({
        customer_id: z.number().int().optional(),
        brand_id: z.number().int().nullable().optional(),
        service_type_id: z.number().int().nullable().optional(),
        interval: z.enum(SERVICE_AGREEMENT_INTERVALS).optional(),
        next_run_date: zDate.optional(),
        active: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateServiceAgreement, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const data = c.req.valid("json");
  const existing = await db.select({ id: schema.serviceAgreements.id }).from(schema.serviceAgreements).where(eq(schema.serviceAgreements.id, idNum)).get();
  if (!existing) return c.json({ error: "Service agreement not found" }, 404);
  if (!(await customerExists(db, data.customer_id))) return c.json({ error: "Customer not found" }, 400);
  if (!(await brandExists(db, data.brand_id))) return c.json({ error: "Brand not found" }, 400);
  if (!(await serviceTypeExists(db, data.service_type_id))) return c.json({ error: "Service type not found" }, 400);

  const updates: Record<string, unknown> = {};
  if (data.customer_id !== undefined) updates.customerId = data.customer_id;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (data.service_type_id !== undefined) updates.serviceTypeId = data.service_type_id;
  if (data.interval !== undefined) updates.interval = data.interval;
  if (data.next_run_date !== undefined) {
    updates.nextRunDate = data.next_run_date;
    // An explicit next_run_date change is a new starting point -- re-anchor
    // to its day-of-month rather than leaving the old anchor in place.
    updates.anchorDay = parseInt(data.next_run_date.split("-")[2], 10);
  }
  if (data.active !== undefined) updates.active = data.active;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.serviceAgreements).set(updates).where(eq(schema.serviceAgreements.id, idNum));
  }
  return c.json({ ok: true }, 200);
});

const deleteServiceAgreement = createRoute({
  method: "delete",
  path: "/api/service-agreements/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteServiceAgreement, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.serviceAgreements).where(eq(schema.serviceAgreements.id, toId(id)));
  return c.json({ ok: true }, 200);
});

// ── Recurring-job generation (Cron Trigger + manual test route) ───────
// Advances a "YYYY-MM-DD" date string by exactly one interval period.
// weekly is a fixed +7 days, but monthly/quarterly/annual need real
// calendar-month/year arithmetic (not a fixed day count) -- e.g. Jan 31 +
// 1 month must land on Feb 28 (or Feb 29 in a leap year), not overflow into
// March via a naive "set date to 31" on a 28-day month. JS Date's
// setMonth/setFullYear already normalize month-end overflow *forward*
// (e.g. Jan 31 -> setMonth(1) rolls to Mar 3), so this clamps the day to
// the target month's actual last day itself rather than relying on that
// rollover behavior.
// anchorDay is the agreement's fixed target day-of-month (e.g. 31 for "runs
// on the 31st"), independent of dateStr's own day. Without this, deriving
// the target day from dateStr would compound: a 31st-of-the-month agreement
// clamped to Feb 28 would then advance from 28, permanently downgrading to
// "runs on the 28th" in every subsequent month -- even 31-day ones. Passing
// the original anchor lets every advance re-clamp against ONLY the target
// month's own length, so day 31 comes back on the very next 31-day month.
function advanceByInterval(dateStr: string, interval: (typeof SERVICE_AGREEMENT_INTERVALS)[number], anchorDay: number): string {
  const [y, m] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (interval === "weekly") {
    const [, , d] = dateStr.split("-").map((n) => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 7);
    return dt.toISOString().split("T")[0];
  }
  const monthsToAdd = interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12; // annual
  // Compute target year/month first (0-indexed month math), then clamp the
  // ANCHOR day-of-month to whatever the target month actually has (e.g. 31
  // -> 28/29 for February) instead of letting an out-of-range day overflow
  // into the following month.
  const totalMonths = (m - 1) + monthsToAdd;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12; // 0-indexed
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(anchorDay, daysInTargetMonth);
  const dt = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  return dt.toISOString().split("T")[0];
}

// Flips any invoice that is still "sent" but whose due_date is strictly before
// today (Tampa) to "overdue". Called from the scheduled() cron so overdue
// status is kept current without manual intervention, and reused by the stats
// route (flip-then-count) so the dashboard's Overdue tile reflects reality
// rather than always showing 0. A blank/missing due_date is never overdue
// (COALESCE to '' and the `<> ''` guard skip those). Returns how many flipped.
async function updateOverdueInvoices(env: AppBindings["Bindings"]): Promise<number> {
  const db = getDb(env);
  const today = todayInTampa();
  const res = await db
    .update(schema.invoices)
    .set({ status: "overdue", updatedAt: sql`(datetime('now'))` })
    .where(and(
      eq(schema.invoices.status, "sent"),
      sql`COALESCE(${schema.invoices.dueDate}, '') <> ''`,
      sql`${schema.invoices.dueDate} < ${today}`,
    ));
  // D1's run result exposes meta.changes; fall back to 0 if unavailable.
  return (res as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
}

// Shared logic used by BOTH the scheduled() cron handler and the manual
// POST /api/service-agreements/run-due-now route below, so the two can never
// drift out of sync and the manual route is a faithful stand-in for testing
// what the cron trigger does (Cron Triggers don't fire in local `wrangler
// dev` in a way that's easy to test interactively).
//
// For every active agreement whose next_run_date is today (server-computed
// via SQL date('now'), never client-passed) or earlier: creates a new job
// dated at the agreement's due next_run_date (status "scheduled", price/
// duration defaulted from the service type exactly like createJob does),
// then advances next_run_date by one interval period. Returns a summary for
// the manual route's response / cron log line.
async function processDueServiceAgreements(env: AppBindings["Bindings"]): Promise<{ processed: number; created_job_ids: number[] }> {
  const db = getDb(env);
  // Compute "today" in Tampa (America/New_York) in JS and pass it as a bound
  // parameter, rather than SQLite's date('now') which is UTC -- the cron fires
  // at 6am UTC (= 1am/2am Tampa), and a UTC cutoff would run agreements a day
  // early relative to the Tampa calendar the business schedules against.
  const today = todayInTampa();
  const due = await db
    .select()
    .from(schema.serviceAgreements)
    .where(and(eq(schema.serviceAgreements.active, 1), sql`${schema.serviceAgreements.nextRunDate} <= ${today}`))
    .all();

  const createdJobIds: number[] = [];
  for (const agreement of due) {
    if (!agreement.nextRunDate) continue; // no due date set -- nothing to schedule against

    // Default price/duration from the service type, same as createJob.
    let duration = 60;
    let price = 0;
    if (agreement.serviceTypeId) {
      const st = await db
        .select({ default_duration: schema.serviceTypes.defaultDuration, default_price: schema.serviceTypes.defaultPrice })
        .from(schema.serviceTypes)
        .where(eq(schema.serviceTypes.id, agreement.serviceTypeId))
        .get();
      if (st) {
        duration = st.default_duration;
        price = st.default_price;
      }
    }

    // Address defaults from the customer, same fallback createJob uses.
    let address = "";
    const cust = await db
      .select({ address: schema.customers.address, city: schema.customers.city, state: schema.customers.state, zip: schema.customers.zip })
      .from(schema.customers)
      .where(eq(schema.customers.id, agreement.customerId))
      .get();
    if (cust) {
      address = [cust.address, cust.city, cust.state, cust.zip].filter(Boolean).join(", ");
    }

    const identifier = await nextIdentifier(db);
    await db.insert(schema.jobs).values({
      identifier,
      customerId: agreement.customerId,
      serviceTypeId: agreement.serviceTypeId ?? null,
      status: "scheduled",
      priority: "normal",
      scheduledDate: agreement.nextRunDate,
      scheduledTime: "09:00",
      duration,
      // price came from service_types.default_price above, which is DOLLARS
      // (that column is deliberately NOT part of the cents migration) --
      // convert to cents before writing into jobs.price (a cents column).
      price: toCents(price),
      address,
      notes: "Auto-generated from recurring service agreement.",
      brandId: agreement.brandId ?? null,
    });
    const job = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.identifier, identifier)).get();
    createdJobIds.push(job!.id);
    await enqueueJobReminder(env, job!.id, agreement.nextRunDate);

    // Fall back to the current date's own day for pre-existing rows created
    // before anchorDay existed (backward compatible with any such rows --
    // they'll re-derive an anchor from wherever they currently are, which
    // is the best available information at that point).
    const anchorDay = agreement.anchorDay ?? parseInt(agreement.nextRunDate.split("-")[2], 10);
    const nextRun = advanceByInterval(agreement.nextRunDate, agreement.interval as (typeof SERVICE_AGREEMENT_INTERVALS)[number], anchorDay);
    await db.update(schema.serviceAgreements).set({ nextRunDate: nextRun }).where(eq(schema.serviceAgreements.id, agreement.id));
  }

  return { processed: due.length, created_job_ids: createdJobIds };
}

// Admin-only manual trigger for the exact same due-agreement processing the
// scheduled() cron handler runs -- exists purely so this can be exercised
// on demand (curl/Postman/browser devtools) since Cron Triggers don't fire
// interactively in local `wrangler dev`.
const runDueServiceAgreementsNow = createRoute({
  method: "post",
  path: "/api/service-agreements/run-due-now",
  responses: {
    200: {
      description: "Processed due service agreements",
      content: { "application/json": { schema: z.object({ ok: z.boolean(), processed: z.number().int(), created_job_ids: z.array(z.number().int()) }) } },
    },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(runDueServiceAgreementsNow, async (c) => {
  // Deliberately admin-only (stricter than the rest of this resource
  // family, which is admin/office/estimator) -- this mutates data
  // (creates jobs, advances agreements) on demand rather than through the
  // normal UI flow, so it's scoped to the most trusted role.
  if (c.get("user").role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const result = await processDueServiceAgreements(c.env);
  return c.json({ ok: true, ...result }, 200);
});

// ═══════════════════════════════════════════════════════════════════
// DEMO WORKSPACE ("Sunshine Painting Co (Demo)")
// ═══════════════════════════════════════════════════════════════════
// POST /api/demo/reset (admin-only) idempotently (re)creates a rich, alive
// demo account so Will can walk prospects/new hires through the whole app
// without touching Westchase/TKC data. SAFETY MODEL (this gets attacked):
//   1. The demo brand is resolved by its fixed slug and REFUSED (409) unless
//      brands.is_demo = 1 -- is_demo is only ever set by this route's own
//      create path, never by the brand CRUD routes.
//   2. Every DELETE is scoped through the demo brand id: the wipe targets
//      customers WHERE brand_id = demo, and every document table is deleted
//      via "belongs to one of those customers" subqueries (children first,
//      following the real FK graph in src/db/schema.ts). A real job/invoice
//      that someone merely TAGGED with the demo brand but that belongs to a
//      real customer is deliberately NOT touched.
//   3. The whole wipe runs as ONE db.batch() -- D1 executes a batch as a
//      single atomic transaction, so a partial failure can't half-wipe.
//   4. Shared company data (users, technicians, materials, service_types,
//      products, brands other than the demo one) is never deleted or created.
//      Demo jobs reference the EXISTING seeded technicians/service types.
//   5. Shared MUTABLE state is left alone too: demo documents mint their
//      identifiers from separate demo_* _meta counters (see
//      nextDemoIdentifier below), so a reset never advances the real
//      JOB-N/INV-N/EST-N sequences or leaves gaps in real invoice numbering.

const DEMO_BRAND_SLUG = "demo-sunshine";
const DEMO_BRAND_NAME = "Sunshine Painting Co (Demo)";
const DEMO_BRAND_PRIMARY = "#0f766e"; // teal
const DEMO_BRAND_SECONDARY = "#c2604a"; // warm coral

// Demo documents mint identifiers from their OWN _meta counters
// (demo_job_counter / demo_invoice_counter / demo_estimate_counter) with a
// DEMO- prefix, NOT from the shared job/invoice/estimate counters -- so
// resetting the demo before every sales call never advances (and never gaps)
// the real Westchase/TKC JOB-N/INV-N/EST-N sequences. The demo counters are
// monotonic (never rewound), so a demo identifier can't collide with a
// leftover demo row even if a wipe ever misses one; the distinct DEMO- prefix
// keeps them out of the real namespaces, which jobs.identifier/
// invoices.identifier UNIQUE constraints protect. Same atomic
// UPDATE-RETURNING increment as the real counters (see incrementCounter).
async function nextDemoIdentifier(db: ReturnType<typeof getDb>, counterKey: string, prefix: string): Promise<string> {
  // Lazily create the counter row -- these keys aren't in the seed SQL.
  await db.run(sql`INSERT INTO _meta (key, value) VALUES (${counterKey}, '0') ON CONFLICT(key) DO NOTHING`);
  const next = await incrementCounter(db, counterKey);
  return `${prefix}-${next}`;
}

// "YYYY-MM-DD" + N days (negative OK). UTC math on a date-only value is safe
// here -- no time component, no DST edge to hit.
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split("T")[0];
}

// Deterministic-but-alive dataset. Dates are computed RELATIVE TO TODAY
// (America/New_York) on every reset, so the demo board always has jobs
// "today"/"this week" and a genuinely overdue invoice, no matter when it's
// reset. All money below is authored in DOLLARS and converted through
// toCents() at each insert -- the one storage rule this codebase never bends.
async function seedDemoData(db: ReturnType<typeof getDb>, demoId: number) {
  const today = todayInTampa();

  // Shared company resources the demo REFERENCES but never creates/mutates.
  const techs = await db.select({ id: schema.technicians.id }).from(schema.technicians).where(eq(schema.technicians.active, 1)).orderBy(asc(schema.technicians.id)).limit(3).all();
  const techId = (i: number): number | null => (techs.length ? techs[i % techs.length].id : null);
  const serviceTypesAll = await db.select({ id: schema.serviceTypes.id, name: schema.serviceTypes.name }).from(schema.serviceTypes).all();
  const st = (needle: string): number | null => serviceTypesAll.find((s) => s.name.toLowerCase().includes(needle))?.id ?? null;
  const stInterior = st("interior painting");
  const stExterior = st("exterior painting");
  const stPowerWash = st("power washing") ?? st("washing");
  const stCabinet = st("cabinet refinishing");

  // ── 12 customers across the Tampa map + lead pipeline ──
  const demoCustomers: {
    name: string; email: string; phone: string; address: string; city: string; zip: string;
    status: (typeof CUSTOMER_STATUSES)[number]; source: (typeof CUSTOMER_SOURCES)[number]; notes?: string;
  }[] = [
    { name: "Maria Alvarez", email: "maria.alvarez@example.com", phone: "(813) 555-0142", address: "4212 Cypress Meadow Ct", city: "Tampa (Carrollwood)", zip: "33624", status: "active", source: "referral", notes: "Referred by the Whitfields. Two dogs -- keep the gate closed." },
    { name: "James & Kelly Whitfield", email: "jkwhitfield@example.com", phone: "(813) 555-0177", address: "10437 Greenaire Dr", city: "Tampa (Westchase)", zip: "33626", status: "active", source: "google", notes: "HOA requires color approval before exterior work." },
    { name: "Deborah Chen", email: "dchen.tampa@example.com", phone: "(813) 555-0119", address: "812 S Orleans Ave", city: "Tampa (Hyde Park)", zip: "33606", status: "active", source: "repeat", notes: "Third project with us. Prefers morning start times." },
    { name: "Robert Castellano", email: "r.castellano@example.com", phone: "(813) 555-0163", address: "118 Baltic Cir", city: "Tampa (Davis Islands)", zip: "33606", status: "active", source: "website" },
    { name: "Angela Brooks", email: "angela.brooks@example.com", phone: "(813) 555-0186", address: "3915 W San Juan St", city: "Tampa (Palma Ceia)", zip: "33629", status: "lead", source: "google", notes: "Wants guest bath + laundry room done before Labor Day." },
    { name: "Tom Nguyen", email: "tom.nguyen@example.com", phone: "(813) 555-0128", address: "6109 Memorial Hwy", city: "Tampa (Town 'n' Country)", zip: "33615", status: "active", source: "website" },
    { name: "Priya Raman", email: "priya.raman@example.com", phone: "(813) 555-0151", address: "14310 Clubhouse Dr", city: "Tampa (Carrollwood Village)", zip: "33618", status: "active", source: "referral" },
    { name: "Frank DiMarco", email: "fdimarco@example.com", phone: "(813) 555-0194", address: "5008 W Neptune Way", city: "Tampa (Beach Park)", zip: "33609", status: "lead", source: "other", notes: "Met at the Westshore home show. Big stucco house, faded south wall." },
    { name: "Susan Oliveira", email: "susan.oliveira@example.com", phone: "(813) 555-0135", address: "7521 Fairway Bend", city: "Tampa (Westchase)", zip: "33626", status: "active", source: "repeat", notes: "On the monthly pressure-wash plan." },
    { name: "Marcus Reid", email: "marcus.reid@example.com", phone: "(813) 555-0170", address: "909 E Broad St", city: "Tampa (Seminole Heights)", zip: "33604", status: "lead", source: "google" },
    { name: "Elena Petrov", email: "elena.petrov@example.com", phone: "(813) 555-0122", address: "2418 W Watrous Ave", city: "Tampa (South Tampa)", zip: "33629", status: "active", source: "referral" },
    { name: "Hannah & Luke Sorensen", email: "sorensens@example.com", phone: "(813) 555-0158", address: "11704 Derbyshire Dr", city: "Tampa (Westchase)", zip: "33626", status: "lead", source: "website", notes: "Expecting in November -- want the interior done well before." },
  ];
  const custIds: number[] = [];
  for (const cust of demoCustomers) {
    const rows = await db.insert(schema.customers).values({
      name: cust.name, email: cust.email, phone: cust.phone, address: cust.address,
      city: cust.city, state: "FL", zip: cust.zip, notes: cust.notes || "",
      status: cust.status, source: cust.source, brandId: demoId,
    }).returning({ id: schema.customers.id });
    custIds.push(rows[0].id);
  }
  const cust = (i: number) => custIds[i]; // 0-based index into the list above

  // ── Jobs ── (identifiers minted through the demo-only DEMO-JOB-N counter)
  async function insertDemoJob(v: {
    customerIdx: number; technicianId: number | null; serviceTypeId: number | null;
    status: string; date: string; time: string; durationMin: number; priceDollars: number;
    notes?: string; endDate?: string; completionNotes?: string; warrantyMonths?: number; priority?: string;
  }): Promise<number> {
    const identifier = await nextDemoIdentifier(db, "demo_job_counter", "DEMO-JOB");
    const customer = demoCustomers[v.customerIdx];
    const rows = await db.insert(schema.jobs).values({
      identifier,
      customerId: cust(v.customerIdx),
      technicianId: v.technicianId,
      serviceTypeId: v.serviceTypeId,
      status: v.status,
      priority: v.priority || "normal",
      scheduledDate: v.date,
      scheduledTime: v.time,
      duration: v.durationMin,
      price: toCents(v.priceDollars),
      address: `${customer.address}, ${customer.city}, FL ${customer.zip}`,
      notes: v.notes || "",
      completionNotes: v.completionNotes || "",
      endDate: v.endDate ?? null,
      warrantyMonths: v.warrantyMonths ?? null,
      warrantyExpiresAt: v.warrantyMonths ? addCalendarMonths(v.date, v.warrantyMonths) : null,
      brandId: demoId,
    }).returning({ id: schema.jobs.id });
    return rows[0].id;
  }

  // Two on the board TODAY (one mid-flight), the rest spread across the week.
  const jobToday1 = await insertDemoJob({ customerIdx: 0, technicianId: techId(0), serviceTypeId: stInterior, status: "in_progress", date: today, time: "09:00", durationMin: 480, priceDollars: 1850, notes: "Living room, hallway, and stairwell -- walls + ceilings. Furniture centered and covered by homeowner." });
  await insertDemoJob({ customerIdx: 8, technicianId: techId(1), serviceTypeId: stPowerWash, status: "scheduled", date: today, time: "13:30", durationMin: 120, priceDollars: 350, notes: "Driveway, pool deck, and front walk." });
  await insertDemoJob({ customerIdx: 2, technicianId: techId(1), serviceTypeId: stInterior, status: "scheduled", date: addDays(today, 1), time: "08:30", durationMin: 480, priceDollars: 2400, notes: "Primary suite + office repaint. Morning start per customer." });
  // Multi-day exterior repaint spanning three days.
  const jobMultiDay = await insertDemoJob({ customerIdx: 1, technicianId: techId(0), serviceTypeId: stExterior, status: "confirmed", date: addDays(today, 1), time: "08:00", durationMin: 480, priceDollars: 7400, endDate: addDays(today, 3), priority: "high", notes: "Full exterior repaint -- pressure wash day 1, stucco body day 2, trim/doors day 3. HOA color approval on file." });
  await insertDemoJob({ customerIdx: 6, technicianId: techId(2), serviceTypeId: stCabinet, status: "confirmed", date: addDays(today, 4), time: "10:00", durationMin: 360, priceDollars: 3100, notes: "Kitchen cabinet refinishing -- 32 doors/drawers, satin white." });
  // Unassigned/awaiting dispatch.
  await insertDemoJob({ customerIdx: 4, technicianId: null, serviceTypeId: stInterior, status: "scheduled", date: addDays(today, 8), time: "09:00", durationMin: 240, priceDollars: 950, notes: "Guest bathroom + laundry room. NEEDS CREW ASSIGNMENT." });
  // Three completed in recent weeks (one with completion notes + warranty).
  const jobDone1 = await insertDemoJob({ customerIdx: 3, technicianId: techId(0), serviceTypeId: stInterior, status: "completed", date: addDays(today, -5), time: "09:00", durationMin: 480, priceDollars: 2750, completionNotes: "Completed on schedule. Added a third coat on the dining room accent wall at no charge -- customer thrilled.", warrantyMonths: 24 });
  const jobDone2 = await insertDemoJob({ customerIdx: 10, technicianId: techId(1), serviceTypeId: stExterior, status: "completed", date: addDays(today, -12), time: "08:00", durationMin: 480, priceDollars: 5325 });
  const jobDone3 = await insertDemoJob({ customerIdx: 8, technicianId: techId(0), serviceTypeId: stPowerWash, status: "completed", date: addDays(today, -19), time: "10:00", durationMin: 120, priceDollars: 425 });

  // Second crew member on the multi-day job (only if a second tech exists).
  if (techs.length >= 2 && techId(0) !== null && techId(1) !== null && techId(0) !== techId(1)) {
    await db.insert(schema.jobCrew).values({ jobId: jobMultiDay, technicianId: techId(1)!, role: "helper" });
  }
  await db.insert(schema.jobNotes).values({ jobId: jobToday1, content: "Crew on site 9:05a -- prep complete, cutting in the living room now." });

  // ── Estimates ── (identifiers minted through the demo-only DEMO-EST-N counter)
  async function insertDemoEstimate(v: {
    customerIdx: number; status: string; taxRate?: number; notes?: string; validUntilDays?: number;
    approvedDaysAgo?: number; signedName?: string; depositDollars?: number; withToken?: boolean;
    lines: { description: string; quantity: number; unitPriceDollars: number }[];
  }): Promise<{ id: number; identifier: string; subtotalCents: number; taxAmountCents: number; totalCents: number }> {
    const identifier = await nextDemoIdentifier(db, "demo_estimate_counter", "DEMO-EST");
    const taxRate = v.taxRate ?? 0;
    const lineTotalsCents = v.lines.map((l) => Math.round(l.quantity * toCents(l.unitPriceDollars)));
    const subtotalCents = lineTotalsCents.reduce((s, t) => s + t, 0);
    const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
    const totalCents = subtotalCents + taxAmountCents;
    const approvedAt = v.approvedDaysAgo !== undefined ? `${addDays(today, -v.approvedDaysAgo)} 14:30:00` : null;
    const rows = await db.insert(schema.estimates).values({
      identifier,
      customerId: cust(v.customerIdx),
      brandId: demoId,
      status: v.status,
      subtotal: subtotalCents,
      taxRate,
      taxAmount: taxAmountCents,
      total: totalCents,
      validUntil: v.validUntilDays !== undefined ? addDays(today, v.validUntilDays) : null,
      notes: v.notes || "",
      approvedAt,
      signedAt: v.signedName ? approvedAt : null,
      signedName: v.signedName ?? null,
      publicToken: v.withToken ? crypto.randomUUID() : null,
      depositAmount: v.depositDollars ? toCents(v.depositDollars) : null,
    }).returning({ id: schema.estimates.id });
    const estimateId = rows[0].id;
    for (let i = 0; i < v.lines.length; i++) {
      const l = v.lines[i];
      await db.insert(schema.estimateLines).values({ estimateId, description: l.description, quantity: l.quantity, unitPrice: toCents(l.unitPriceDollars), total: lineTotalsCents[i] });
    }
    return { id: estimateId, identifier, subtotalCents, taxAmountCents, totalCents };
  }

  // Two drafts.
  await insertDemoEstimate({ customerIdx: 9, status: "draft", validUntilDays: 30, notes: "Two bedrooms + hallway. Colors TBD.", lines: [
    { description: "Bedroom repaint -- walls, ceiling, trim (x2)", quantity: 2, unitPriceDollars: 780 },
    { description: "Hallway + stair walls, 2 coats", quantity: 1, unitPriceDollars: 540 },
  ] });
  await insertDemoEstimate({ customerIdx: 7, status: "draft", validUntilDays: 30, notes: "South wall badly faded -- recommend elastomeric on stucco.", lines: [
    { description: "Exterior repaint -- stucco body, 2 coats elastomeric", quantity: 1, unitPriceDollars: 5400 },
    { description: "Fascia, soffit & trim", quantity: 1, unitPriceDollars: 1400 },
  ] });
  // Sent (plain).
  await insertDemoEstimate({ customerIdx: 4, status: "sent", withToken: true, validUntilDays: 21, notes: "Includes minor drywall patching in the laundry room.", lines: [
    { description: "Guest bathroom repaint -- walls + ceiling, moisture-resistant", quantity: 1, unitPriceDollars: 520 },
    { description: "Laundry room repaint + drywall patching", quantity: 1, unitPriceDollars: 430 },
  ] });
  // Sent, with the STRUCTURED ROOM/SURFACE BUILDER filled in (a realistic
  // 3-room interior scope). The generated estimate_lines rows mirror exactly
  // what syncEstimateLineForSurface would produce (one line per surface,
  // description via surfaceLineDescription, unit price = labor + material).
  {
    const builderRooms: { name: string; surfaces: { type: string; measurement: number; coats: number; prep: string; paint: string; laborDollars: number; materialDollars: number }[] }[] = [
      { name: "Primary Bedroom", surfaces: [
        { type: "Walls", measurement: 420, coats: 2, prep: "Patch nail holes, sand, spot-prime", paint: "SW SuperPaint Eg-Shel, Agreeable Gray", laborDollars: 380, materialDollars: 95 },
        { type: "Ceiling", measurement: 240, coats: 1, prep: "Cut in around fan, cover furniture", paint: "SW Eminence Flat White", laborDollars: 180, materialDollars: 55 },
        { type: "Trim & Doors", measurement: 120, coats: 2, prep: "Degloss, caulk gaps", paint: "SW ProClassic Semi-Gloss, Extra White", laborDollars: 220, materialDollars: 60 },
      ] },
      { name: "Kitchen", surfaces: [
        { type: "Walls", measurement: 310, coats: 2, prep: "Degrease around range, patch, sand", paint: "SW Duration Matte, Sea Salt", laborDollars: 340, materialDollars: 90 },
        { type: "Trim", measurement: 80, coats: 2, prep: "Caulk + sand", paint: "SW ProClassic Semi-Gloss, Extra White", laborDollars: 160, materialDollars: 45 },
      ] },
      { name: "Living Room", surfaces: [
        { type: "Walls", measurement: 520, coats: 2, prep: "Fill anchors, sand, spot-prime water stain", paint: "SW Duration Matte, Alabaster", laborDollars: 460, materialDollars: 120 },
        { type: "Ceiling", measurement: 300, coats: 1, prep: "Cover built-ins", paint: "SW Eminence Flat White", laborDollars: 210, materialDollars: 65 },
        { type: "Accent Wall", measurement: 90, coats: 2, prep: "Prime for deep base", paint: "BM Regal Select Matte, Hale Navy", laborDollars: 140, materialDollars: 48 },
      ] },
    ];
    const builderLines = builderRooms.flatMap((room) => room.surfaces.map((s) => ({
      description: surfaceLineDescription(room.name, s.type, s.coats, s.paint),
      quantity: 1,
      unitPriceDollars: s.laborDollars + s.materialDollars,
    })));
    const builderEst = await insertDemoEstimate({ customerIdx: 11, status: "sent", withToken: true, validUntilDays: 21, notes: "Three-room interior refresh before the nursery setup. Scope built room-by-room below.", lines: builderLines });
    let lineCursor = 0;
    const builderLineRows = await db.select({ id: schema.estimateLines.id }).from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, builderEst.id)).orderBy(asc(schema.estimateLines.id)).all();
    for (let r = 0; r < builderRooms.length; r++) {
      const room = builderRooms[r];
      const roomRows = await db.insert(schema.estimateRooms).values({ estimateId: builderEst.id, name: room.name, sortOrder: r }).returning({ id: schema.estimateRooms.id });
      for (let sIdx = 0; sIdx < room.surfaces.length; sIdx++) {
        const s = room.surfaces[sIdx];
        await db.insert(schema.estimateSurfaces).values({
          roomId: roomRows[0].id,
          surfaceType: s.type,
          measurement: s.measurement,
          prepNotes: s.prep,
          coats: s.coats,
          paintProduct: s.paint,
          laborCost: toCents(s.laborDollars),
          materialCost: toCents(s.materialDollars),
          sortOrder: sIdx,
          generatedLineId: builderLineRows[lineCursor]?.id ?? null,
        });
        lineCursor++;
      }
    }
  }
  // Approved (paper-signed, awaiting conversion).
  await insertDemoEstimate({ customerIdx: 0, status: "approved", approvedDaysAgo: 2, validUntilDays: 14, notes: "Front door + shutters + garage trim.", lines: [
    { description: "Front entry door -- strip, prime, 2 coats (BM Aura, Caliente)", quantity: 1, unitPriceDollars: 450 },
    { description: "Shutters (6) + garage door trim", quantity: 1, unitPriceDollars: 1000 },
  ] });
  // Declined.
  await insertDemoEstimate({ customerIdx: 3, status: "declined", validUntilDays: -3, notes: "Customer went with epoxy-only contractor.", lines: [
    { description: "Garage floor -- grind + 2-part epoxy with flake", quantity: 1, unitPriceDollars: 2100 },
  ] });
  // Converted: estimate -> job (+6 days) + deposit/balance invoice pair below.
  const convertedEst = await insertDemoEstimate({ customerIdx: 5, status: "converted", approvedDaysAgo: 4, signedName: "Tom Nguyen", depositDollars: 1500, notes: "Whole-interior repaint -- walls throughout, ceilings in living areas.", lines: [
    { description: "Whole-interior walls, 2 coats (approx. 2,900 sqft)", quantity: 1, unitPriceDollars: 4100 },
    { description: "Ceilings -- living room, kitchen, hallway", quantity: 1, unitPriceDollars: 1100 },
  ] });
  const jobConverted = await insertDemoJob({ customerIdx: 5, technicianId: techId(2), serviceTypeId: stInterior, status: "scheduled", date: addDays(today, 6), time: "08:00", durationMin: 480, priceDollars: 5200, notes: `Converted from estimate ${convertedEst.identifier}. Deposit collected.` });

  // ── Invoices + payments ── (identifiers minted through the demo-only DEMO-INV-N counter)
  async function insertDemoInvoice(v: {
    customerIdx: number; jobId: number | null; status: string; dueDate: string; paidDaysAgo?: number; notes?: string;
    lines: { description: string; quantity: number; unitPriceDollars: number }[];
  }): Promise<{ id: number; totalCents: number }> {
    const identifier = await nextDemoIdentifier(db, "demo_invoice_counter", "DEMO-INV");
    const lineTotalsCents = v.lines.map((l) => Math.round(l.quantity * toCents(l.unitPriceDollars)));
    const subtotalCents = lineTotalsCents.reduce((s, t) => s + t, 0);
    const rows = await db.insert(schema.invoices).values({
      identifier,
      customerId: cust(v.customerIdx),
      jobId: v.jobId,
      status: v.status,
      subtotal: subtotalCents,
      taxRate: 0,
      taxAmount: 0,
      total: subtotalCents,
      notes: v.notes || "",
      dueDate: v.dueDate,
      paidDate: v.paidDaysAgo !== undefined ? addDays(today, -v.paidDaysAgo) : "",
      brandId: demoId,
    }).returning({ id: schema.invoices.id });
    const invoiceId = rows[0].id;
    for (let i = 0; i < v.lines.length; i++) {
      const l = v.lines[i];
      await db.insert(schema.invoiceLines).values({ invoiceId, description: l.description, quantity: l.quantity, unitPrice: toCents(l.unitPriceDollars), total: lineTotalsCents[i] });
    }
    return { id: invoiceId, totalCents: subtotalCents };
  }
  async function insertDemoPayment(invoiceId: number, totalCents: number, method: "cash" | "check" | "card" | "financing", paidDaysAgo: number, tiered: boolean) {
    // tiered=true applies the real cash-discount/card-surcharge math via
    // computePaymentAmount; tiered=false records the plain total (the same
    // thing the Stripe webhook does for an online card payment).
    const { amountCents, surchargeAmountCents } = tiered
      ? computePaymentAmount(totalCents, method)
      : { amountCents: totalCents, surchargeAmountCents: 0 };
    await db.insert(schema.payments).values({
      invoiceId, method, amount: amountCents, surchargeAmount: surchargeAmountCents,
      status: "paid", paidAt: `${addDays(today, -paidDaysAgo)} 15:10:00`,
    });
  }

  // Paid #1 -- card (online, no surcharge), includes the approved change order.
  const invPaid1 = await insertDemoInvoice({ customerIdx: 10, jobId: jobDone2, status: "paid", dueDate: addDays(today, -8), paidDaysAgo: 10, lines: [
    { description: "Exterior repaint -- stucco body + trim, 2 coats", quantity: 1, unitPriceDollars: 5325 },
    { description: "Change Order: Pressure-wash driveway + walkways before paint", quantity: 1, unitPriceDollars: 275 },
  ] });
  await insertDemoPayment(invPaid1.id, invPaid1.totalCents, "card", 10, false);
  // Paid #2 -- cash, with the 8% cash-discount tier applied.
  const invPaid2 = await insertDemoInvoice({ customerIdx: 8, jobId: jobDone3, status: "paid", dueDate: addDays(today, -15), paidDaysAgo: 17, notes: "Paid in cash on completion (8% cash discount applied).", lines: [
    { description: "Pressure wash -- driveway, pool deck, lanai", quantity: 1, unitPriceDollars: 425 },
  ] });
  await insertDemoPayment(invPaid2.id, invPaid2.totalCents, "cash", 17, true);
  // Sent (current).
  await insertDemoInvoice({ customerIdx: 3, jobId: jobDone1, status: "sent", dueDate: addDays(today, 10), lines: [
    { description: "Interior repaint -- living/dining/hall walls + ceilings", quantity: 1, unitPriceDollars: 2750 },
  ] });
  // OVERDUE -- due date firmly in the past.
  await insertDemoInvoice({ customerIdx: 2, jobId: null, status: "overdue", dueDate: addDays(today, -9), notes: "Second notice sent.", lines: [
    { description: "Touch-up visit + drywall repair (2 rooms)", quantity: 1, unitPriceDollars: 480 },
  ] });
  // Deposit + balance pair from the converted estimate -- amounts mirror the
  // real /api/estimates/{id}/convert math: deposit invoice for the deposit,
  // balance invoice credited with an offsetting "Less: Deposit paid" line so
  // the pair sums to exactly the estimate total ($5,200 = $1,500 + $3,700).
  const invDeposit = await insertDemoInvoice({ customerIdx: 5, jobId: jobConverted, status: "paid", dueDate: addDays(today, -3), paidDaysAgo: 3, notes: `Deposit for estimate ${convertedEst.identifier}`, lines: [
    { description: "Deposit", quantity: 1, unitPriceDollars: 1500 },
  ] });
  await insertDemoPayment(invDeposit.id, invDeposit.totalCents, "card", 3, false);
  await insertDemoInvoice({ customerIdx: 5, jobId: jobConverted, status: "sent", dueDate: addDays(today, 14), notes: `Balance for estimate ${convertedEst.identifier}`, lines: [
    { description: "Whole-interior walls, 2 coats (approx. 2,900 sqft)", quantity: 1, unitPriceDollars: 4100 },
    { description: "Ceilings -- living room, kitchen, hallway", quantity: 1, unitPriceDollars: 1100 },
    { description: "Less: Deposit paid", quantity: 1, unitPriceDollars: -1500 },
  ] });

  // ── Change orders ──
  await db.insert(schema.changeOrders).values({ jobId: jobMultiDay, description: "Add garage door + trim", amount: toCents(650), status: "pending" });
  await db.insert(schema.changeOrders).values({ jobId: jobDone2, description: "Pressure-wash driveway + walkways before paint", amount: toCents(275), status: "approved" });

  // ── Recurring service agreement (monthly pressure wash) ──
  const nextRun = addDays(today, 14);
  await db.insert(schema.serviceAgreements).values({
    customerId: cust(8),
    brandId: demoId,
    serviceTypeId: stPowerWash,
    interval: "monthly",
    nextRunDate: nextRun,
    anchorDay: parseInt(nextRun.split("-")[2], 10),
    active: 1,
  });

  return { customers: 12, jobs: 10, estimates: 7, invoices: 6, payments: 3, change_orders: 2, service_agreements: 1 };
}

const DemoCountsSchema = z.object({
  customers: z.number().int(),
  jobs: z.number().int(),
  estimates: z.number().int(),
  invoices: z.number().int(),
}).openapi("DemoCounts");

const resetDemoRoute = createRoute({
  method: "post",
  path: "/api/demo/reset",
  responses: {
    200: {
      description: "Demo workspace wiped and re-seeded",
      content: { "application/json": { schema: z.object({
        ok: z.boolean(),
        brand_id: z.number().int(),
        created: z.object({
          customers: z.number().int(),
          jobs: z.number().int(),
          estimates: z.number().int(),
          invoices: z.number().int(),
          payments: z.number().int(),
          change_orders: z.number().int(),
          service_agreements: z.number().int(),
        }),
      }) } },
    },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Refused -- target brand is not flagged as demo", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(resetDemoRoute, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);

  // 1. Resolve-or-create the demo brand (idempotent by fixed slug).
  let demo = await db.select().from(schema.brands).where(eq(schema.brands.slug, DEMO_BRAND_SLUG)).get();
  if (!demo) {
    await db.insert(schema.brands).values({
      name: DEMO_BRAND_NAME,
      slug: DEMO_BRAND_SLUG,
      colorPrimary: DEMO_BRAND_PRIMARY,
      colorSecondary: DEMO_BRAND_SECONDARY,
      active: 1,
      isDemo: 1,
    });
    demo = await db.select().from(schema.brands).where(eq(schema.brands.slug, DEMO_BRAND_SLUG)).get();
  }
  // 2. HARD SAFETY INTERLOCK: refuse to wipe anything not flagged is_demo.
  if (!demo || demo.isDemo !== 1) {
    return c.json({ error: `Brand "${demo?.name ?? DEMO_BRAND_SLUG}" is not flagged as a demo workspace -- refusing to reset it.` }, 409);
  }
  const demoId = demo.id;

  // 3. Wipe -- every DELETE scoped through the demo brand's own customers
  // (children first, real FK order), all in ONE atomic D1 batch.
  const demoCustomerIds = db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.brandId, demoId));
  const demoJobIds = db.select({ id: schema.jobs.id }).from(schema.jobs).where(inArray(schema.jobs.customerId, demoCustomerIds));
  const demoInvoiceIds = db.select({ id: schema.invoices.id }).from(schema.invoices).where(inArray(schema.invoices.customerId, demoCustomerIds));
  const demoEstimateIds = db.select({ id: schema.estimates.id }).from(schema.estimates).where(inArray(schema.estimates.customerId, demoCustomerIds));
  const demoRoomIds = db.select({ id: schema.estimateRooms.id }).from(schema.estimateRooms).where(inArray(schema.estimateRooms.estimateId, demoEstimateIds));
  await db.batch([
    db.delete(schema.payments).where(inArray(schema.payments.invoiceId, demoInvoiceIds)),
    db.delete(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, demoInvoiceIds)),
    db.delete(schema.invoices).where(inArray(schema.invoices.customerId, demoCustomerIds)),
    db.delete(schema.changeOrders).where(inArray(schema.changeOrders.jobId, demoJobIds)),
    db.delete(schema.jobCrew).where(inArray(schema.jobCrew.jobId, demoJobIds)),
    db.delete(schema.jobNotes).where(inArray(schema.jobNotes.jobId, demoJobIds)),
    db.delete(schema.jobChecklist).where(inArray(schema.jobChecklist.jobId, demoJobIds)),
    db.delete(schema.jobMaterials).where(inArray(schema.jobMaterials.jobId, demoJobIds)),
    db.delete(schema.attachments).where(and(eq(schema.attachments.entityType, "job"), inArray(schema.attachments.entityId, demoJobIds))!),
    db.delete(schema.attachments).where(and(eq(schema.attachments.entityType, "estimate"), inArray(schema.attachments.entityId, demoEstimateIds))!),
    db.delete(schema.attachments).where(and(eq(schema.attachments.entityType, "customer"), inArray(schema.attachments.entityId, demoCustomerIds))!),
    db.delete(schema.jobs).where(inArray(schema.jobs.customerId, demoCustomerIds)),
    db.delete(schema.estimateSurfaces).where(inArray(schema.estimateSurfaces.roomId, demoRoomIds)),
    db.delete(schema.estimateRooms).where(inArray(schema.estimateRooms.estimateId, demoEstimateIds)),
    db.delete(schema.estimateLines).where(inArray(schema.estimateLines.estimateId, demoEstimateIds)),
    db.delete(schema.estimates).where(inArray(schema.estimates.customerId, demoCustomerIds)),
    db.delete(schema.serviceAgreements).where(inArray(schema.serviceAgreements.customerId, demoCustomerIds)),
    db.delete(schema.customers).where(eq(schema.customers.brandId, demoId)),
  ]);

  // 4. Seed the fresh cast, dated relative to today (America/New_York).
  const created = await seedDemoData(db, demoId);
  return c.json({ ok: true, brand_id: demoId, created }, 200);
});

const demoStatusRoute = createRoute({
  method: "get",
  path: "/api/demo/status",
  responses: {
    200: {
      description: "Whether the demo workspace exists + row counts",
      content: { "application/json": { schema: z.object({
        exists: z.boolean(),
        brand_id: z.number().int().nullable(),
        counts: DemoCountsSchema,
      }) } },
    },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(demoStatusRoute, async (c) => {
  const forbidden = requireAdminOrForbid(c);
  if (forbidden) return forbidden;
  const db = getDb(c.env);
  const demo = await db.select({ id: schema.brands.id, isDemo: schema.brands.isDemo }).from(schema.brands).where(eq(schema.brands.slug, DEMO_BRAND_SLUG)).get();
  if (!demo || demo.isDemo !== 1) {
    return c.json({ exists: false, brand_id: null, counts: { customers: 0, jobs: 0, estimates: 0, invoices: 0 } }, 200);
  }
  const demoCustomerIds = db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.brandId, demo.id));
  const customers = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.customers).where(eq(schema.customers.brandId, demo.id)).get();
  const jobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(inArray(schema.jobs.customerId, demoCustomerIds)).get();
  const estimates = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.estimates).where(inArray(schema.estimates.customerId, demoCustomerIds)).get();
  const invoices = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.invoices).where(inArray(schema.invoices.customerId, demoCustomerIds)).get();
  return c.json({
    exists: true,
    brand_id: demo.id,
    counts: {
      customers: customers?.count || 0,
      jobs: jobs?.count || 0,
      estimates: estimates?.count || 0,
      invoices: invoices?.count || 0,
    },
  }, 200);
});

// ═══════════════════════════════════════════════════════════════════
// CUSTOMER-FACING LOOP: PDFs, public token routes, HTML page, Stripe
// ═══════════════════════════════════════════════════════════════════

// ── Shared PDF data assembly ───────────────────────────────────────
// Loads an estimate (by id OR token) + its lines + customer + brand and shapes
// them into the framework-free PdfDocInput the pdf.ts helper renders. Returns
// null if not found. Used by both the authed and public estimate PDF routes.
async function buildEstimatePdfBytes(db: ReturnType<typeof getDb>, estimateId: number): Promise<Uint8Array | null> {
  const est = await db
    .select({
      identifier: schema.estimates.identifier,
      createdAt: schema.estimates.createdAt,
      subtotal: schema.estimates.subtotal,
      taxRate: schema.estimates.taxRate,
      taxAmount: schema.estimates.taxAmount,
      total: schema.estimates.total,
      notes: schema.estimates.notes,
      signedName: schema.estimates.signedName,
      signedAt: schema.estimates.signedAt,
      customerName: schema.customers.name,
      customerAddress: sql<string>`TRIM(COALESCE(${schema.customers.address}, '') || ' ' || COALESCE(${schema.customers.city}, '') || ' ' || COALESCE(${schema.customers.state}, '') || ' ' || COALESCE(${schema.customers.zip}, ''))`,
      brandName: schema.brands.name,
      brandColorPrimary: schema.brands.colorPrimary,
      brandColorSecondary: schema.brands.colorSecondary,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.estimates.brandId, schema.brands.id))
    .where(eq(schema.estimates.id, estimateId))
    .get();
  if (!est) return null;
  const lines = await db.select().from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, estimateId)).orderBy(asc(schema.estimateLines.id)).all();
  // buildDocumentPdf (src/lib/pdf.ts) formats these as decimal dollars --
  // convert every cents value at this boundary, right before it's handed off.
  const pdfLines: PdfLine[] = lines.map((l) => ({ description: l.description, quantity: l.quantity ?? 0, unitPrice: fromCents(l.unitPrice ?? 0), total: fromCents(l.total ?? 0) }));
  return await buildDocumentPdf({
    docType: "Estimate",
    businessName: est.brandName || "Noble Tampa",
    identifier: est.identifier,
    createdAt: est.createdAt,
    customerName: est.customerName || "",
    customerAddress: est.customerAddress || "",
    lines: pdfLines,
    subtotal: fromCents(est.subtotal || 0),
    taxRate: est.taxRate || 0,
    taxAmount: fromCents(est.taxAmount || 0),
    total: fromCents(est.total || 0),
    notes: est.notes,
    signedName: est.signedName,
    signedAt: est.signedAt,
    colorPrimary: est.brandColorPrimary,
    colorSecondary: est.brandColorSecondary,
  });
}

async function buildInvoicePdfBytes(db: ReturnType<typeof getDb>, invoiceId: number): Promise<Uint8Array | null> {
  const inv = await db
    .select({
      identifier: schema.invoices.identifier,
      createdAt: schema.invoices.createdAt,
      subtotal: schema.invoices.subtotal,
      taxRate: schema.invoices.taxRate,
      taxAmount: schema.invoices.taxAmount,
      total: schema.invoices.total,
      notes: schema.invoices.notes,
      customerName: schema.customers.name,
      customerAddress: sql<string>`TRIM(COALESCE(${schema.customers.address}, '') || ' ' || COALESCE(${schema.customers.city}, '') || ' ' || COALESCE(${schema.customers.state}, '') || ' ' || COALESCE(${schema.customers.zip}, ''))`,
      brandName: schema.brands.name,
      brandColorPrimary: schema.brands.colorPrimary,
      brandColorSecondary: schema.brands.colorSecondary,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(eq(schema.invoices.id, invoiceId))
    .get();
  if (!inv) return null;
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLines.id)).all();
  // buildDocumentPdf (src/lib/pdf.ts) formats these as decimal dollars --
  // convert every cents value at this boundary, right before it's handed off.
  const pdfLines: PdfLine[] = lines.map((l) => ({ description: l.description, quantity: l.quantity ?? 0, unitPrice: fromCents(l.unitPrice ?? 0), total: fromCents(l.total ?? 0) }));
  return await buildDocumentPdf({
    docType: "Invoice",
    businessName: inv.brandName || "Noble Tampa",
    identifier: inv.identifier,
    createdAt: inv.createdAt,
    customerName: inv.customerName || "",
    customerAddress: inv.customerAddress || "",
    lines: pdfLines,
    subtotal: fromCents(inv.subtotal || 0),
    taxRate: inv.taxRate || 0,
    taxAmount: fromCents(inv.taxAmount || 0),
    total: fromCents(inv.total || 0),
    notes: inv.notes,
    colorPrimary: inv.brandColorPrimary,
    colorSecondary: inv.brandColorSecondary,
  });
}

// PDF byte responses aren't a JSON shape, so these are plain Hono routes
// (like the R2 proxy / uploads) rather than app.openapi/Zod routes.
// application/pdf with inline disposition so "Download PDF" opens in a new tab.
function pdfResponse(bytes: Uint8Array, filename: string): Response {
  // Copy into a standalone (non-shared) ArrayBuffer so the BodyInit type is a
  // plain ArrayBuffer, not the Uint8Array's possibly-shared underlying buffer.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Response(ab, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

// GET /api/estimates/{id}/pdf (authed). Technicians are already 403'd on the
// whole /api/estimates family by the blanket role-gate above.
app.get("/api/estimates/:id/pdf", async (c) => {
  const db = getDb(c.env);
  const idNum = toId(c.req.param("id"));
  const bytes = await buildEstimatePdfBytes(db, idNum);
  if (!bytes) return c.json({ error: "Estimate not found" }, 404);
  const idRow = await db.select({ identifier: schema.estimates.identifier }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  return pdfResponse(bytes, `${idRow?.identifier || "estimate"}.pdf`);
});

// GET /api/invoices/{id}/pdf (authed). Technicians are 403'd on /api/invoices.
app.get("/api/invoices/:id/pdf", async (c) => {
  const db = getDb(c.env);
  const idNum = toId(c.req.param("id"));
  const bytes = await buildInvoicePdfBytes(db, idNum);
  if (!bytes) return c.json({ error: "Invoice not found" }, 404);
  const idRow = await db.select({ identifier: schema.invoices.identifier }).from(schema.invoices).where(eq(schema.invoices.id, idNum)).get();
  return pdfResponse(bytes, `${idRow?.identifier || "invoice"}.pdf`);
});

// ── Stripe checkout (authed, GATED on STRIPE_SECRET_KEY) ───────────
// POST /api/invoices/{id}/checkout -> { url } when Stripe is configured, or a
// clean 501 { error, configured:false } when it isn't (never a 500). Lives
// under /api/invoices so it's already covered by the technician role-gate's
// /api/invoices prefix block.
const invoiceCheckout = createRoute({
  method: "post",
  path: "/api/invoices/{id}/checkout",
  request: { params: IdParam },
  responses: {
    200: { description: "Checkout URL", content: { "application/json": { schema: z.object({ url: z.string() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invoice not in a payable state", content: { "application/json": { schema: ErrorSchema } } },
    501: { description: "Online payments not configured", content: { "application/json": { schema: z.object({ error: z.string(), configured: z.boolean() }) } } },
    502: { description: "Payment provider error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(invoiceCheckout, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const invoice = await db
    .select({
      id: schema.invoices.id,
      identifier: schema.invoices.identifier,
      total: schema.invoices.total,
      status: schema.invoices.status,
      brandName: schema.brands.name,
    })
    .from(schema.invoices)
    .leftJoin(schema.brands, eq(schema.invoices.brandId, schema.brands.id))
    .where(eq(schema.invoices.id, idNum))
    .get();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  // Only a sent (or now-overdue) invoice is payable online -- a draft hasn't
  // been finalized/handed to the customer yet, and paid/cancelled are
  // terminal. This matters even before Stripe keys exist: once they're added,
  // this is what stops a draft invoice from getting a live checkout link.
  if (invoice.status !== "sent" && invoice.status !== "overdue") {
    return c.json({ error: `This invoice is not payable online (status: ${invoice.status}).` }, 409);
  }
  // createInvoiceCheckout (src/lib/payments.ts) expects CheckoutInvoice.total
  // in DOLLARS -- it does its own `* 100` to get Stripe cents. invoice.total
  // is raw DB cents, so it must be converted here at the boundary; passing it
  // unconverted would make createInvoiceCheckout charge Stripe 100x too little.
  const result = await createInvoiceCheckout(c.env, { id: invoice.id, identifier: invoice.identifier, total: fromCents(invoice.total || 0), brandName: invoice.brandName }, requestBaseUrl(c));
  if (!result.configured) {
    return c.json({ error: "Online payments are not configured yet.", configured: false }, 501);
  }
  if (result.error || !result.url) {
    return c.json({ error: result.error || "Could not start checkout." }, 502);
  }
  return c.json({ url: result.url }, 200);
});

// ── Stripe webhook (public, GATED on STRIPE_WEBHOOK_SECRET) ────────
// POST /api/stripe/webhook. Skipped by the auth middleware (authenticated by
// the webhook SIGNATURE, not a session). With no STRIPE_WEBHOOK_SECRET set it
// cleanly returns "not configured" rather than trusting an unverified body.
// On a verified checkout.session.completed it records a 'card' payment against
// the invoice named in the session metadata, reusing the same
// raw-credit/flip-to-paid accounting as recordPayment.
app.post("/api/stripe/webhook", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    // Honest: nothing is wired up. 200 so Stripe (if somehow pointed here)
    // doesn't hammer retries, but the body states it plainly.
    return c.json({ received: false, reason: "online payments not configured" }, 200);
  }
  const payload = await c.req.text();
  const sig = c.req.header("stripe-signature") || null;
  const verified = await verifyStripeWebhook(c.env, payload, sig);
  if (!verified.valid || !verified.event) {
    return c.json({ error: verified.reason || "invalid signature" }, 400);
  }
  const event = verified.event;
  if (event.type === "checkout.session.completed") {
    const obj = event.data.object;
    const invoiceIdStr = obj.metadata?.invoice_id || obj.client_reference_id;
    const invoiceId = invoiceIdStr ? parseInt(invoiceIdStr, 10) : NaN;
    if (!Number.isNaN(invoiceId)) {
      const db = getDb(c.env);
      const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).get();
      if (invoice) {
        // Amount actually collected from Stripe. obj.amount_total is already
        // in Stripe's smallest-currency-unit (USD cents) -- the SAME unit our
        // payments.amount column now stores natively, so it's used as-is with
        // NO division by 100 (unlike the pre-cents-migration version of this
        // code, which had to convert Stripe cents down to dollars to match
        // the old real-dollars column). The fallback (amount_total absent) is
        // invoice.total, which is already raw DB cents -- also used as-is,
        // no conversion. This is the real card charge; record it with a card
        // surcharge of 0 (the customer paid the amount Stripe collected --
        // see createInvoiceCheckout, which charges the plain total).
        const amountCents = obj.amount_total ?? (invoice.total || 0);
        // Guard against a duplicate webhook delivery creating a second payment
        // for the same Stripe session/intent.
        const ref = obj.payment_intent || obj.id || null;
        const dup = ref ? await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.processorRef, ref)).get() : null;
        if (!dup) {
          await db.insert(schema.payments).values({
            invoiceId,
            method: "card",
            amount: amountCents,
            surchargeAmount: 0,
            processorRef: ref,
            status: "paid",
            paidAt: sql`(datetime('now'))`,
          });
          // Reuse recordPayment's flip-to-paid rule: if accumulated raw credit
          // now covers the total, mark the invoice paid. Exact integer-cents
          // comparison -- no epsilon needed.
          const paid = await db.select({ amount: schema.payments.amount, surchargeAmount: schema.payments.surchargeAmount }).from(schema.payments).where(and(eq(schema.payments.invoiceId, invoiceId), eq(schema.payments.status, "paid"))).all();
          const rawCreditCents = paid.reduce((s, p) => s + ((p.amount || 0) - (p.surchargeAmount || 0)), 0);
          if (rawCreditCents >= (invoice.total || 0)) {
            await db.update(schema.invoices).set({ status: "paid", paidDate: todayInTampa(), updatedAt: sql`(datetime('now'))` }).where(eq(schema.invoices.id, invoiceId));
          }
        }
      }
    }
  }
  return c.json({ received: true }, 200);
});

// ── Public (UNAUTHENTICATED, token-gated) estimate routes ──────────
// All under /api/public/*, skipped by the auth middleware. Security is the
// unguessable public_token, not a session. A token that doesn't match -> 404.

// Loads the estimate row by public token (or null). Shared by the public API +
// the HTML page below.
async function estimateByToken(db: ReturnType<typeof getDb>, token: string) {
  if (!token || token.length < 8) return null;
  return await db
    .select({
      id: schema.estimates.id,
      identifier: schema.estimates.identifier,
      status: schema.estimates.status,
      subtotal: schema.estimates.subtotal,
      taxRate: schema.estimates.taxRate,
      taxAmount: schema.estimates.taxAmount,
      total: schema.estimates.total,
      validUntil: schema.estimates.validUntil,
      notes: schema.estimates.notes,
      approvedAt: schema.estimates.approvedAt,
      signedName: schema.estimates.signedName,
      signedAt: schema.estimates.signedAt,
      createdAt: schema.estimates.createdAt,
      customerId: schema.estimates.customerId,
      customerName: schema.customers.name,
      customerAddress: sql<string>`TRIM(COALESCE(${schema.customers.address}, '') || ' ' || COALESCE(${schema.customers.city}, '') || ' ' || COALESCE(${schema.customers.state}, '') || ' ' || COALESCE(${schema.customers.zip}, ''))`,
      brandId: schema.estimates.brandId,
      brandName: schema.brands.name,
      brandColorPrimary: schema.brands.colorPrimary,
      brandColorSecondary: schema.brands.colorSecondary,
      brandLogoKey: schema.brands.logoR2Key,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .leftJoin(schema.brands, eq(schema.estimates.brandId, schema.brands.id))
    .where(eq(schema.estimates.publicToken, token))
    .get();
}

// GET /api/public/estimates/{token} -> estimate + lines + brand identity +
// business info, for the customer view. 404 on a non-matching token.
app.get("/api/public/estimates/:token", async (c) => {
  const db = getDb(c.env);
  const token = c.req.param("token");
  const est = await estimateByToken(db, token);
  if (!est) return c.json({ error: "Not found" }, 404);
  const lines = await db.select().from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, est.id)).orderBy(asc(schema.estimateLines.id)).all();
  return c.json({
    estimate: {
      identifier: est.identifier,
      status: est.status,
      subtotal: fromCentsNullable(est.subtotal),
      tax_rate: est.taxRate,
      tax_amount: fromCentsNullable(est.taxAmount),
      total: fromCentsNullable(est.total),
      valid_until: est.validUntil,
      notes: est.notes,
      approved_at: est.approvedAt,
      signed_name: est.signedName,
      signed_at: est.signedAt,
      created_at: est.createdAt,
      customer_name: est.customerName,
      lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit_price: fromCentsNullable(l.unitPrice), total: fromCentsNullable(l.total) })),
    },
    brand: {
      name: est.brandName || "Noble Tampa",
      color_primary: est.brandColorPrimary,
      color_secondary: est.brandColorSecondary,
      logo_key: est.brandLogoKey,
    },
    business: { location: "Tampa, FL", financing_url: ACORN_FINANCE_URL },
  }, 200);
});

// GET /api/public/estimates/{token}/pdf -> the estimate PDF for the customer.
app.get("/api/public/estimates/:token/pdf", async (c) => {
  const db = getDb(c.env);
  const est = await estimateByToken(db, c.req.param("token"));
  if (!est) return c.json({ error: "Not found" }, 404);
  const bytes = await buildEstimatePdfBytes(db, est.id);
  if (!bytes) return c.json({ error: "Not found" }, 404);
  return pdfResponse(bytes, `${est.identifier || "estimate"}.pdf`);
});

// POST /api/public/estimates/{token}/accept -> customer accepts + e-signs.
// Body { name, signature (data:image/png;base64,...) }. Requires status 'sent'.
// Stores the signature PNG in R2, records signed_* + moves to 'approved'.
const publicAcceptSchema = z.object({
  name: z.string().trim().min(1, { message: "Please enter your name" }),
  signature: z.string().min(1, { message: "Please sign before accepting" }),
});

app.post("/api/public/estimates/:token/accept", async (c) => {
  const db = getDb(c.env);
  const token = c.req.param("token");
  const est = await db.select().from(schema.estimates).where(eq(schema.estimates.publicToken, token)).get();
  if (!est) return c.json({ error: "Not found" }, 404);

  let body: z.infer<typeof publicAcceptSchema>;
  try {
    body = publicAcceptSchema.parse(await c.req.json());
  } catch (err) {
    const msg = (err as { errors?: { message?: string }[] })?.errors?.[0]?.message || "Invalid request";
    return c.json({ error: msg }, 400);
  }

  // Friendly 409 for an estimate that isn't in a signable state.
  if (est.status !== "sent") {
    if (est.status === "approved") return c.json({ error: "This estimate has already been accepted." }, 409);
    if (est.status === "declined") return c.json({ error: "This estimate was already declined." }, 409);
    return c.json({ error: `This estimate can no longer be accepted (status: ${est.status}).` }, 409);
  }

  // Decode the base64 PNG data URL to bytes and store it in R2 under
  // signatures/estimate-{id}-{uuid}.png. Reject a payload that isn't a PNG
  // data URL so a garbage body can't be stored.
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.signature.trim());
  if (!m) return c.json({ error: "Signature must be a PNG image." }, 400);
  let sigBytes: Uint8Array;
  try {
    const bin = atob(m[1]);
    sigBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i);
  } catch {
    return c.json({ error: "Could not read the signature image." }, 400);
  }
  const sigKey = `signatures/estimate-${est.id}-${crypto.randomUUID()}.png`;
  await c.env.BUCKET.put(sigKey, sigBytes, { httpMetadata: { contentType: "image/png" } });

  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  // Full timestamp (UTC) for the audit trail; signed_at is what the PDF's
  // "Accepted by ... on ..." line and the internal detail view read.
  await db.update(schema.estimates).set({
    status: "approved",
    approvedAt: sql`(datetime('now'))`,
    signatureR2Key: sigKey,
    signedAt: sql`(datetime('now'))`,
    signedName: body.name,
    signedIp: ip,
  }).where(eq(schema.estimates.id, est.id));

  return c.json({ ok: true, status: "approved" }, 200);
});

// POST /api/public/estimates/{token}/decline -> 'sent' -> 'declined'.
app.post("/api/public/estimates/:token/decline", async (c) => {
  const db = getDb(c.env);
  const token = c.req.param("token");
  const est = await db.select({ id: schema.estimates.id, status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.publicToken, token)).get();
  if (!est) return c.json({ error: "Not found" }, 404);
  if (est.status !== "sent") {
    if (est.status === "declined") return c.json({ error: "This estimate was already declined." }, 409);
    if (est.status === "approved") return c.json({ error: "This estimate has already been accepted." }, 409);
    return c.json({ error: `This estimate can no longer be declined (status: ${est.status}).` }, 409);
  }
  await db.update(schema.estimates).set({ status: "declined" }).where(eq(schema.estimates.id, est.id));
  return c.json({ ok: true, status: "declined" }, 200);
});

// ── Public customer HTML page (branded, self-contained) ────────────
// GET /p/e/{token}. A real Worker route returning text/html -- it takes
// precedence over the ASSETS/SPA fallback (Hono matches this route before the
// notFound handler defers to ASSETS). NOT the SPA (which is behind login).
app.get("/p/e/:token", async (c) => {
  const db = getDb(c.env);
  const token = c.req.param("token");
  const est = await estimateByToken(db, token);
  if (!est) {
    return c.html(customerErrorPage("Estimate not found", "This link is invalid or has expired. Please contact us for a new copy."), 404);
  }
  const lines = await db.select().from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, est.id)).orderBy(asc(schema.estimateLines.id)).all();
  return c.html(customerEstimatePage(token, est, lines));
});

// Branded "success"/"cancel" landing pages for the Stripe redirect (only
// reachable when Stripe is configured, but harmless static pages otherwise).
app.get("/pay/success", (c) => c.html(payResultPage(true)));
app.get("/pay/cancel", (c) => c.html(payResultPage(false)));

// ── Customer-facing HTML (self-contained, on-brand navy/gold) ──────
// These render the trustworthy homeowner-facing document. Inline CSS + inline
// vanilla JS (the SPA is behind login and can't be reused here). Function
// declarations so they're hoisted above the routes that call them.

// Server-side money/date formatters for the HTML (mirror the client's
// format.ts -- self-contained so no cross-boundary import is needed).
function htmlMoney(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function htmlDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
// HTML-escape for interpolating DB text into the page.
function esc(s: string | null | undefined): string {
  return escapeHtml(s || "");
}

// Validates a brand color is a strict "#rgb"/"#rrggbb" hex string before it
// gets interpolated into a raw <style> block (see customerPageShell) --
// writes are already validated by zHexColor, but this is the last line of
// defense against a bad/malicious value already sitting in the DB (e.g. from
// before validation existed, or a future write path that forgets to use
// zHexColor) turning into stored XSS on this unauthenticated customer page.
function safeCssHex(hex: string | null | undefined, fallback: string): string {
  return hex && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex) ? hex : fallback;
}

// Shared page chrome (doctype, brand colors, base CSS). `body` is the inner
// HTML; primary/secondary are the brand hex colors.
function customerPageShell(title: string, primary: string, secondary: string, body: string): string {
  const safePrimary = safeCssHex(primary, "#1a2b4a");
  const safeSecondary = safeCssHex(secondary, "#c9a227");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  :root { --navy:${safePrimary}; --gold:${safeSecondary}; }
  * { box-sizing: border-box; }
  body { margin:0; background:#eef1f5; color:#1c2333; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 18px 60px; }
  .doc { background:#fff; border-radius:14px; box-shadow:0 10px 40px rgba(20,34,59,.10), 0 2px 6px rgba(20,34,59,.06); overflow:hidden; }
  .letterhead { background: linear-gradient(180deg, var(--navy), #14223b); color:#fff; padding: 26px 30px; display:flex; justify-content:space-between; align-items:flex-start; gap:18px; border-bottom:3px solid var(--gold); }
  .letterhead .org { display:flex; gap:14px; align-items:center; }
  .letterhead img { height:46px; width:auto; border-radius:8px; background:#fff; padding:3px; }
  .org-name { font-size:20px; font-weight:700; letter-spacing:-.01em; }
  .org-meta { font-size:12.5px; color:#c9d2e2; margin-top:2px; }
  .doc-title { text-align:right; }
  .doc-title .t { font-size:22px; font-weight:700; color:var(--gold); letter-spacing:.02em; }
  .doc-title .s { font-size:12.5px; color:#c9d2e2; margin-top:3px; }
  .body { padding: 26px 30px 30px; }
  .billto-label { font-size:11px; font-weight:700; letter-spacing:.06em; color:#8b93a5; text-transform:uppercase; }
  .billto-name { font-size:16px; font-weight:700; margin-top:4px; color:#1c2333; }
  .billto-addr { font-size:13.5px; color:#5a6478; margin-top:2px; }
  table.lines { width:100%; border-collapse:collapse; margin-top:22px; font-size:14px; }
  table.lines th { text-align:left; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:#8b93a5; padding:0 0 8px; border-bottom:2px solid #eceef2; }
  table.lines th.r, table.lines td.r { text-align:right; }
  table.lines td { padding:11px 0; border-bottom:1px solid #f0f2f5; vertical-align:top; }
  .totals { margin-top:18px; margin-left:auto; width:min(320px,100%); font-size:14px; }
  .totals .row { display:flex; justify-content:space-between; padding:5px 0; color:#5a6478; }
  .totals .grand { border-top:2px solid var(--navy); margin-top:6px; padding-top:10px; font-size:18px; font-weight:700; color:var(--navy); }
  .financing { margin-top:20px; }
  .financing a { display:inline-flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; color:#8a6d12; background:rgba(201,162,39,.12); border:1px solid rgba(201,162,39,.35); padding:9px 14px; border-radius:8px; text-decoration:none; }
  .notes { margin-top:22px; font-size:13.5px; color:#5a6478; }
  .notes .lbl { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#8b93a5; margin-bottom:4px; }
  .actions { margin-top:26px; padding-top:24px; border-top:1px dashed #d8dde5; }
  .actions h3 { margin:0 0 4px; font-size:17px; color:var(--navy); }
  .actions p { margin:0 0 16px; font-size:13.5px; color:#5a6478; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:12.5px; font-weight:600; color:#3a4256; margin-bottom:6px; }
  .field input[type=text] { width:100%; padding:11px 12px; font-size:15px; border:1px solid #cdd3dd; border-radius:8px; }
  .field input[type=text]:focus { outline:none; border-color:var(--navy); box-shadow:0 0 0 3px rgba(26,43,74,.12); }
  .sigpad-wrap { border:1px solid #cdd3dd; border-radius:8px; background:#fcfcfd; position:relative; }
  canvas#sig { width:100%; height:170px; display:block; touch-action:none; border-radius:8px; }
  .sig-hint { position:absolute; left:14px; top:12px; font-size:12.5px; color:#aeb5c2; pointer-events:none; }
  .sig-clear { position:absolute; right:10px; bottom:8px; font-size:12px; color:#5a6478; background:#fff; border:1px solid #d8dde5; border-radius:6px; padding:4px 10px; cursor:pointer; }
  .btnrow { display:flex; gap:12px; margin-top:20px; flex-wrap:wrap; }
  .btn { flex:1; min-width:150px; padding:13px 18px; font-size:15px; font-weight:600; border-radius:9px; border:none; cursor:pointer; }
  .btn-accept { background:var(--navy); color:#fff; }
  .btn-accept:hover { background:#14223b; }
  .btn-decline { background:#fff; color:#8a3b3b; border:1px solid #e3c6c6; }
  .btn:disabled { opacity:.6; cursor:default; }
  .state { margin-top:24px; padding:18px 20px; border-radius:10px; font-size:14.5px; }
  .state.ok { background:#e8f2ec; color:#256b43; border:1px solid #bfe0cd; }
  .state.no { background:#fbecec; color:#8a3b3b; border:1px solid #edcccc; }
  .state .big { font-weight:700; font-size:16px; display:block; margin-bottom:3px; }
  .err { margin-top:12px; color:#a12f2f; font-size:13.5px; display:none; }
  .downloadrow { margin-top:20px; text-align:center; }
  .downloadrow a { font-size:13px; color:var(--navy); font-weight:600; text-decoration:none; border-bottom:1px solid rgba(26,43,74,.3); }
  .foot { text-align:center; font-size:12px; color:#8b93a5; margin-top:22px; }
</style>
</head><body><div class="wrap">${body}</div></body></html>`;
}

function customerErrorPage(heading: string, message: string): string {
  const body = `<div class="doc"><div class="letterhead"><div class="org"><div><div class="org-name">Noble Tampa</div><div class="org-meta">Tampa, FL</div></div></div></div>
  <div class="body"><div class="state no"><span class="big">${esc(heading)}</span>${esc(message)}</div></div></div>
  <div class="foot">Noble Tampa · Tampa, FL</div>`;
  return customerPageShell(heading, "#1a2b4a", "#c9a227", body);
}

function payResultPage(success: boolean): string {
  const body = `<div class="doc"><div class="letterhead"><div class="org"><div><div class="org-name">Noble Tampa</div><div class="org-meta">Tampa, FL</div></div></div></div>
  <div class="body"><div class="state ${success ? "ok" : "no"}"><span class="big">${success ? "Payment received — thank you!" : "Payment canceled"}</span>${success ? "Your payment was processed successfully. A receipt has been recorded on your invoice." : "No charge was made. You can return and try again whenever you're ready."}</div></div></div>
  <div class="foot">Noble Tampa · Tampa, FL</div>`;
  return customerPageShell(success ? "Payment received" : "Payment canceled", "#1a2b4a", "#c9a227", body);
}

// The full customer estimate page. `est` is the estimateByToken row; `lines`
// its estimate_lines. Renders the interactive signature pad + accept/decline
// only when status === 'sent'; otherwise a read-only already-accepted/declined
// state.
function customerEstimatePage(
  token: string,
  est: NonNullable<Awaited<ReturnType<typeof estimateByToken>>>,
  lines: (typeof schema.estimateLines.$inferSelect)[],
): string {
  const primary = est.brandColorPrimary || "#1a2b4a";
  const secondary = est.brandColorSecondary || "#c9a227";
  const brandName = est.brandName || "Noble Tampa";
  const logo = est.brandLogoKey ? `<img src="/api/r2/${esc(est.brandLogoKey)}" alt="${esc(brandName)}">` : "";

  // est/lines are raw DB rows (money in cents) -- htmlMoney formats decimal
  // dollars, so convert every money value at this boundary, right before
  // rendering, exactly like the JSON /api/public/estimates/{token} route does.
  const linesHtml = lines.map((l) => `
    <tr>
      <td>${esc(l.description)}</td>
      <td class="r">${l.quantity ?? 0}</td>
      <td class="r">${htmlMoney(fromCentsNullable(l.unitPrice))}</td>
      <td class="r">${htmlMoney(fromCentsNullable(l.total))}</td>
    </tr>`).join("");

  const taxRow = (est.taxRate || 0) > 0
    ? `<div class="row"><span>Tax (${est.taxRate}%)</span><span>${htmlMoney(fromCentsNullable(est.taxAmount))}</span></div>`
    : "";

  const notesHtml = est.notes && est.notes.trim()
    ? `<div class="notes"><div class="lbl">Notes</div>${esc(est.notes)}</div>`
    : "";

  // The action zone depends on status.
  let actionZone: string;
  if (est.status === "sent") {
    // Interactive: name input + signature canvas + Accept/Decline.
    actionZone = `
    <div class="actions" id="action-zone">
      <h3>Accept this estimate</h3>
      <p>Sign below and enter your name to approve the work. Prefer not to move forward? You can decline.</p>
      <div class="field">
        <label for="name">Your full name</label>
        <input type="text" id="name" placeholder="e.g. Jane Homeowner" autocomplete="name">
      </div>
      <div class="field">
        <label>Signature</label>
        <div class="sigpad-wrap">
          <canvas id="sig"></canvas>
          <span class="sig-hint" id="sig-hint">Draw your signature here</span>
          <button type="button" class="sig-clear" id="sig-clear">Clear</button>
        </div>
      </div>
      <div class="err" id="err"></div>
      <div class="btnrow">
        <button class="btn btn-accept" id="btn-accept">Accept &amp; Sign</button>
        <button class="btn btn-decline" id="btn-decline">Decline</button>
      </div>
    </div>`;
  } else if (est.status === "approved" || est.status === "converted") {
    const who = est.signedName ? ` by ${esc(est.signedName)}` : "";
    const when = est.signedAt ? ` on ${htmlDate(est.signedAt)}` : (est.approvedAt ? ` on ${htmlDate(est.approvedAt)}` : "");
    actionZone = `<div class="state ok"><span class="big">This estimate has been accepted${when ? "" : ""}.</span>Accepted${who}${when}. Thank you — we'll be in touch to schedule your work.</div>`;
  } else if (est.status === "declined") {
    actionZone = `<div class="state no"><span class="big">This estimate was declined.</span>If this was a mistake or you'd like to revisit it, please contact us.</div>`;
  } else {
    // draft/expired or anything else: read-only, no actions.
    actionZone = `<div class="state no"><span class="big">This estimate isn't available for approval.</span>Please contact us for an up-to-date copy.</div>`;
  }

  const body = `
  <div class="doc">
    <div class="letterhead">
      <div class="org">${logo}<div><div class="org-name">${esc(brandName)}</div><div class="org-meta">Tampa, FL</div></div></div>
      <div class="doc-title"><div class="t">ESTIMATE</div><div class="s">${esc(est.identifier || "")}</div><div class="s">${htmlDate(est.createdAt)}</div></div>
    </div>
    <div class="body">
      <div class="billto-label">Prepared for</div>
      <div class="billto-name">${esc(est.customerName || "")}</div>
      ${est.customerAddress && est.customerAddress.trim() ? `<div class="billto-addr">${esc(est.customerAddress)}</div>` : ""}

      <table class="lines">
        <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Total</th></tr></thead>
        <tbody>${linesHtml}</tbody>
      </table>

      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${htmlMoney(fromCentsNullable(est.subtotal))}</span></div>
        ${taxRow}
        <div class="row grand"><span>Total</span><span>${htmlMoney(fromCentsNullable(est.total))}</span></div>
      </div>

      <div class="financing"><a href="${esc(ACORN_FINANCE_URL)}" target="_blank" rel="noopener noreferrer">Financing available — pre-qualify now</a></div>

      ${notesHtml}
      ${actionZone}

      <div class="downloadrow"><a href="/api/public/estimates/${esc(token)}/pdf" target="_blank" rel="noopener">Download PDF copy</a></div>
    </div>
  </div>
  <div class="foot">${esc(brandName)} · Tampa, FL</div>

  <script>
  (function(){
    var token = ${JSON.stringify(token)};
    var canvas = document.getElementById('sig');
    if (!canvas) return; // read-only state, no pad
    var hint = document.getElementById('sig-hint');
    var errEl = document.getElementById('err');
    var accept = document.getElementById('btn-accept');
    var decline = document.getElementById('btn-decline');
    var clearBtn = document.getElementById('sig-clear');
    var ctx = canvas.getContext('2d');
    var drawing = false, hasInk = false, last = null;

    function resize(){
      var ratio = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);
      ctx.lineWidth = 2.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#1c2333';
    }
    // Delay initial size to after layout.
    setTimeout(resize, 0);
    window.addEventListener('resize', resize);

    function pos(e){
      var rect = canvas.getBoundingClientRect();
      var p = (e.touches && e.touches[0]) ? e.touches[0] : e;
      return { x: p.clientX - rect.left, y: p.clientY - rect.top };
    }
    function start(e){ e.preventDefault(); drawing = true; last = pos(e); if(hint) hint.style.display='none'; }
    function move(e){ if(!drawing) return; e.preventDefault(); var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last = p; hasInk = true; }
    function end(e){ if(drawing){ e.preventDefault(); } drawing = false; }

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);

    clearBtn.addEventListener('click', function(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; if(hint) hint.style.display=''; });

    function showErr(m){ errEl.textContent = m; errEl.style.display='block'; }
    function lock(){ accept.disabled = true; decline.disabled = true; }
    function unlock(){ accept.disabled = false; decline.disabled = false; }

    function replaceZone(cls, big, msg){
      var z = document.getElementById('action-zone');
      z.innerHTML = '<div class="state '+cls+'"><span class="big">'+big+'</span>'+msg+'</div>';
    }

    accept.addEventListener('click', function(){
      errEl.style.display='none';
      var name = (document.getElementById('name').value||'').trim();
      if(!name){ showErr('Please enter your name.'); return; }
      if(!hasInk){ showErr('Please sign in the box above before accepting.'); return; }
      var sig = canvas.toDataURL('image/png');
      lock(); accept.textContent = 'Submitting…';
      fetch('/api/public/estimates/'+encodeURIComponent(token)+'/accept', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: name, signature: sig })
      }).then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){
        if(!res.ok){ unlock(); accept.textContent='Accept & Sign'; showErr(res.d.error || 'Could not accept. Please try again.'); return; }
        replaceZone('ok','Thank you — estimate accepted!','Your signature was recorded. We\\'ll reach out soon to schedule your work.');
      }).catch(function(){ unlock(); accept.textContent='Accept & Sign'; showErr('Network error. Please try again.'); });
    });

    decline.addEventListener('click', function(){
      errEl.style.display='none';
      lock(); decline.textContent = 'Submitting…';
      fetch('/api/public/estimates/'+encodeURIComponent(token)+'/decline', { method:'POST' })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){
        if(!res.ok){ unlock(); decline.textContent='Decline'; showErr(res.d.error || 'Could not decline. Please try again.'); return; }
        replaceZone('no','Estimate declined','Thank you for letting us know. Contact us anytime if you change your mind.');
      }).catch(function(){ unlock(); decline.textContent='Decline'; showErr('Network error. Please try again.'); });
    });
  })();
  </script>`;

  return customerPageShell(`Estimate ${est.identifier || ""} — ${brandName}`, primary, secondary, body);
}

// ── Global error handler ───────────────────────────────────────────
// Any error that bubbles out of a route (including Zod validation failures
// that OpenAPIHono re-throws, and raw D1 constraint errors) lands here. We
// return a clean JSON { error } shape and NEVER leak a stack trace or internal
// SQL text to the client.
//
//   - D1 FK / constraint / NOT NULL failures -> 400 with a friendly message
//     (these are almost always bad client input -- e.g. a dangling FK id that
//     slipped past an existence check, or a uniqueness clash).
//   - HTTPException / anything carrying an explicit status -> that status.
//   - everything else -> 500 with a generic message.
app.onError((err, c) => {
  console.error(`[onError] ${c.req.method} ${c.req.path}:`, err);

  // Hono's HTTPException (and better-call's APIError from better-auth) carry a
  // status + a getResponse()/toResponse(). Respect an explicit status if one
  // is present, but still scrub the body to our { error } shape.
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 600) {
    const message = (err as { message?: string }).message || "Request failed";
    return c.json({ error: message }, status as 400);
  }

  // Map raw D1 constraint failures to a 400 rather than a 500. SQLite surfaces
  // these as messages containing "FOREIGN KEY constraint failed", "UNIQUE
  // constraint failed", "NOT NULL constraint failed", etc. Drizzle wraps the
  // real error in a DrizzleQueryError whose top-level .message is just
  // "Failed query: ..." -- the constraint text lives on err.cause (and
  // sometimes err.cause.cause), so walk the whole cause chain, not just the
  // top message.
  let msg = "";
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    msg += " " + String((e as { message?: string }).message || "");
    e = (e as { cause?: unknown }).cause;
  }
  if (/constraint failed|SQLITE_CONSTRAINT/i.test(msg)) {
    if (/FOREIGN KEY/i.test(msg)) {
      return c.json({ error: "Referenced record does not exist." }, 400);
    }
    if (/UNIQUE/i.test(msg)) {
      return c.json({ error: "That record already exists (duplicate value)." }, 400);
    }
    return c.json({ error: "Invalid data -- a required field is missing or invalid." }, 400);
  }

  // Unexpected: generic 500, no internal detail leaked.
  return c.json({ error: "Internal server error" }, 500);
});

// 404 for any unmatched /api/* route -- a clean JSON shape rather than the
// SPA-fallback HTML the ASSETS binding would otherwise serve.
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  // Non-API paths fall through to the static-asset / SPA handler.
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

  // Daily 6am UTC (see wrangler.jsonc's triggers.crons) -- generates jobs
  // for any active service_agreements whose next_run_date has arrived and
  // advances each one to its next due date, AND flips any now-past-due "sent"
  // invoices to "overdue". Shares processDueServiceAgreements/
  // updateOverdueInvoices with the manual POST /api/service-agreements/
  // run-due-now route and the stats route respectively so all paths run
  // identical logic.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const result = await processDueServiceAgreements(env);
        console.log(`[scheduled] processed ${result.processed} due service agreement(s), created jobs: ${result.created_job_ids.join(", ") || "none"}`);
        const flipped = await updateOverdueInvoices(env);
        console.log(`[scheduled] flipped ${flipped} invoice(s) to overdue`);
      })()
    );
  },

  // Consumes reminder messages enqueued by createJob/updateJob (see
  // enqueueJobReminder above) off the "westchase-reminders" queue. Points at
  // notify.ts so it becomes REAL when keys are added, staying an HONEST no-op
  // when they aren't:
  //   - If RESEND_API_KEY (+ RESEND_FROM) is set AND the job's customer has an
  //     email, sendEmail actually sends a reminder and we record a "reminder
  //     sent" job note.
  //   - If no provider is configured (or no customer email), sendEmail returns
  //     { sent:false, reason } WITHOUT pretending to send, and we record an
  //     honest "reminder queued — not sent (reason)" note. Either way the
  //     intent is durable and inspectable on the job detail view.
  async queue(batch: MessageBatch<ReminderMessage>, env: Env) {
    const db = getDb(env);
    for (const message of batch.messages) {
      try {
        const { job_id, scheduled_date } = message.body;
        // Look up the job's customer + brand for a personalized reminder.
        const job = await db
          .select({
            identifier: schema.jobs.identifier,
            customerName: schema.customers.name,
            customerEmail: schema.customers.email,
            brandName: schema.brands.name,
          })
          .from(schema.jobs)
          .leftJoin(schema.customers, eq(schema.jobs.customerId, schema.customers.id))
          .leftJoin(schema.brands, eq(schema.jobs.brandId, schema.brands.id))
          .where(eq(schema.jobs.id, job_id))
          .get();
        const brand = job?.brandName || "Noble Tampa";
        const result = await sendEmail(env, {
          to: job?.customerEmail || "",
          subject: `Reminder: your ${brand} appointment on ${scheduled_date}`,
          html:
            `<div style="font-family:Georgia,serif;color:#1a2b4a">` +
            `<p>Hi ${escapeHtml(job?.customerName || "there")},</p>` +
            `<p>This is a friendly reminder about your upcoming appointment (${escapeHtml(job?.identifier || "")}) scheduled for <strong>${escapeHtml(scheduled_date)}</strong>.</p>` +
            `<p>Thank you,<br>${escapeHtml(brand)} — Tampa, FL</p></div>`,
          text: `Reminder: your ${brand} appointment ${job?.identifier || ""} is scheduled for ${scheduled_date}.`,
        });
        await db.insert(schema.jobNotes).values({
          jobId: job_id,
          content: result.sent
            ? `Reminder email sent to the customer for ${scheduled_date}.`
            : `Reminder queued for ${scheduled_date} — not sent (${result.reason || "no provider"}).`,
        });
        message.ack();
      } catch (err) {
        console.error(`Failed to process reminder message for job ${message.body.job_id}:`, err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, ReminderMessage>;
