import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type {
  Job, Customer, Technician, ServiceType, Material, Invoice, Stats, PaginatedState,
  CustomerLookup, TechnicianLookup, Priority, Brand, Estimate,
  Attachment, AttachmentEntityType, AttachmentKind, Payment, PaymentMethod,
  ServiceAgreement, EstimateRoom, ChangeOrder, JobCrewMember, Product,
} from "./types";

export interface CurrentUser {
  id: string;
  role: string;
  name: string;
  email: string;
}

export interface AppContextValue {
  navigate: (to: string) => void;
  isAgent: boolean;
  stats: Stats;

  // Auth
  currentUser: CurrentUser | null;
  logout: () => Promise<void>;

  // Jobs
  jobs: Job[];
  jobsPag: PaginatedState;
  setJobsPage: (page: number) => void;
  jobsSearch: string;
  setJobsSearch: (s: string) => void;
  jobsStatusFilter: string;
  setJobsStatusFilter: (s: string) => void;
  addJob: (data: {
    customer_id: number;
    technician_id?: number | null;
    service_type_id?: number | null;
    scheduled_date: string;
    scheduled_time?: string;
    duration?: number;
    price?: number;
    address?: string;
    notes?: string;
    priority?: Priority;
    is_recurring?: number;
    recurrence_interval?: string;
    brand_id?: number | null;
    end_date?: string | null;
  }) => Promise<void>;
  updateJob: (id: number, data: Partial<Job>) => Promise<void>;
  deleteJob: (id: number) => Promise<void>;

  // Job detail
  selectedJob: Job | null;
  selectJob: (id: number | null) => Promise<void>;
  addJobNote: (jobId: number, content: string) => Promise<void>;
  deleteJobNote: (noteId: number) => Promise<void>;
  addChecklistItem: (jobId: number, label: string) => Promise<void>;
  toggleChecklistItem: (itemId: number) => Promise<void>;
  deleteChecklistItem: (itemId: number) => Promise<void>;
  addJobMaterial: (jobId: number, materialId: number, quantity: number) => Promise<void>;
  deleteJobMaterial: (id: number) => Promise<void>;
  createInvoiceFromJob: (jobId: number) => Promise<void>;

  // Job invoice history (progress billing) -- every invoice for a job, not
  // just the one selectedJob-adjacent create flow above.
  jobInvoices: Invoice[];
  fetchJobInvoices: (jobId: number) => Promise<void>;
  addJobProgressInvoice: (jobId: number, data: { description: string; amount: number; tax_rate?: number }) => Promise<void>;

  // Change orders (job-scoped, technician-blocked)
  jobChangeOrders: ChangeOrder[];
  fetchJobChangeOrders: (jobId: number) => Promise<void>;
  addChangeOrder: (jobId: number, data: { description: string; amount: number }) => Promise<void>;
  approveChangeOrder: (id: number, jobId: number) => Promise<void>;
  rejectChangeOrder: (id: number, jobId: number) => Promise<void>;

  // Job crew (many-to-many job<->technician, admin/office/estimator only)
  addJobCrewMember: (jobId: number, technicianId: number, role?: string) => Promise<void>;
  removeJobCrewMember: (jobId: number, crewId: number) => Promise<void>;

  // Review request (admin/office/estimator only) -- honest { sent, reason }.
  requestJobReview: (jobId: number) => Promise<{ sent: boolean; reason?: string }>;

  // Customers
  customers: Customer[];
  customersPag: PaginatedState;
  setCustomersPage: (page: number) => void;
  customersSearch: string;
  setCustomersSearch: (s: string) => void;
  customersStatusFilter: string;
  setCustomersStatusFilter: (s: string) => void;
  addCustomer: (data: Partial<Customer>) => Promise<void>;
  updateCustomer: (id: number, data: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: number) => Promise<void>;
  selectedCustomer: Customer | null;
  selectedCustomerJobs: Job[];
  selectCustomer: (id: number | null) => Promise<void>;
  selectedCustomerEstimates: Estimate[];
  selectedCustomerInvoices: Invoice[];
  selectedCustomerOutstanding: number;

  // Technicians
  technicians: Technician[];
  addTechnician: (data: Partial<Technician>) => Promise<void>;
  updateTechnician: (id: number, data: Partial<Technician>) => Promise<void>;
  deleteTechnician: (id: number) => Promise<void>;

  // Service Types
  serviceTypes: ServiceType[];
  addServiceType: (data: Partial<ServiceType>) => Promise<void>;
  updateServiceType: (id: number, data: Partial<ServiceType>) => Promise<void>;
  deleteServiceType: (id: number) => Promise<void>;

  // Materials
  materials: Material[];
  addMaterial: (data: Partial<Material>) => Promise<void>;
  updateMaterial: (id: number, data: Partial<Material>) => Promise<void>;
  deleteMaterial: (id: number) => Promise<void>;

