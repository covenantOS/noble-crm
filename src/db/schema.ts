// Drizzle schema for the Westchase Painting field service app (Cloudflare D1).
//
// The "PORTED" section is a column-for-column translation of the real
// src/server/schema.sql (verified against the actual file, not assumed).
// Integer flag columns (active, checked, is_recurring) are kept as raw
// integer (0/1), NOT drizzle's `{ mode: 'boolean' }` -- the existing API
// contract in src/server/index.ts returns/accepts these as JSON numbers
// (e.g. TechnicianSchema.active: z.number().int()), and switching to
// boolean mode would change the wire format and break API parity.
//
// The "NEW" section adds the painting-domain tables from the build plan
// (brands, estimates, attachments, payments, service_agreements) now,
// even though they're not wired into any routes until Phase 3. They're
// inert until used, and this avoids a second schema-diff migration later.
//
// Money stays REAL (decimal) to match the original. Move to integer cents
// only in a deliberate migration, not silently.

import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const nowTimestamp = () => sql`(datetime('now'))`;

/* =========================================================================
 * PORTED FROM open-fieldservice src/server/schema.sql (Phase 1)
 * ========================================================================= */

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  notes: text('notes').notNull().default(''),
  // NEW (lead pipeline): where the customer sits in the sales funnel and how
  // they came in. status is a required text enum-in-practice (lead|active|
  // inactive) defaulting to 'lead' so every new customer starts as a lead;
  // source is nullable (referral|google|repeat|website|other) since it may be
  // unknown at creation. Neither auto-transitions -- the office sets them.
  status: text('status').notNull().default('lead'),
  source: text('source'),
  createdAt: text('created_at').default(nowTimestamp()),
  updatedAt: text('updated_at').default(nowTimestamp()),
  // NEW (Phase 5): map to a Stripe customer once payments are live.
  stripeCustomerId: text('stripe_customer_id'),
}, (table) => [
  index('idx_customers_name').on(table.name),
]);

export const technicians = sqliteTable('technicians', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  color: text('color').notNull().default('#16a34a'),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').default(nowTimestamp()),
  // NEW (Phase 2): link a crew member to their better-auth user (string id).
  userId: text('user_id'),
});

export const serviceTypes = sqliteTable('service_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  defaultDuration: integer('default_duration').notNull().default(60),
  defaultPrice: real('default_price').notNull().default(0),
  color: text('color').notNull().default('#6b7280'),
  createdAt: text('created_at').default(nowTimestamp()),
  // NEW (Phase 3): which brand this service belongs to.
  brandId: integer('brand_id').references(() => brands.id),
});

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  identifier: text('identifier').notNull().unique(),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  technicianId: integer('technician_id').references(() => technicians.id, { onDelete: 'set null' }),
  serviceTypeId: integer('service_type_id').references(() => serviceTypes.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('scheduled'),
  priority: text('priority').notNull().default('normal'),
  scheduledDate: text('scheduled_date').notNull().default(sql`(date('now'))`),
  scheduledTime: text('scheduled_time').default('09:00'),
  duration: integer('duration').notNull().default(60),
  price: real('price').notNull().default(0),
  address: text('address').default(''),
  notes: text('notes').default(''),
  completionNotes: text('completion_notes').default(''),
  isRecurring: integer('is_recurring').notNull().default(0),
  recurrenceInterval: text('recurrence_interval').default(''),
  nextRecurrenceDate: text('next_recurrence_date').default(''),
  createdAt: text('created_at').default(nowTimestamp()),
  updatedAt: text('updated_at').default(nowTimestamp()),
  // NEW (Phase 3): brand tag for reporting + customer-facing docs.
  brandId: integer('brand_id').references(() => brands.id),
}, (table) => [
  index('idx_jobs_customer').on(table.customerId),
  index('idx_jobs_technician').on(table.technicianId),
  index('idx_jobs_service_type').on(table.serviceTypeId),
  index('idx_jobs_status').on(table.status),
  index('idx_jobs_scheduled_date').on(table.scheduledDate),
]);

export const jobNotes = sqliteTable('job_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at').default(nowTimestamp()),
}, (table) => [
  index('idx_job_notes_job').on(table.jobId),
]);

export const jobChecklist = sqliteTable('job_checklist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  checked: integer('checked').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_job_checklist_job').on(table.jobId),
]);

