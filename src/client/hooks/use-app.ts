import { useState, useCallback, useEffect } from "preact/hooks";
import { api } from "../api";
import { authClient } from "../auth-client";
import type {
  Job, Customer, Technician, ServiceType, Material, Invoice, Stats, PaginatedState,
  CustomerLookup, TechnicianLookup, Priority, Brand, Estimate,
  Attachment, AttachmentEntityType, AttachmentKind, Payment, PaymentMethod,
  ServiceAgreement,
} from "../types";
import type { AppContextValue, CurrentUser } from "../context";

export function useAppState(isAgent: boolean, navigate: (to: string) => void, currentUser: CurrentUser | null): AppContextValue {
  const [stats, setStats] = useState<Stats>({ jobs: 0, customers: 0, technicians: 0, service_types: 0, today_jobs: 0, upcoming_jobs: 0, completed_jobs: 0, revenue: 0, invoices_outstanding: 0, invoices_overdue: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPag, setJobsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [jobsSearch, setJobsSearch] = useState("");
  const [jobsStatusFilter, setJobsStatusFilter] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Customers
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersPag, setCustomersPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [customersSearch, setCustomersSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCustomerJobs, setSelectedCustomerJobs] = useState<Job[]>([]);

  // Technicians, Service Types, Materials
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  // Brands
  const [brands, setBrands] = useState<Brand[]>([]);

  // Service Agreements
  const [serviceAgreements, setServiceAgreements] = useState<ServiceAgreement[]>([]);

  // Invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesPag, setInvoicesPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [invoicesStatusFilter, setInvoicesStatusFilter] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Estimates
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [estimatesPag, setEstimatesPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [estimatesSearch, setEstimatesSearch] = useState("");
  const [estimatesStatusFilter, setEstimatesStatusFilter] = useState("");
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);

  // Attachments (photo gallery on job-detail / estimate-detail)
  const [jobAttachments, setJobAttachments] = useState<Attachment[]>([]);
  const [estimateAttachments, setEstimateAttachments] = useState<Attachment[]>([]);

  // Schedule
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const [scheduleStart, setScheduleStart] = useState(monday.toISOString().split("T")[0]);
  const [scheduleEnd, setScheduleEnd] = useState(sunday.toISOString().split("T")[0]);
  const [scheduleJobs, setScheduleJobs] = useState<Job[]>([]);

  // Lookups
  const [customerLookup, setCustomerLookup] = useState<CustomerLookup[]>([]);
  const [technicianLookup, setTechnicianLookup] = useState<TechnicianLookup[]>([]);

  // ── Fetch helpers ──

  const fetchStats = useCallback(async () => {
    const data = await api<Stats>("GET", "/api/stats");
    setStats(data);
  }, []);

  const fetchJobs = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ jobs: Job[]; total: number }>("GET", `/api/jobs?${params}`);
    setJobs(data.jobs);
    setJobsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchCustomers = useCallback(async (pag: PaginatedState, search: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    const data = await api<{ customers: Customer[]; total: number }>("GET", `/api/customers?${params}`);
    setCustomers(data.customers);
    setCustomersPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchTechnicians = useCallback(async () => {
    const data = await api<{ technicians: Technician[] }>("GET", "/api/technicians");
    setTechnicians(data.technicians);
  }, []);

  const fetchServiceTypes = useCallback(async () => {
    const data = await api<{ service_types: ServiceType[] }>("GET", "/api/service-types");
    setServiceTypes(data.service_types);
  }, []);

  const fetchMaterials = useCallback(async () => {
    const data = await api<{ materials: Material[] }>("GET", "/api/materials");
    setMaterials(data.materials);
  }, []);

  const fetchBrands = useCallback(async () => {
    const data = await api<{ brands: Brand[] }>("GET", "/api/brands");
    setBrands(data.brands);
  }, []);

  const fetchServiceAgreements = useCallback(async () => {
    const data = await api<{ service_agreements: ServiceAgreement[] }>("GET", "/api/service-agreements");
    setServiceAgreements(data.service_agreements);
  }, []);

  const fetchInvoices = useCallback(async (pag: PaginatedState, status: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (status) params.set("status", status);
    const data = await api<{ invoices: Invoice[]; total: number }>("GET", `/api/invoices?${params}`);
    setInvoices(data.invoices);
    setInvoicesPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchEstimates = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ estimates: Estimate[]; total: number }>("GET", `/api/estimates?${params}`);
    setEstimates(data.estimates);
    setEstimatesPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchSchedule = useCallback(async (start: string, end: string) => {
    const data = await api<{ jobs: Job[] }>("GET", `/api/schedule?start=${start}&end=${end}`);
    setScheduleJobs(data.jobs);
  }, []);

  const fetchLookups = useCallback(async () => {
    const [c, t] = await Promise.all([
      api<{ customers: CustomerLookup[] }>("GET", "/api/customers/all"),
      api<{ technicians: TechnicianLookup[] }>("GET", "/api/technicians/all"),
    ]);
    setCustomerLookup(c.customers);
    setTechnicianLookup(t.technicians);
  }, []);

  // ── Initial load ──

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Technicians are server-side 403'd on customers/technicians/invoices
      // (whole resource families, see src/server/index.ts's technician role
      // gate) -- skip those fetches entirely for that role rather than
      // firing requests we already know will fail. Promise.allSettled (not
      // Promise.all) so one unexpected failure doesn't blank out every
      // other widget on the page.
      const isTechnician = currentUser?.role === "technician";
      const tasks = [fetchStats(), fetchJobs(jobsPag, "", ""), fetchServiceTypes(), fetchMaterials(), fetchSchedule(scheduleStart, scheduleEnd), fetchBrands()];
      if (!isTechnician) {
        tasks.push(fetchCustomers(customersPag, ""), fetchTechnicians(), fetchInvoices(invoicesPag, ""), fetchEstimates(estimatesPag, "", ""), fetchLookups(), fetchServiceAgreements());
      }
      const results = await Promise.allSettled(tasks);
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (firstFailure) setError((firstFailure.reason as Error).message);
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchJobs(jobsPag, jobsSearch, jobsStatusFilter).catch((err) => setError((err as Error).message));
  }, [jobsPag.page, jobsSearch, jobsStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // These two also run on mount (a dependency array only skips *re-runs*
  // where nothing changed, not the first run) -- same 403-family the
  // initial-load effect above already guards against, so guard here too.
  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchCustomers(customersPag, customersSearch).catch((err) => setError((err as Error).message));
  }, [customersPag.page, customersSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchInvoices(invoicesPag, invoicesStatusFilter).catch((err) => setError((err as Error).message));
  }, [invoicesPag.page, invoicesStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estimates are also part of the technician-forbidden resource family
  // (see the blanket role-gate middleware in src/server/index.ts) -- skip
  // the fetch entirely for that role, same as customers/invoices above.
  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter).catch((err) => setError((err as Error).message));
  }, [estimatesPag.page, estimatesSearch, estimatesStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSchedule(scheduleStart, scheduleEnd).catch((err) => setError((err as Error).message));
  }, [scheduleStart, scheduleEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Jobs CRUD ──

  const setJobsPage = useCallback((page: number) => setJobsPag((p) => ({ ...p, page })), []);

  const addJob = useCallback(async (data: {
    customer_id: number; technician_id?: number | null; service_type_id?: number | null;
    scheduled_date: string; scheduled_time?: string; duration?: number; price?: number;
    address?: string; notes?: string; priority?: Priority; is_recurring?: number; recurrence_interval?: string;
    brand_id?: number | null;
  }) => {
    await api("POST", "/api/jobs", data);
    await fetchJobs(jobsPag, jobsSearch, jobsStatusFilter);
    await Promise.all([fetchStats(), fetchSchedule(scheduleStart, scheduleEnd)]);
  }, [jobsPag, jobsSearch, jobsStatusFilter, scheduleStart, scheduleEnd, fetchJobs, fetchStats, fetchSchedule]);

  const updateJob = useCallback(async (id: number, data: Partial<Job>) => {
    await api("PUT", `/api/jobs/${id}`, data);
    await fetchJobs(jobsPag, jobsSearch, jobsStatusFilter);
    if (selectedJob && selectedJob.id === id) {
      const res = await api<{ job: Job }>("GET", `/api/jobs/${id}`);
      setSelectedJob(res.job);
    }
    await Promise.all([fetchStats(), fetchSchedule(scheduleStart, scheduleEnd)]);
  }, [jobsPag, jobsSearch, jobsStatusFilter, selectedJob, scheduleStart, scheduleEnd, fetchJobs, fetchStats, fetchSchedule]);

  const deleteJob = useCallback(async (id: number) => {
    await api("DELETE", `/api/jobs/${id}`);
    if (selectedJob && selectedJob.id === id) { setSelectedJob(null); navigate("/jobs"); }
    await fetchJobs(jobsPag, jobsSearch, jobsStatusFilter);
    await Promise.all([fetchStats(), fetchSchedule(scheduleStart, scheduleEnd)]);
  }, [jobsPag, jobsSearch, jobsStatusFilter, selectedJob, scheduleStart, scheduleEnd, navigate, fetchJobs, fetchStats, fetchSchedule]);

  const selectJob = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedJob(null); return; }
    const res = await api<{ job: Job }>("GET", `/api/jobs/${id}`);
    setSelectedJob(res.job);
  }, []);

  const addJobNote = useCallback(async (jobId: number, content: string) => {
    await api("POST", `/api/jobs/${jobId}/notes`, { content });
    const res = await api<{ job: Job }>("GET", `/api/jobs/${jobId}`);
    setSelectedJob(res.job);
  }, []);

  const deleteJobNote = useCallback(async (noteId: number) => {
    await api("DELETE", `/api/notes/${noteId}`);
    if (selectedJob) {
      const res = await api<{ job: Job }>("GET", `/api/jobs/${selectedJob.id}`);
      setSelectedJob(res.job);
    }
  }, [selectedJob]);

  // ── Checklist ──

  const addChecklistItem = useCallback(async (jobId: number, label: string) => {
    await api("POST", `/api/jobs/${jobId}/checklist`, { label });
    const res = await api<{ job: Job }>("GET", `/api/jobs/${jobId}`);
    setSelectedJob(res.job);
  }, []);

  const toggleChecklistItem = useCallback(async (itemId: number) => {
    await api("PUT", `/api/checklist/${itemId}`);
    if (selectedJob) {
      const res = await api<{ job: Job }>("GET", `/api/jobs/${selectedJob.id}`);
      setSelectedJob(res.job);
    }
  }, [selectedJob]);

  const deleteChecklistItem = useCallback(async (itemId: number) => {
    await api("DELETE", `/api/checklist/${itemId}`);
    if (selectedJob) {
      const res = await api<{ job: Job }>("GET", `/api/jobs/${selectedJob.id}`);
      setSelectedJob(res.job);
    }
  }, [selectedJob]);

  // ── Job Materials ──

  const addJobMaterial = useCallback(async (jobId: number, materialId: number, quantity: number) => {
    await api("POST", `/api/jobs/${jobId}/materials`, { material_id: materialId, quantity });
    const res = await api<{ job: Job }>("GET", `/api/jobs/${jobId}`);
    setSelectedJob(res.job);
  }, []);

  const deleteJobMaterial = useCallback(async (id: number) => {
    await api("DELETE", `/api/job-materials/${id}`);
    if (selectedJob) {
      const res = await api<{ job: Job }>("GET", `/api/jobs/${selectedJob.id}`);
      setSelectedJob(res.job);
    }
  }, [selectedJob]);

  // ── Invoice from job ──

  const createInvoiceFromJob = useCallback(async (jobId: number) => {
    await api("POST", `/api/jobs/${jobId}/invoice`);
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
    navigate("/invoices");
  }, [invoicesPag, invoicesStatusFilter, navigate, fetchInvoices, fetchStats]);

  // ── Customers CRUD ──

  const setCustomersPage = useCallback((page: number) => setCustomersPag((p) => ({ ...p, page })), []);

  const addCustomer = useCallback(async (data: Partial<Customer>) => {
    await api("POST", "/api/customers", data);
    await fetchCustomers(customersPag, customersSearch);
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [customersPag, customersSearch, fetchCustomers, fetchStats, fetchLookups]);

  const updateCustomer = useCallback(async (id: number, data: Partial<Customer>) => {
    await api("PUT", `/api/customers/${id}`, data);
    await fetchCustomers(customersPag, customersSearch);
    await fetchLookups();
    if (selectedCustomer && selectedCustomer.id === id) {
      const res = await api<{ customer: Customer; jobs: Job[] }>("GET", `/api/customers/${id}`);
      setSelectedCustomer(res.customer);
      setSelectedCustomerJobs(res.jobs);
    }
  }, [customersPag, customersSearch, selectedCustomer, fetchCustomers, fetchLookups]);

  const deleteCustomer = useCallback(async (id: number) => {
    await api("DELETE", `/api/customers/${id}`);
    if (selectedCustomer && selectedCustomer.id === id) {
      setSelectedCustomer(null);
      setSelectedCustomerJobs([]);
      navigate("/customers");
    }
    await fetchCustomers(customersPag, customersSearch);
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [customersPag, customersSearch, selectedCustomer, navigate, fetchCustomers, fetchStats, fetchLookups]);

  const selectCustomer = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedCustomer(null); setSelectedCustomerJobs([]); return; }
    const res = await api<{ customer: Customer; jobs: Job[] }>("GET", `/api/customers/${id}`);
    setSelectedCustomer(res.customer);
    setSelectedCustomerJobs(res.jobs);
  }, []);

  // ── Technicians CRUD ──

  const addTechnician = useCallback(async (data: Partial<Technician>) => {
    await api("POST", "/api/technicians", data);
    await fetchTechnicians();
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [fetchTechnicians, fetchStats, fetchLookups]);

  const updateTechnician = useCallback(async (id: number, data: Partial<Technician>) => {
    await api("PUT", `/api/technicians/${id}`, data);
    await fetchTechnicians();
    await fetchLookups();
  }, [fetchTechnicians, fetchLookups]);

  const deleteTechnician = useCallback(async (id: number) => {
    await api("DELETE", `/api/technicians/${id}`);
    await fetchTechnicians();
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [fetchTechnicians, fetchStats, fetchLookups]);

  // ── Service Types CRUD ──

  const addServiceType = useCallback(async (data: Partial<ServiceType>) => {
    await api("POST", "/api/service-types", data);
    await fetchServiceTypes();
    await fetchStats();
  }, [fetchServiceTypes, fetchStats]);

  const updateServiceType = useCallback(async (id: number, data: Partial<ServiceType>) => {
    await api("PUT", `/api/service-types/${id}`, data);
    await fetchServiceTypes();
  }, [fetchServiceTypes]);

  const deleteServiceType = useCallback(async (id: number) => {
    await api("DELETE", `/api/service-types/${id}`);
    await fetchServiceTypes();
    await fetchStats();
  }, [fetchServiceTypes, fetchStats]);

  // ── Materials CRUD ──

  const addMaterial = useCallback(async (data: Partial<Material>) => {
    await api("POST", "/api/materials", data);
    await fetchMaterials();
  }, [fetchMaterials]);

  const updateMaterial = useCallback(async (id: number, data: Partial<Material>) => {
    await api("PUT", `/api/materials/${id}`, data);
    await fetchMaterials();
  }, [fetchMaterials]);

  const deleteMaterial = useCallback(async (id: number) => {
    await api("DELETE", `/api/materials/${id}`);
    await fetchMaterials();
  }, [fetchMaterials]);

  // ── Brands CRUD ──

  const addBrand = useCallback(async (data: { name: string; slug: string; color_primary?: string; color_secondary?: string; active?: number }) => {
    await api("POST", "/api/brands", data);
    await fetchBrands();
  }, [fetchBrands]);

  const updateBrand = useCallback(async (id: number, data: Partial<Brand>) => {
    await api("PUT", `/api/brands/${id}`, data);
    await fetchBrands();
  }, [fetchBrands]);

  // Multipart upload -- bypasses the JSON-only api() helper since the body
  // here is a File, not a JSON-serializable object.
  const uploadBrandLogo = useCallback(async (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/api/brands/${id}/logo`, { method: "POST", body: form, credentials: "include" });
    const text = await r.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server error: ${r.status} ${r.statusText}`);
    }
    if (!r.ok) throw new Error((data as { error?: string }).error || "Upload failed");
    await fetchBrands();
  }, [fetchBrands]);

  // ── Service Agreements CRUD ──

  const addServiceAgreement = useCallback(async (data: { customer_id: number; brand_id?: number | null; service_type_id?: number | null; interval: string; next_run_date: string; active?: number }) => {
    await api("POST", "/api/service-agreements", data);
    await fetchServiceAgreements();
  }, [fetchServiceAgreements]);

  const updateServiceAgreement = useCallback(async (id: number, data: Partial<ServiceAgreement>) => {
    await api("PUT", `/api/service-agreements/${id}`, data);
    await fetchServiceAgreements();
  }, [fetchServiceAgreements]);

  const deleteServiceAgreement = useCallback(async (id: number) => {
    await api("DELETE", `/api/service-agreements/${id}`);
    await fetchServiceAgreements();
  }, [fetchServiceAgreements]);

  // ── Invoices CRUD ──

  const setInvoicesPage = useCallback((page: number) => setInvoicesPag((p) => ({ ...p, page })), []);

  const addInvoice = useCallback(async (data: { customer_id: number; job_id?: number | null; tax_rate?: number; notes?: string; due_date?: string; brand_id?: number | null; lines: { description: string; quantity: number; unit_price: number }[] }) => {
    await api("POST", "/api/invoices", data);
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
  }, [invoicesPag, invoicesStatusFilter, fetchInvoices, fetchStats]);

  const updateInvoice = useCallback(async (id: number, data: Partial<Invoice>) => {
    await api("PUT", `/api/invoices/${id}`, data);
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    if (selectedInvoice && selectedInvoice.id === id) {
      const res = await api<{ invoice: Invoice }>("GET", `/api/invoices/${id}`);
      setSelectedInvoice(res.invoice);
    }
    await fetchStats();
  }, [invoicesPag, invoicesStatusFilter, selectedInvoice, fetchInvoices, fetchStats]);

  const deleteInvoice = useCallback(async (id: number) => {
    await api("DELETE", `/api/invoices/${id}`);
    if (selectedInvoice && selectedInvoice.id === id) { setSelectedInvoice(null); navigate("/invoices"); }
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
  }, [invoicesPag, invoicesStatusFilter, selectedInvoice, navigate, fetchInvoices, fetchStats]);

  const selectInvoice = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedInvoice(null); return; }
    const res = await api<{ invoice: Invoice }>("GET", `/api/invoices/${id}`);
    setSelectedInvoice(res.invoice);
  }, []);

  // ── Payments ──

  const recordPayment = useCallback(async (invoiceId: number, method: PaymentMethod, amount?: number) => {
    const res = await api<{ payment: Payment; invoice_status: string }>("POST", `/api/invoices/${invoiceId}/payments`, amount !== undefined ? { method, amount } : { method });
    // Refresh the invoice (payments list + status may have changed) and the
    // list/stats, same refresh pattern as updateInvoice above.
    if (selectedInvoice && selectedInvoice.id === invoiceId) {
      const inv = await api<{ invoice: Invoice }>("GET", `/api/invoices/${invoiceId}`);
      setSelectedInvoice(inv.invoice);
    }
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
    return res.payment;
  }, [selectedInvoice, invoicesPag, invoicesStatusFilter, fetchInvoices, fetchStats]);

  // ── Attachments ──

  const fetchJobAttachments = useCallback(async (jobId: number) => {
    const res = await api<{ attachments: Attachment[] }>("GET", `/api/attachments?entity_type=job&entity_id=${jobId}`);
    setJobAttachments(res.attachments);
  }, []);

  const fetchEstimateAttachments = useCallback(async (estimateId: number) => {
    const res = await api<{ attachments: Attachment[] }>("GET", `/api/attachments?entity_type=estimate&entity_id=${estimateId}`);
    setEstimateAttachments(res.attachments);
  }, []);

  // Multipart upload -- bypasses the JSON-only api() helper, same rationale
  // as uploadBrandLogo above (the body here is a File, not JSON).
  const uploadAttachment = useCallback(async (entityType: AttachmentEntityType, entityId: number, file: File, kind: AttachmentKind = "doc") => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity_type", entityType);
    form.append("entity_id", String(entityId));
    form.append("kind", kind);
    const r = await fetch("/api/attachments", { method: "POST", body: form, credentials: "include" });
    const text = await r.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server error: ${r.status} ${r.statusText}`);
    }
    if (!r.ok) throw new Error((data as { error?: string }).error || "Upload failed");
    if (entityType === "job") await fetchJobAttachments(entityId);
    else if (entityType === "estimate") await fetchEstimateAttachments(entityId);
  }, [fetchJobAttachments, fetchEstimateAttachments]);

  const deleteAttachment = useCallback(async (id: number, entityType: AttachmentEntityType, entityId: number) => {
    await api("DELETE", `/api/attachments/${id}`);
    if (entityType === "job") await fetchJobAttachments(entityId);
    else if (entityType === "estimate") await fetchEstimateAttachments(entityId);
  }, [fetchJobAttachments, fetchEstimateAttachments]);

  // ── Estimates CRUD ──

  const setEstimatesPage = useCallback((page: number) => setEstimatesPag((p) => ({ ...p, page })), []);

  const addEstimate = useCallback(async (data: { customer_id: number; brand_id?: number | null; tax_rate?: number; valid_until?: string; notes?: string; lines: { description: string; quantity: number; unit_price: number }[] }) => {
    await api("POST", "/api/estimates", data);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimates]);

  const updateEstimate = useCallback(async (id: number, data: Partial<Estimate>) => {
    await api("PUT", `/api/estimates/${id}`, data);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) {
      const res = await api<{ estimate: Estimate }>("GET", `/api/estimates/${id}`);
      setSelectedEstimate(res.estimate);
    }
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates]);

  const deleteEstimate = useCallback(async (id: number) => {
    await api("DELETE", `/api/estimates/${id}`);
    if (selectedEstimate && selectedEstimate.id === id) { setSelectedEstimate(null); navigate("/estimates"); }
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, navigate, fetchEstimates]);

  const selectEstimate = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedEstimate(null); return; }
    const res = await api<{ estimate: Estimate }>("GET", `/api/estimates/${id}`);
    setSelectedEstimate(res.estimate);
  }, []);

  const refreshSelectedEstimate = useCallback(async (id: number) => {
    const res = await api<{ estimate: Estimate }>("GET", `/api/estimates/${id}`);
    setSelectedEstimate(res.estimate);
  }, []);

  const sendEstimate = useCallback(async (id: number) => {
    await api("POST", `/api/estimates/${id}/send`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates, refreshSelectedEstimate]);

  const approveEstimate = useCallback(async (id: number) => {
    await api("POST", `/api/estimates/${id}/approve`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates, refreshSelectedEstimate]);

  const declineEstimate = useCallback(async (id: number) => {
    await api("POST", `/api/estimates/${id}/decline`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates, refreshSelectedEstimate]);

  const addEstimateLine = useCallback(async (estimateId: number, line: { description: string; quantity: number; unit_price: number }) => {
    await api("POST", `/api/estimates/${estimateId}/lines`, line);
    await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimates, refreshSelectedEstimate]);

  const deleteEstimateLine = useCallback(async (lineId: number) => {
    await api("DELETE", `/api/estimate-lines/${lineId}`);
    if (selectedEstimate) await refreshSelectedEstimate(selectedEstimate.id);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates, refreshSelectedEstimate]);

  const convertEstimate = useCallback(async (id: number) => {
    const res = await api<{ ok: boolean; job_id: number; invoice_id: number }>("POST", `/api/estimates/${id}/convert`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
    await Promise.all([fetchStats(), fetchInvoices(invoicesPag, invoicesStatusFilter), fetchJobs(jobsPag, jobsSearch, jobsStatusFilter)]);
    return { job_id: res.job_id, invoice_id: res.invoice_id };
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, invoicesPag, invoicesStatusFilter, jobsPag, jobsSearch, jobsStatusFilter, fetchEstimates, fetchStats, fetchInvoices, fetchJobs, refreshSelectedEstimate]);

  // ── Schedule ──

  const setScheduleRange = useCallback((start: string, end: string) => {
    setScheduleStart(start);
    setScheduleEnd(end);
  }, []);

  // ── Auth ──

  const logout = useCallback(async () => {
    await authClient.signOut();
  }, []);

  return {
    navigate, isAgent, stats,
    currentUser, logout,
    jobs, jobsPag, setJobsPage, jobsSearch, setJobsSearch, jobsStatusFilter, setJobsStatusFilter,
    addJob, updateJob, deleteJob,
    selectedJob, selectJob, addJobNote, deleteJobNote,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    addJobMaterial, deleteJobMaterial, createInvoiceFromJob,
    customers, customersPag, setCustomersPage, customersSearch, setCustomersSearch,
    addCustomer, updateCustomer, deleteCustomer,
    selectedCustomer, selectedCustomerJobs, selectCustomer,
    technicians, addTechnician, updateTechnician, deleteTechnician,
    serviceTypes, addServiceType, updateServiceType, deleteServiceType,
    materials, addMaterial, updateMaterial, deleteMaterial,
    brands, addBrand, updateBrand, uploadBrandLogo,
    invoices, invoicesPag, setInvoicesPage, invoicesStatusFilter, setInvoicesStatusFilter,
    selectedInvoice, selectInvoice, addInvoice, updateInvoice, deleteInvoice,
    recordPayment,
    jobAttachments, estimateAttachments, fetchJobAttachments, fetchEstimateAttachments,
    uploadAttachment, deleteAttachment,
    estimates, estimatesPag, setEstimatesPage, estimatesSearch, setEstimatesSearch,
    estimatesStatusFilter, setEstimatesStatusFilter,
    selectedEstimate, selectEstimate, addEstimate, updateEstimate, deleteEstimate,
    sendEstimate, approveEstimate, declineEstimate, addEstimateLine, deleteEstimateLine, convertEstimate,
    scheduleJobs, scheduleStart, scheduleEnd, setScheduleRange,
    customerLookup, technicianLookup,
    serviceAgreements, addServiceAgreement, updateServiceAgreement, deleteServiceAgreement,
    loading, error, setError,
  };
}
