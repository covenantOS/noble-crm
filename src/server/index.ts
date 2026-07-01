import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, asc, desc, eq, like, or, sql, inArray } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { createAuth } from "../lib/auth.js";
import type { AppBindings } from "../lib/types.js";

const app = new OpenAPIHono<AppBindings>();

// ── Auth ───────────────────────────────────────────────────────────
// better-auth owns everything under /api/auth/* (sign-up, sign-in, sign-out,
// session, etc). Mounted before the auth-required middleware below, and the
// middleware explicitly skips this prefix, so these routes stay public.
app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// All other /api/* routes require a session. Resolves the better-auth
// session from the request cookie and attaches a normalized user onto
// Hono's context for downstream handlers/authorization checks.
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) {
    return next();
  }
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", {
    id: session.user.id,
    role: (session.user as { role?: string }).role || "office",
    name: session.user.name,
    email: session.user.email,
  });
  await next();
});

// Blanket role gate for technicians on whole resource families that are
// off-limits to them regardless of ownership (customers, technicians,
// invoices) and on mutating materials/service-types routes (read-only is
// fine for the dashboard, so GET is allowed through). Per-job ownership
// checks (jobs, notes, checklist, job-materials) are handled per-route below
// via requireOwnJobOrForbid since they depend on which job is involved.
app.use("/api/*", async (c, next) => {
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
  if (path.startsWith("/api/invoices") || /^\/api\/jobs\/[^/]+\/invoice$/.test(path)) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Estimates are a sales/estimating task (admin, office, estimator) --
  // technicians get no access at all, matching the invoices block above.
  if (path.startsWith("/api/estimates") || path.startsWith("/api/estimate-lines")) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (isMutating && (path.startsWith("/api/materials") || path.startsWith("/api/service-types"))) {
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

// For technician-restricted mutating routes: confirms the job identified by
// jobId belongs to the requester's own technician. Returns a Response to
// short-circuit with (403 forbidden) if not, or null if the caller may proceed.
async function requireOwnJobOrForbid(c: Context<AppBindings>, db: ReturnType<typeof getDb>, jobId: number) {
  const user = c.get("user");
  const ownTechId = await getOwnTechnicianId(db, user.id);
  const job = await db.select({ technicianId: schema.jobs.technicianId }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job || ownTechId === null || job.technicianId !== ownTechId) {
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

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

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
  customer_name: z.string().nullable().optional(),
  brand_name: z.string().nullable().optional(),
  brand_color_primary: z.string().nullable().optional(),
  brand_color_secondary: z.string().nullable().optional(),
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

const JobNoteSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  content: z.string(),
  created_at: z.string(),
}).openapi("JobNote");

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
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Job");

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

async function nextIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "identifier_prefix")).get();
  const counterRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "job_counter")).get();
  const next = parseInt(counterRow?.value || "0", 10) + 1;
  await db.update(schema.meta).set({ value: String(next) }).where(eq(schema.meta.key, "job_counter"));
  return `${prefixRow?.value || "JOB"}-${next}`;
}

async function nextInvoiceIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "invoice_prefix")).get();
  const counterRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "invoice_counter")).get();
  const next = parseInt(counterRow?.value || "0", 10) + 1;
  await db.update(schema.meta).set({ value: String(next) }).where(eq(schema.meta.key, "invoice_counter"));
  return `${prefixRow?.value || "INV"}-${next}`;
}

async function nextEstimateIdentifier(db: ReturnType<typeof getDb>): Promise<string> {
  const prefixRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "estimate_prefix")).get();
  const counterRow = await db.select().from(schema.meta).where(eq(schema.meta.key, "estimate_counter")).get();
  const next = parseInt(counterRow?.value || "0", 10) + 1;
  await db.update(schema.meta).set({ value: String(next) }).where(eq(schema.meta.key, "estimate_counter"));
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

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
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
  },
});