export const materials = sqliteTable('materials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('ea'),
  unitCost: real('unit_cost').notNull().default(0),
  inStock: real('in_stock').notNull().default(0),
  createdAt: text('created_at').default(nowTimestamp()),
});

export const jobMaterials = sqliteTable('job_materials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  materialId: integer('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  quantity: real('quantity').notNull().default(1),
  unitCost: real('unit_cost').notNull().default(0),
}, (table) => [
  index('idx_job_materials_job').on(table.jobId),
]);

export const invoices = sqliteTable('invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  identifier: text('identifier').notNull().unique(),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  subtotal: real('subtotal').notNull().default(0),
  taxRate: real('tax_rate').notNull().default(0),
  taxAmount: real('tax_amount').notNull().default(0),
  total: real('total').notNull().default(0),
  notes: text('notes').default(''),
  dueDate: text('due_date').default(''),
  paidDate: text('paid_date').default(''),
  createdAt: text('created_at').default(nowTimestamp()),
  updatedAt: text('updated_at').default(nowTimestamp()),
  // NEW (Phase 3): brand tag.
  brandId: integer('brand_id').references(() => brands.id),
}, (table) => [
  index('idx_invoices_customer').on(table.customerId),
  index('idx_invoices_job').on(table.jobId),
  index('idx_invoices_status').on(table.status),
]);

export const invoiceLines = sqliteTable('invoice_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unitPrice: real('unit_price').notNull().default(0),
  total: real('total').notNull().default(0),
}, (table) => [
  index('idx_invoice_lines_invoice').on(table.invoiceId),
]);

// Auto-incrementing identifier counter (JOB-N / INV-N). Internal to the
// server layer -- not exposed through the API.
export const meta = sqliteTable('_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/* =========================================================================
 * NEW: Westchase Painting domain (Phases 3 to 5) -- inert until those
 * phases wire up routes against them.
 * ========================================================================= */

export const brands = sqliteTable('brands', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  colorPrimary: text('color_primary'),
  colorSecondary: text('color_secondary'),
  logoR2Key: text('logo_r2_key'),
  active: integer('active').notNull().default(1),
});

export const estimates = sqliteTable('estimates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  identifier: text('identifier'),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  brandId: integer('brand_id').references(() => brands.id),
  // draft | sent | approved | declined | expired
  status: text('status').notNull().default('draft'),
  subtotal: real('subtotal').default(0),
  taxRate: real('tax_rate').default(0),
  taxAmount: real('tax_amount').default(0),
  total: real('total').default(0),
  validUntil: text('valid_until'),
  notes: text('notes'),
  signatureR2Key: text('signature_r2_key'),
  approvedAt: text('approved_at'),
  createdAt: text('created_at').default(nowTimestamp()).notNull(),
  // NEW (Phase 5 customer loop): unguessable random token minted when an
  // estimate is SENT, used to gate the public /p/e/{token} customer view and
  // the /api/public/estimates/{token}/* endpoints. Nullable until sent.
  publicToken: text('public_token'),
  // Customer-acceptance audit trail, written by the public accept endpoint:
  // when they signed (full timestamp), the name they typed on the signature
  // pad, and their best-effort request IP. The signature IMAGE itself is
  // stored in R2 and pointed at by signatureR2Key (already defined above).
  signedAt: text('signed_at'),
  signedName: text('signed_name'),
  signedIp: text('signed_ip'),
  // NEW (painting-realism pass): optional deposit amount, set by office/
  // admin/estimator while the estimate is draft/sent/approved. Validated
  // server-side to never exceed the estimate total. When set (> 0) AND the
  // estimate is converted to a job, a second "Deposit" invoice is minted
  // alongside the normal full-value invoice (see /api/estimates/{id}/convert).
  depositAmount: real('deposit_amount'),
});

export const estimateLines = sqliteTable('estimate_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  description: text('description').notNull(),
  quantity: real('quantity').default(1),
  unitPrice: real('unit_price').default(0),
  total: real('total').default(0),
});

