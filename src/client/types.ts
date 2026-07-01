export type View = "dashboard" | "schedule" | "jobs" | "customers" | "technicians" | "services" | "invoices" | "estimates" | "materials" | "brands" | "service-agreements";

export type JobStatus = "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled";
export type Priority = "low" | "normal" | "high" | "urgent";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type EstimateStatus = "draft" | "sent" | "approved" | "declined" | "expired" | "converted";

export interface Job {
  id: number;
  identifier: string;
  customer_id: number;
  technician_id: number | null;
  service_type_id: number | null;
  status: JobStatus;
  priority: Priority;
  scheduled_date: string;
  scheduled_time: string;
  duration: number;
  price: number;
  address: string;
  notes: string;
  completion_notes: string;
  is_recurring: number;
  recurrence_interval: string;
  next_recurrence_date: string;
  brand_id?: number | null;
  customer_name?: string;
  customer_phone?: string;
  technician_name?: string | null;
  technician_color?: string | null;
  service_type_name?: string | null;
  service_type_color?: string | null;
  brand_name?: string | null;
  brand_color_primary?: string | null;
  brand_color_secondary?: string | null;
  job_notes?: JobNote[];
  checklist?: ChecklistItem[];
  job_materials?: JobMaterial[];
  created_at: string;
  updated_at: string;
}

export type CustomerStatus = "lead" | "active" | "inactive";
export type CustomerSource = "referral" | "google" | "repeat" | "website" | "other";

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  status: CustomerStatus;
  source: CustomerSource | null;
  job_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Technician {
  id: number;
  name: string;
  email: string;
  phone: string;
  color: string;
  active: number;
  job_count?: number;
  created_at: string;
}

export interface ServiceType {
  id: number;
  name: string;
  description: string;
  default_duration: number;
  default_price: number;
  color: string;
  brand_id?: number | null;
  created_at: string;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  color_primary: string | null;
  color_secondary: string | null;
  logo_r2_key: string | null;
  active: number;
}

export interface JobNote {
  id: number;
  job_id: number;
  content: string;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  job_id: number;
  label: string;
  checked: number;
  sort_order: number;
}

export interface Material {
  id: number;
  name: string;
  unit: string;
  unit_cost: number;
  in_stock: number;
  created_at: string;
}

export interface JobMaterial {
  id: number;
  job_id: number;
  material_id: number;
  material_name?: string;
  material_unit?: string;
  quantity: number;
  unit_cost: number;
}

export interface Invoice {
  id: number;
  identifier: string;
  customer_id: number;
  job_id: number | null;
  status: InvoiceStatus;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string;
  due_date: string;
  paid_date: string;
  brand_id?: number | null;
  customer_name?: string;
  job_identifier?: string;
  brand_name?: string | null;
  brand_color_primary?: string | null;
  brand_color_secondary?: string | null;
  lines?: InvoiceLine[];
  payments?: Payment[];
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export type PaymentMethod = "cash" | "check" | "card" | "financing";

export interface Payment {
  id: number;
  invoice_id: number;
  method: PaymentMethod;
  amount: number;
  surcharge_amount: number | null;
  processor_ref: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
}

export type AttachmentEntityType = "job" | "estimate" | "customer";
export type AttachmentKind = "before" | "after" | "doc" | "signature";

export interface Attachment {
  id: number;
  entity_type: AttachmentEntityType;
  entity_id: number;
  kind: AttachmentKind;
  r2_key: string;
  filename: string | null;
  content_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Estimate {
  id: number;
  identifier: string | null;
  customer_id: number;
  brand_id?: number | null;
  status: EstimateStatus;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  valid_until: string | null;
  notes: string | null;
  approved_at: string | null;
  // Customer-facing loop (Phase 5): the unguessable token minting the public
  // /p/e/{token} link (present once the estimate has been sent), plus the
  // customer-acceptance audit trail written when they e-sign.
  public_token?: string | null;
  signed_name?: string | null;
  signed_at?: string | null;
  customer_name?: string | null;
  brand_name?: string | null;
  brand_color_primary?: string | null;
  brand_color_secondary?: string | null;
  // NEW: optional deposit amount (<= total), set while draft/sent/approved.
  deposit_amount?: number | null;
  lines?: EstimateLine[];
  created_at: string;
}

export interface EstimateLine {
  id: number;
  estimate_id: number;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

// NEW (structured estimate builder): rooms -> surfaces. Only editable while
// the parent estimate is 'draft' -- see /api/estimates/{id}/rooms.
export interface EstimateSurface {
  id: number;
  room_id: number;
  surface_type: string;
  measurement: number;
  prep_notes: string | null;
  coats: number;
  paint_product: string | null;
  labor_cost: number;
  material_cost: number;
  sort_order: number;
  generated_line_id: number | null;
}

export interface EstimateRoom {
  id: number;
  estimate_id: number;
  name: string;
  sort_order: number;
  surfaces?: EstimateSurface[];
}

export type ChangeOrderStatus = "pending" | "approved" | "rejected";

export interface ChangeOrder {
  id: number;
  job_id: number;
  description: string;
  amount: number;
  status: ChangeOrderStatus;
  created_at: string;
}

export type ServiceAgreementInterval = "weekly" | "monthly" | "quarterly" | "annual";

export interface ServiceAgreement {
  id: number;
  customer_id: number;
  brand_id: number | null;
  service_type_id: number | null;
  interval: ServiceAgreementInterval;
  next_run_date: string | null;
  active: number;
  customer_name?: string | null;
  brand_name?: string | null;
  service_type_name?: string | null;
}

export interface Stats {
  jobs: number;
  customers: number;
  technicians: number;
  service_types: number;
  today_jobs: number;
  upcoming_jobs: number;
  completed_jobs: number;
  revenue: number;
  invoices_outstanding: number;
  invoices_overdue: number;
}

export interface PaginatedState {
  page: number;
  limit: number;
  total: number;
}

export interface CustomerLookup {
  id: number;
  name: string;
  address: string;
}

export interface TechnicianLookup {
  id: number;
  name: string;
  color: string;
}
