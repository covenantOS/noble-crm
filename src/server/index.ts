import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, like, or, sql, inArray } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { AppBindings } from "../lib/types.js";

const app = new OpenAPIHono<AppBindings>();

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
  created_at: z.string(),
}).openapi("ServiceType");

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
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  technician_name: z.string().nullable().optional(),
  technician_color: z.string().nullable().optional(),
  service_type_name: z.string().nullable().optional(),
  service_type_color: z.string().nullable().optional(),
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
      created_at: sql<string>`COALESCE(${schema.jobs.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.jobs.updatedAt}, '')`,
      customer_name: sql<string | undefined>`${schema.customers.name}`,
      customer_phone: sql<string | undefined>`${schema.customers.phone}`,
      technician_name: schema.technicians.name,
      technician_color: schema.technicians.color,
      service_type_name: schema.serviceTypes.name,
      service_type_color: schema.serviceTypes.color,
    })
    .from(schema.jobs)
    .leftJoin(schema.customers, eq(schema.jobs.customerId, schema.customers.id))
    .leftJoin(schema.technicians, eq(schema.jobs.technicianId, schema.technicians.id))
    .leftJoin(schema.serviceTypes, eq(schema.jobs.serviceTypeId, schema.serviceTypes.id));
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
  if (q.date) {
    conditions.push(eq(schema.jobs.scheduledDate, q.date));
  }
  if (q.technician_id) {
    conditions.push(eq(schema.jobs.technicianId, parseInt(q.technician_id, 10)));
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
      }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
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

  const updates: Record<string, unknown> = {};
  if (data.customer_id !== undefined) updates.customerId = data.customer_id;
  if (data.technician_id !== undefined) updates.technicianId = data.technician_id;
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
  },
});

app.openapi(deleteJob, async (c) => {
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
  },
});

app.openapi(addJobNote, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
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
  },
});

app.openapi(deleteJobNote, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.jobNotes).where(eq(schema.jobNotes.id, toId(id)));
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
      created_at: sql<string>`COALESCE(${schema.jobs.createdAt}, '')`,
      updated_at: sql<string>`COALESCE(${schema.jobs.updatedAt}, '')`,
      technician_name: schema.technicians.name,
      technician_color: schema.technicians.color,
      service_type_name: schema.serviceTypes.name,
      service_type_color: schema.serviceTypes.color,
    })
    .from(schema.jobs)
    .leftJoin(schema.technicians, eq(schema.jobs.technicianId, schema.technicians.id))
    .leftJoin(schema.serviceTypes, eq(schema.jobs.serviceTypeId, schema.serviceTypes.id))
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
  });
  const st = await db.select().from(schema.serviceTypes).orderBy(desc(schema.serviceTypes.id)).limit(1).get();
  const stOut = {
    id: st!.id,
    name: st!.name,
    description: st!.description,
    default_duration: st!.defaultDuration,
    default_price: st!.defaultPrice,
    color: st!.color,
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
  const conditions = [sql`${schema.jobs.scheduledDate} >= ${q.start}`, sql`${schema.jobs.scheduledDate} <= ${q.end}`];
  if (q.technician_id) {
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
  },
});

app.openapi(addChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const idNum = toId(id);
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
  },
});

app.openapi(toggleChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db
    .update(schema.jobChecklist)
    .set({ checked: sql`CASE WHEN ${schema.jobChecklist.checked} = 0 THEN 1 ELSE 0 END` })
    .where(eq(schema.jobChecklist.id, toId(id)));
  return c.json({ ok: true }, 200);
});

const deleteChecklistItem = createRoute({
  method: "delete",
  path: "/api/checklist/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(deleteChecklistItem, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.jobChecklist).where(eq(schema.jobChecklist.id, toId(id)));
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
  },
});

app.openapi(addJobMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  let cost = data.unit_cost;
  if (cost === undefined) {
    const mat = await db.select({ unit_cost: schema.materials.unitCost }).from(schema.materials).where(eq(schema.materials.id, data.material_id)).get();
    cost = mat?.unit_cost || 0;
  }
  await db.insert(schema.jobMaterials).values({
    jobId: toId(id),
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
  },
});

app.openapi(deleteJobMaterial, async (c) => {
  const db = getDb(c.env);
  const { id } = c.req.valid("param");
  await db.delete(schema.jobMaterials).where(eq(schema.jobMaterials.id, toId(id)));
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
      customer_name: schema.customers.name,
      job_identifier: schema.jobs.identifier,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.jobs, eq(schema.invoices.jobId, schema.jobs.id))
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
      customer_name: schema.customers.name,
      job_identifier: schema.jobs.identifier,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
    .leftJoin(schema.jobs, eq(schema.invoices.jobId, schema.jobs.id))
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
      customer_name: schema.customers.name,
    })
    .from(schema.invoices)
    .leftJoin(schema.customers, eq(schema.invoices.customerId, schema.customers.id))
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

export default app;