app.openapi(getStats, async (c) => {
  const db = getDb(c.env);
  const jobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).get();
  const customers = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.customers).get();
  const technicians = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.technicians).where(eq(schema.technicians.active, 1)).get();
  const serviceTypes = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.serviceTypes).get();
  const today = new Date().toISOString().split("T")[0];
  const todayJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(eq(schema.jobs.scheduledDate, today)).get();
  const upcomingJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs)
    .where(and(inArray(schema.jobs.status, ["scheduled", "confirmed"]), sql`${schema.jobs.scheduledDate} >= ${today}`))
    .get();
  const completedJobs = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.jobs).where(eq(schema.jobs.status, "completed")).get();
  const revenue = await db.select({ total: sql<number>`COALESCE(SUM(${schema.jobs.price}), 0)` }).from(schema.jobs).where(eq(schema.jobs.status, "completed")).get();
  const invoicesOutstanding = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.invoices).where(inArray(schema.invoices.status, ["sent"])).get();
  const invoicesOverdue = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.invoices).where(eq(schema.invoices.status, "overdue")).get();
  return c.json({
    jobs: jobs?.count || 0,
    customers: customers?.count || 0,
    technicians: technicians?.count || 0,
    service_types: serviceTypes?.count || 0,
    today_jobs: todayJobs?.count || 0,
    upcoming_jobs: upcomingJobs?.count || 0,
    completed_jobs: completedJobs?.count || 0,
    revenue: revenue?.total || 0,
    invoices_outstanding: invoicesOutstanding?.count || 0,
    invoices_overdue: invoicesOverdue?.count || 0,
  }, 200);
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
    }),
  },
  responses: {
    200: {
      description: "Paginated job list",
      content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema), total: z.number().int() }) } },
    },
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
  if (q.search) {
    const s = `%${q.search}%`;
    conditions.push(or(
      like(schema.jobs.identifier, s),
      like(schema.customers.name, s),
      like(schema.jobs.address, s),
    ));
  }
  if (q.status) {
    conditions.push(eq(schema.jobs.status, q.status));
  }
  if (user.role === "technician") {
    // Force-filter to the requester's own technician id, overriding any
    // technician_id query param -- a technician may only ever see their own jobs.
    const ownTechId = await getOwnTechnicianId(db, user.id);
    if (ownTechId === null) {
      return c.json({ jobs: [], total: 0 }, 200);
    }
    conditions.push(eq(schema.jobs.technicianId, ownTechId));
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

  return c.json({ jobs, total: countRow?.count || 0 }, 200);
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
    if (ownTechId === null || job.technician_id !== ownTechId) {
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
  const notesOut = notes.map((n) => ({ id: n.id, job_id: n.jobId, content: n.content, created_at: n.createdAt ?? "" }));
  const checklistOut = checklist.map((ch) => ({ id: ch.id, job_id: ch.jobId, label: ch.label, checked: ch.checked, sort_order: ch.sortOrder }));
  return c.json({ job: { ...job, job_notes: notesOut, checklist: checklistOut, job_materials: jobMaterials } }, 200);
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
        status: z.string().optional(),
        priority: z.string().optional(),
        scheduled_date: z.string(),
        scheduled_time: z.string().optional(),
        duration: z.number().int().optional(),
        price: z.number().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        is_recurring: z.number().int().optional(),
        recurrence_interval: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: JobSchema } } },
  },
});

app.openapi(createJob, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
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
    price,
    address,
    notes: data.notes || "",
    isRecurring: data.is_recurring || 0,
    recurrenceInterval: data.recurrence_interval || "",
    brandId: data.brand_id ?? null,
  });

  const job = await jobJoinedSelect(db).where(eq(schema.jobs.identifier, identifier)).get();
  return c.json(job!, 201);
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
        status: z.string().optional(),
        priority: z.string().optional(),
        scheduled_date: z.string().optional(),
        scheduled_time: z.string().optional(),
        duration: z.number().int().optional(),
        price: z.number().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        completion_notes: z.string().optional(),
        is_recurring: z.number().int().optional(),
        recurrence_interval: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
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
  if (data.price !== undefined) updates.price = data.price;
  if (data.address !== undefined) updates.address = data.address;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.completion_notes !== undefined) updates.completionNotes = data.completion_notes;
  if (data.is_recurring !== undefined) updates.isRecurring = data.is_recurring;
  if (data.recurrence_interval !== undefined) updates.recurrenceInterval = data.recurrence_interval;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = sql`(datetime('now'))`;
    await db.update(schema.jobs).set(updates).where(eq(schema.jobs.id, idNum));
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
  },
});