// NEW (painting-realism pass): structured estimate builder. A room groups
// one or more surfaces; each surface carries the painting-specific spec
// (prep/coats/paint product) plus its own labor/material cost split. Only
// editable while the parent estimate is 'draft' (mirrors the existing
// edit-lock pattern for paid/cancelled invoices) -- once sent/approved/
// converted the breakdown is frozen, read-only. Every room/surface mutation
// auto-syncs a matching row in estimate_lines (one generated line per
// surface) so subtotal/tax/total, PDF generation, and the convert-to-job
// pipeline keep working unmodified against estimate_lines as the source of
// truth for totals -- see syncEstimateLinesFromBuilder in index.ts.
export const estimateRooms = sqliteTable('estimate_rooms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_estimate_rooms_estimate').on(table.estimateId),
]);

export const estimateSurfaces = sqliteTable('estimate_surfaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roomId: integer('room_id').notNull().references(() => estimateRooms.id, { onDelete: 'cascade' }),
  // Free text, not a rigid enum -- this is a painting/cabinet business and
  // surface types vary (wall/ceiling/trim/doors/cabinets/exterior siding/...).
  surfaceType: text('surface_type').notNull(),
  // sqft or linear ft depending on surface_type -- the unit itself isn't
  // stored, it's implied by surface_type/context (same free-text approach).
  measurement: real('measurement').notNull().default(0),
  prepNotes: text('prep_notes'),
  coats: integer('coats').notNull().default(2),
  paintProduct: text('paint_product'),
  laborCost: real('labor_cost').notNull().default(0),
  materialCost: real('material_cost').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  // The estimate_lines row generated FROM this surface (see
  // syncEstimateLinesFromBuilder) -- lets an edit/delete find and update/
  // remove its own generated line directly instead of doing a fragile
  // description-text match. Nullable because it's set right after the
  // line insert, not atomically in the same statement.
  generatedLineId: integer('generated_line_id'),
}, (table) => [
  index('idx_estimate_surfaces_room').on(table.roomId),
]);

// NEW (painting-realism pass): change orders against an in-flight job.
// Money-adjacent like invoices/estimates -- technicians get zero access
// (blocked by the blanket role-gate in index.ts, same as /api/invoices and
// /api/estimates). On approval the change-order amount is added as a new
// line to the job's most recent non-paid/non-cancelled invoice (draft/sent),
// or a new invoice is created for just that amount if none qualifies.
export const changeOrders = sqliteTable('change_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount: real('amount').notNull().default(0),
  // pending | approved | rejected
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').default(nowTimestamp()).notNull(),
}, (table) => [
  index('idx_change_orders_job').on(table.jobId),
]);

export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // job | estimate | customer
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  // before | after | doc | signature
  kind: text('kind').notNull().default('doc'),
  r2Key: text('r2_key').notNull(),
  filename: text('filename'),
  contentType: text('content_type'),
  uploadedBy: text('uploaded_by'), // better-auth user id (string)
  createdAt: text('created_at').default(nowTimestamp()).notNull(),
});

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  // cash | check | card | financing
  method: text('method').notNull(),
  amount: real('amount').notNull().default(0),
  surchargeAmount: real('surcharge_amount').default(0),
  processorRef: text('processor_ref'), // Stripe payment intent / charge id
  // pending | paid | failed | refunded
  status: text('status').notNull().default('pending'),
  paidAt: text('paid_at'),
  createdAt: text('created_at').default(nowTimestamp()).notNull(),
});

export const serviceAgreements = sqliteTable('service_agreements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  brandId: integer('brand_id').references(() => brands.id),
  serviceTypeId: integer('service_type_id').references(() => serviceTypes.id),
  // weekly | monthly | quarterly | annual
  interval: text('interval').notNull(),
  nextRunDate: text('next_run_date'),
  // Target day-of-month (1-31) this agreement recurs on, fixed at creation
  // from the initial next_run_date. Kept separate from next_run_date so a
  // monthly/quarterly/annual advance that has to clamp for a short month
  // (e.g. day 31 -> Feb 28) doesn't permanently lose the original day --
  // each advance re-clamps THIS anchor against whatever the target month
  // actually has, rather than compounding drift off the previous clamp.
  anchorDay: integer('anchor_day'),
  active: integer('active').notNull().default(1),
});

/* =========================================================================
 * AUTH (Phase 2)
 * better-auth generates its own tables. Generate them with:
 *   pnpm dlx @better-auth/cli generate --output ./src/db/auth-schema.ts
 * then uncomment the line below so drizzle-kit picks them up in migrations.
 * ========================================================================= */
export * from './auth-schema';