  // Products (TKC catalog) -- list open to all incl. technicians, mutations
  // admin/office only (server-enforced; mirrors materials).
  products: Product[];
  addProduct: (data: Partial<Product>) => Promise<void>;
  updateProduct: (id: number, data: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;

  // Brands
  brands: Brand[];
  addBrand: (data: { name: string; slug: string; color_primary?: string; color_secondary?: string; active?: number; review_url?: string }) => Promise<void>;
  updateBrand: (id: number, data: Partial<Brand>) => Promise<void>;
  uploadBrandLogo: (id: number, file: File) => Promise<void>;

  // Invoices
  invoices: Invoice[];
  invoicesPag: PaginatedState;
  setInvoicesPage: (page: number) => void;
  invoicesStatusFilter: string;
  setInvoicesStatusFilter: (s: string) => void;
  selectedInvoice: Invoice | null;
  selectInvoice: (id: number | null) => Promise<void>;
  addInvoice: (data: { customer_id: number; job_id?: number | null; tax_rate?: number; notes?: string; due_date?: string; brand_id?: number | null; lines: { description: string; quantity: number; unit_price: number }[] }) => Promise<void>;
  updateInvoice: (id: number, data: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: number) => Promise<void>;
  addInvoiceLine: (invoiceId: number, line: { description: string; quantity: number; unit_price: number }) => Promise<void>;
  deleteInvoiceLine: (lineId: number, invoiceId: number) => Promise<void>;

  // Payments
  recordPayment: (invoiceId: number, method: PaymentMethod, amount?: number) => Promise<Payment>;
  // Stripe online payment (GATED on STRIPE_SECRET_KEY). Resolves to a checkout
  // URL to open, or { configured:false } when Stripe isn't set up so the UI
  // can show a "not configured yet" notice instead of erroring.
  startInvoiceCheckout: (invoiceId: number) => Promise<{ configured: boolean; url?: string }>;

  // Attachments
  jobAttachments: Attachment[];
  estimateAttachments: Attachment[];
  fetchJobAttachments: (jobId: number) => Promise<void>;
  fetchEstimateAttachments: (estimateId: number) => Promise<void>;
  uploadAttachment: (entityType: AttachmentEntityType, entityId: number, file: File, kind?: AttachmentKind) => Promise<void>;
  deleteAttachment: (id: number, entityType: AttachmentEntityType, entityId: number) => Promise<void>;

  // Estimates
  estimates: Estimate[];
  estimatesPag: PaginatedState;
  setEstimatesPage: (page: number) => void;
  estimatesSearch: string;
  setEstimatesSearch: (s: string) => void;
  estimatesStatusFilter: string;
  setEstimatesStatusFilter: (s: string) => void;
  selectedEstimate: Estimate | null;
  selectEstimate: (id: number | null) => Promise<void>;
  addEstimate: (data: { customer_id: number; brand_id?: number | null; tax_rate?: number; valid_until?: string; notes?: string; lines: { description: string; quantity: number; unit_price: number }[] }) => Promise<void>;
  updateEstimate: (id: number, data: Partial<Estimate>) => Promise<void>;
  deleteEstimate: (id: number) => Promise<void>;
  // sendEstimate returns the send result so the UI can show whether the
  // customer email was actually delivered (GATED on RESEND_API_KEY) and expose
  // the public link. Also used by the "Resend" affordance.
  sendEstimate: (id: number) => Promise<{ public_url: string; email_sent: boolean; email_reason?: string }>;
  approveEstimate: (id: number) => Promise<void>;
  declineEstimate: (id: number) => Promise<void>;
  addEstimateLine: (estimateId: number, line: { description: string; quantity: number; unit_price: number }) => Promise<void>;
  deleteEstimateLine: (lineId: number) => Promise<void>;
  convertEstimate: (id: number) => Promise<{ job_id: number; invoice_id: number; deposit_invoice_id: number | null }>;
  setEstimateDeposit: (id: number, depositAmount: number | null) => Promise<void>;

  // Structured estimate builder (rooms -> surfaces). Optional layer on top
  // of plain estimate_lines -- only editable while the estimate is draft.
  estimateRooms: EstimateRoom[];
  fetchEstimateRooms: (estimateId: number) => Promise<void>;
  addEstimateRoom: (estimateId: number, name: string) => Promise<void>;
  updateEstimateRoom: (roomId: number, estimateId: number, data: { name?: string; sort_order?: number }) => Promise<void>;
  deleteEstimateRoom: (roomId: number, estimateId: number) => Promise<void>;
  addEstimateSurface: (roomId: number, estimateId: number, data: { surface_type: string; measurement?: number; prep_notes?: string; coats?: number; paint_product?: string; labor_cost?: number; material_cost?: number }) => Promise<void>;
  updateEstimateSurface: (surfaceId: number, estimateId: number, data: Partial<{ surface_type: string; measurement: number; prep_notes: string; coats: number; paint_product: string; labor_cost: number; material_cost: number }>) => Promise<void>;
  deleteEstimateSurface: (surfaceId: number, estimateId: number) => Promise<void>;

  // Schedule
  scheduleJobs: Job[];
  scheduleStart: string;
  scheduleEnd: string;
  setScheduleRange: (start: string, end: string) => void;

  // Service Agreements
  serviceAgreements: ServiceAgreement[];
  addServiceAgreement: (data: { customer_id: number; brand_id?: number | null; service_type_id?: number | null; interval: string; next_run_date: string; active?: number }) => Promise<void>;
  updateServiceAgreement: (id: number, data: Partial<ServiceAgreement>) => Promise<void>;
  deleteServiceAgreement: (id: number) => Promise<void>;

  // Lookups
  customerLookup: CustomerLookup[];
  technicianLookup: TechnicianLookup[];

  loading: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
}

export const AppContext = createContext<AppContextValue>(null!);

export function useApp() {
  return useContext(AppContext);
}