app.openapi(addJobNote, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
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

// ── Customers ──────────────────────────────────────────────────────

const listCustomers = createRoute({
  method: "get",
  path: "/api/customers",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated customer list",
      content: { "application/json": { schema: z.object({ customers: z.array(CustomerSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listCustomers, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = undefined;
  if (q.search) {
    const s = `%${q.search}%`;
    where = or(
      like(schema.customers.name, s),
      like(schema.customers.email, s),
      like(schema.customers.phone, s),
      like(schema.customers.address, s),
    );
  }

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
      created_at: sql<string>`COALESCE(${schema.customers.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.customers.updatedAt}, '')`,
      job_count: sql<number>`COALESCE(${jobCountSub.cnt}, 0)`,
    })
    .from(schema.customers)
    .leftJoin(jobCountSub, eq(jobCountSub.customerId, schema.customers.id))
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
  responses: {
    200: {
      description: "All customers (for dropdowns)",
      content: { "application/json": { schema: z.object({ customers: z.array(z.object({ id: z.number().int(), name: z.string(), address: z.string() })) }) } },
    },
  },
});

app.openapi(listAllCustomers, async (c) => {
  const db = getDb(c.env);
  const customers = await db
    .select({ id: schema.customers.id, name: schema.customers.name, address: schema.customers.address })
    .from(schema.customers)
    .orderBy(asc(schema.customers.name))
    .all();
  return c.json({ customers }, 200);
});

const getCustomer = createRoute({
  method: "get",
  path: "/api/customers/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Customer detail", content: { "application/json": { schema: z.object({ customer: CustomerSchema, jobs: z.array(JobSchema) }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const customer = await db.select().from(schema.customers).where(eq(schema.customers.id, idNum)).get();
  if (!customer) return c.json({ error: "Customer not found" }, 404);
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
  return c.json({ customer: customerOut, jobs }, 200);
});

const createCustomer = createRoute({
  method: "post",
  path: "/api/customers",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        notes: z.string().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: CustomerSchema } } },
  },
});

app.openapi(createCustomer, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  await db.insert(schema.customers).values({
    name: data.name,
    email: data.email || "",
    phone: data.phone || "",
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    zip: data.zip || "",
    notes: data.notes || "",
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
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        notes: z.string().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(updateCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.email !== undefined) updates.email = data.email;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.address !== undefined) updates.address = data.address;
  if (data.city !== undefined) updates.city = data.city;
  if (data.state !== undefined) updates.state = data.state;
  if (data.zip !== undefined) updates.zip = data.zip;
  if (data.notes !== undefined) updates.notes = data.notes;
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
  },
});

app.openapi(deleteCustomer, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.customers).where(eq(schema.customers.id, toId(id)));
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
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        color: z.string().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TechnicianSchema } } },
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
  });
  const tech = await db.select().from(schema.technicians).orderBy(desc(schema.technicians.id)).limit(1).get();
  const techOut = {
    id: tech!.id,
    name: tech!.name,
    email: tech!.email,
    phone: tech!.phone,
    color: tech!.color,
    active: tech!.active,
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
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        color: z.string().optional(),
        active: z.number().int().optional(),
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
        name: z.string(),
        description: z.string().optional(),
        default_duration: z.number().int().optional(),
        default_price: z.number().optional(),
        color: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ServiceTypeSchema } } },
  },
});

app.openapi(createServiceType, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
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
        name: z.string().optional(),
        description: z.string().optional(),
        default_duration: z.number().int().optional(),
        default_price: z.number().optional(),
        color: z.string().optional(),
        brand_id: z.number().int().nullable().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
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
    })
    .from(schema.brands)
    .orderBy(asc(schema.brands.name))
    .all();
  return c.json({ brands }, 200);
});

const createBrand = createRoute({
  method: "post",
  path: "/api/brands",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        name: z.string(),
        slug: z.string(),
        color_primary: z.string().optional(),
        color_secondary: z.string().optional(),
        active: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: BrandSchema } } },
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
        name: z.string().optional(),
        slug: z.string().optional(),
        color_primary: z.string().optional(),
        color_secondary: z.string().optional(),
        active: z.number().int().optional(),
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
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

  const extFromName = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const extFromType = file.type ? file.type.split("/").pop()!.toLowerCase() : "";
  const ext = (extFromName || extFromType || "png").replace(/[^a-z0-9]/g, "") || "png";
  const key = `brands/${brand.slug}-logo.${ext}`;

  await c.env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await db.update(schema.brands).set({ logoR2Key: key }).where(eq(schema.brands.id, idNum));

  return c.json({ ok: true, logo_r2_key: key }, 200);
});

// General-purpose R2 read-through proxy, scoped to the "brands/" prefix so
// it can't be used to read arbitrary bucket contents. This is what lets
// <img src="/api/r2/brands/..."> render an uploaded logo -- R2 objects
// aren't otherwise reachable from the browser (no public bucket domain
// configured), and this keeps everything behind the same session-auth
// middleware as the rest of the API rather than standing up a separate
// public asset route.
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
  if (!key.startsWith("brands/")) {
    return c.json({ error: "forbidden" }, 403);
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
    }),
  },
  responses: {
    200: {
      description: "Jobs within date range",
      content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema) }) } },
    },
  },
});

app.openapi(getSchedule, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const user = c.get("user");
  const conditions = [sql`${schema.jobs.scheduledDate} >= ${q.start}`, sql`${schema.jobs.scheduledDate} <= ${q.end}`];
  if (user.role === "technician") {
    // Force-filter to the requester's own technician id, overriding any
    // technician_id query param.
    const ownTechId = await getOwnTechnicianId(db, user.id);
    if (ownTechId === null) {
      return c.json({ jobs: [] }, 200);
    }
    conditions.push(eq(schema.jobs.technicianId, ownTechId));
  } else if (q.technician_id) {
    conditions.push(eq(schema.jobs.technicianId, parseInt(q.technician_id, 10)));
  }
  const jobs = await jobJoinedSelect(db)
    .where(and(...conditions))
    .orderBy(asc(schema.jobs.scheduledDate), asc(schema.jobs.scheduledTime))
    .all();
  return c.json({ jobs }, 200);
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
  },
});

app.openapi(addChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
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
  return c.json({ materials }, 200);
});

const createMaterial = createRoute({
  method: "post",
  path: "/api/materials",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      unit: z.string().optional(),
      unit_cost: z.number().optional(),
      in_stock: z.number().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(createMaterial, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  await db.insert(schema.materials).values({
    name: data.name,
    unit: data.unit || "ea",
    unitCost: data.unit_cost || 0,
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
      name: z.string().optional(),
      unit: z.string().optional(),
      unit_cost: z.number().optional(),
      in_stock: z.number().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(updateMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.unit_cost !== undefined) updates.unitCost = data.unit_cost;
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

// ── Job Materials ──────────────────────────────────────────────────

const addJobMaterial = createRoute({
  method: "post",
  path: "/api/jobs/{id}/materials",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      material_id: z.number().int(),
      quantity: z.number(),
      unit_cost: z.number().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Added", content: { "application/json": { schema: OkSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addJobMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  if (c.get("user").role === "technician") {
    const forbidden = await requireOwnJobOrForbid(c, db, idNum);
    if (forbidden) return forbidden;
  }
  const data = c.req.valid("json");
  let cost = data.unit_cost;
  if (cost === undefined) {
    const mat = await db.select({ unit_cost: schema.materials.unitCost }).from(schema.materials).where(eq(schema.materials.id, data.material_id)).get();
    cost = mat?.unit_cost || 0;
  }
  await db.insert(schema.jobMaterials).values({
    jobId: idNum,
    materialId: data.material_id,
    quantity: data.quantity,
    unitCost: cost,
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
    }),
  },
  responses: {
    200: {
      description: "Paginated invoice list",
      content: { "application/json": { schema: z.object({
        invoices: z.array(z.any()),
        total: z.number().int(),
      }) } },
    },
  },
});

app.openapi(listInvoices, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (q.status) {
    conditions.push(eq(schema.invoices.status, q.status));
  }
  if (q.search) {
    const s = `%${q.search}%`;
    conditions.push(or(
      like(schema.invoices.identifier, s),
      like(schema.customers.name, s),
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

  return c.json({ invoices, total: countRow?.count || 0 }, 200);
});

const getInvoice = createRoute({
  method: "get",
  path: "/api/invoices/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Invoice detail", content: { "application/json": { schema: z.object({ invoice: z.any() }) } } },
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
  const linesOut = lines.map((l) => ({
    id: l.id,
    invoice_id: l.invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    total: l.total,
  }));
  return c.json({ invoice: { ...invoice, lines: linesOut } }, 200);
});

const createInvoice = createRoute({
  method: "post",
  path: "/api/invoices",
  request: {
    body: { content: { "application/json": { schema: z.object({
      customer_id: z.number().int(),
      job_id: z.number().int().nullable().optional(),
      tax_rate: z.number().optional(),
      notes: z.string().optional(),
      due_date: z.string().optional(),
      brand_id: z.number().int().nullable().optional(),
      lines: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unit_price: z.number(),
      })),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.any() } } },
  },
});

app.openapi(createInvoice, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  const identifier = await nextInvoiceIdentifier(db);
  const taxRate = data.tax_rate || 0;

  let subtotal = 0;
  for (const line of data.lines) {
    subtotal += line.quantity * line.unit_price;
  }
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  await db.insert(schema.invoices).values({
    identifier,
    customerId: data.customer_id,
    jobId: data.job_id ?? null,
    status: "draft",
    subtotal,
    taxRate,
    taxAmount,
    total,
    notes: data.notes || "",
    dueDate: data.due_date || "",
    brandId: data.brand_id ?? null,
  });

  const invoice = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.identifier, identifier)).get();
  for (const line of data.lines) {
    const lineTotal = line.quantity * line.unit_price;
    await db.insert(schema.invoiceLines).values({
      invoiceId: invoice!.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      total: lineTotal,
    });
  }

  const result = await db
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
    .where(eq(schema.invoices.id, invoice!.id))
    .get();
  return c.json(result!, 201);
});

const updateInvoice = createRoute({
  method: "put",
  path: "/api/invoices/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      status: z.string().optional(),
      notes: z.string().optional(),
      due_date: z.string().optional(),
      paid_date: z.string().optional(),
      brand_id: z.number().int().nullable().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(updateInvoice, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.due_date !== undefined) updates.dueDate = data.due_date;
  if (data.paid_date !== undefined) updates.paidDate = data.paid_date;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = sql`(datetime('now'))`;
    await db.update(schema.invoices).set(updates).where(eq(schema.invoices.id, toId(id)));
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

// ── Create invoice from job ────────────────────────────────────────

const invoiceFromJob = createRoute({
  method: "post",
  path: "/api/jobs/{id}/invoice",
  request: { params: IdParam },
  responses: {
    201: { description: "Invoice created from job", content: { "application/json": { schema: z.any() } } },
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

const listEstimates = createRoute({
  method: "get",
  path: "/api/estimates",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated estimate list",
      content: { "application/json": { schema: z.object({ estimates: z.array(EstimateSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listEstimates, async (c) => {
  const db = getDb(c.env);
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (q.status) {
    conditions.push(eq(schema.estimates.status, q.status));
  }
  if (q.search) {
    const s = `%${q.search}%`;
    conditions.push(or(
      like(schema.estimates.identifier, s),
      like(schema.customers.name, s),
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

  return c.json({ estimates, total: countRow?.count || 0 }, 200);
});

const getEstimate = createRoute({
  method: "get",
  path: "/api/estimates/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Estimate detail", content: { "application/json": { schema: z.object({ estimate: z.any() }) } } },
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
  const linesOut = lines.map((l) => ({
    id: l.id,
    estimate_id: l.estimateId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    total: l.total,
  }));
  return c.json({ estimate: { ...estimate, lines: linesOut } }, 200);
});

const createEstimate = createRoute({
  method: "post",
  path: "/api/estimates",
  request: {
    body: { content: { "application/json": { schema: z.object({
      customer_id: z.number().int(),
      brand_id: z.number().int().nullable().optional(),
      tax_rate: z.number().optional(),
      valid_until: z.string().optional(),
      notes: z.string().optional(),
      lines: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unit_price: z.number(),
      })),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.any() } } },
  },
});

app.openapi(createEstimate, async (c) => {
  const db = getDb(c.env);
  const data = c.req.valid("json");
  const identifier = await nextEstimateIdentifier(db);
  const taxRate = data.tax_rate || 0;

  let subtotal = 0;
  for (const line of data.lines) {
    subtotal += line.quantity * line.unit_price;
  }
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  await db.insert(schema.estimates).values({
    identifier,
    customerId: data.customer_id,
    brandId: data.brand_id ?? null,
    status: "draft",
    subtotal,
    taxRate,
    taxAmount,
    total,
    validUntil: data.valid_until || null,
    notes: data.notes || "",
  });

  const estimate = await db.select({ id: schema.estimates.id }).from(schema.estimates).where(eq(schema.estimates.identifier, identifier)).get();
  for (const line of data.lines) {
    const lineTotal = line.quantity * line.unit_price;
    await db.insert(schema.estimateLines).values({
      estimateId: estimate!.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      total: lineTotal,
    });
  }

  const result = await estimateJoinedSelect(db).where(eq(schema.estimates.id, estimate!.id)).get();
  return c.json(result!, 201);
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
      valid_until: z.string().optional(),
      tax_rate: z.number().optional(),
      brand_id: z.number().int().nullable().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
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

  const updates: Record<string, unknown> = {};
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.valid_until !== undefined) updates.validUntil = data.valid_until;
  if (data.brand_id !== undefined) updates.brandId = data.brand_id;
  // Recompute tax_amount/total if tax_rate changes -- subtotal stays
  // derived from lines (this route never touches lines directly), so it's
  // safe to reuse the existing subtotal in the recompute.
  if (data.tax_rate !== undefined) {
    const subtotal = existing.subtotal || 0;
    const taxAmount = subtotal * (data.tax_rate / 100);
    updates.taxRate = data.tax_rate;
    updates.taxAmount = taxAmount;
    updates.total = subtotal + taxAmount;
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

const sendEstimate = createRoute({
  method: "post",
  path: "/api/estimates/{id}/send",
  request: { params: IdParam },
  responses: {
    200: { description: "Sent", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state transition", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(sendEstimate, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ status: schema.estimates.status }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  if (estimate.status !== "draft") {
    return c.json({ error: `Cannot send an estimate with status "${estimate.status}" -- only draft estimates can be sent` }, 409);
  }
  await db.update(schema.estimates).set({ status: "sent" }).where(eq(schema.estimates.id, idNum));
  return c.json({ ok: true }, 200);
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
async function recomputeEstimateTotals(db: ReturnType<typeof getDb>, estimateId: number) {
  const lines = await db.select({ total: schema.estimateLines.total }).from(schema.estimateLines).where(eq(schema.estimateLines.estimateId, estimateId)).all();
  const subtotal = lines.reduce((sum, l) => sum + (l.total || 0), 0);
  const estimate = await db.select({ taxRate: schema.estimates.taxRate }).from(schema.estimates).where(eq(schema.estimates.id, estimateId)).get();
  const taxRate = estimate?.taxRate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  await db.update(schema.estimates).set({ subtotal, taxAmount, total }).where(eq(schema.estimates.id, estimateId));
}

const addEstimateLine = createRoute({
  method: "post",
  path: "/api/estimates/{id}/lines",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      description: z.string(),
      quantity: z.number(),
      unit_price: z.number(),
    }) } } },
  },
  responses: {
    201: { description: "Line added", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addEstimateLine, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
  const estimate = await db.select({ id: schema.estimates.id }).from(schema.estimates).where(eq(schema.estimates.id, idNum)).get();
  if (!estimate) return c.json({ error: "Estimate not found" }, 404);
  const data = c.req.valid("json");
  const lineTotal = data.quantity * data.unit_price;
  await db.insert(schema.estimateLines).values({
    estimateId: idNum,
    description: data.description,
    quantity: data.quantity,
    unitPrice: data.unit_price,
    total: lineTotal,
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
    201: { description: "Converted", content: { "application/json": { schema: z.object({ ok: z.boolean(), job_id: z.number().int(), invoice_id: z.number().int() }) } } },
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

  // ── Create the job ──
  // createJob's Zod schema only requires customer_id + scheduled_date;
  // everything else has a server-side default. scheduled_date defaults to
  // today since an approved estimate has no other date signal to draw
  // from -- office/dispatch can reschedule from the job detail view same
  // as any other job.
  const jobIdentifier = await nextIdentifier(db);
  const today = new Date().toISOString().split("T")[0];
  await db.insert(schema.jobs).values({
    identifier: jobIdentifier,
    customerId: estimate.customerId,
    status: "scheduled",
    priority: "normal",
    scheduledDate: today,
    scheduledTime: "09:00",
    duration: 60,
    price: estimate.total || 0,
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

  // Mark converted so a second call 409s (the `status !== "approved"` check
  // above) instead of silently minting a duplicate job+invoice. Without
  // this, clicking Convert twice -- or retrying after a slow response --
  // creates a second real job and invoice for the same estimate.
  await db.update(schema.estimates).set({ status: "converted" }).where(eq(schema.estimates.id, idNum));

  return c.json({ ok: true, job_id: jobId, invoice_id: invoiceId }, 201);
});

export default app;
