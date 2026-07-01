import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { api } from "../api";
import { authClient } from "../auth-client";
import type {
  Job, Customer, Technician, ServiceType, Material, Invoice, Stats, PaginatedState,
  CustomerLookup, TechnicianLookup, Priority, Brand, Estimate,
  Attachment, AttachmentEntityType, AttachmentKind, Payment, PaymentMethod,
  ServiceAgreement, EstimateRoom, ChangeOrder, Product,
} from "../types";
import type { AppContextValue, CurrentUser } from "../context";

export function useAppState(isAgent: boolean, navigate: (to: string) => void, currentUser: CurrentUser | null): AppContextValue {
  const [stats, setStats] = useState<Stats>({ jobs: 0, customers: 0, technicians: 0, service_types: 0, today_jobs: 0, upcoming_jobs: 0, completed_jobs: 0, revenue: 0, invoices_outstanding: 0, invoices_overdue: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Active account (multi-account switcher) ──
  // null = "All Accounts". Persisted per-user so Will's selection and Leo's
  // selection never bleed into each other on a shared machine. Technicians
  // never get an account scope (their data is ownership-scoped server-side
  // and the switcher is hidden for them).
  const brandStorageKey = `noble.activeBrand.${currentUser?.id ?? "anon"}`;
  const [activeBrandId, setActiveBrandIdState] = useState<number | null>(() => {
    if (!currentUser || currentUser.role === "technician") return null;
    try {
      const raw = localStorage.getItem(brandStorageKey);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  // Ref mirror so the stable fetch callbacks below (deliberately created with
  // [] deps and reused everywhere) always read the CURRENT selection without
  // re-creating every callback (and everything downstream of them) on switch.
  const activeBrandRef = useRef<number | null>(activeBrandId);
  const setActiveBrandId = useCallback((id: number | null) => {
    activeBrandRef.current = id;
    setActiveBrandIdState(id);
    try {
      if (id === null) localStorage.removeItem(brandStorageKey);
      else localStorage.setItem(brandStorageKey, String(id));
    } catch { /* storage unavailable -- selection just won't persist */ }
  }, [brandStorageKey]);
  // Appends the active account to a list/dashboard query string.
  const withBrand = (params: URLSearchParams) => {
    if (activeBrandRef.current !== null) params.set("brand_id", String(activeBrandRef.current));
    return params;
  };

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
  const [customersStatusFilter, setCustomersStatusFilter] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCustomerJobs, setSelectedCustomerJobs] = useState<Job[]>([]);
  const [selectedCustomerEstimates, setSelectedCustomerEstimates] = useState<Estimate[]>([]);
  const [selectedCustomerInvoices, setSelectedCustomerInvoices] = useState<Invoice[]>([]);
  const [selectedCustomerOutstanding, setSelectedCustomerOutstanding] = useState(0);

  // Technicians, Service Types, Materials
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

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

  // Structured estimate builder (rooms -> surfaces)
  const [estimateRooms, setEstimateRooms] = useState<EstimateRoom[]>([]);

  // Job invoice history (progress billing) + change orders
  const [jobInvoices, setJobInvoices] = useState<Invoice[]>([]);
  const [jobChangeOrders, setJobChangeOrders] = useState<ChangeOrder[]>([]);

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
    const params = withBrand(new URLSearchParams());
    const qs = params.toString();
    const data = await api<Stats>("GET", `/api/stats${qs ? `?${qs}` : ""}`);
    setStats(data);
  }, []);

  const fetchJobs = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = withBrand(new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) }));
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ jobs: Job[]; total: number }>("GET", `/api/jobs?${params}`);
    setJobs(data.jobs);
    setJobsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchCustomers = useCallback(async (pag: PaginatedState, search: string, status = "") => {
    const params = withBrand(new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) }));
    if (search) params.set("search", search);
    if (status) params.set("status", status);
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

  const fetchProducts = useCallback(async () => {
    const data = await api<{ products: Product[] }>("GET", "/api/products");
    setProducts(data.products);
  }, []);

  const fetchBrands = useCallback(async () => {
    const data = await api<{ brands: Brand[] }>("GET", "/api/brands");
    setBrands(data.brands);
  }, []);

  const fetchServiceAgreements = useCallback(async () => {
    const qs = withBrand(new URLSearchParams()).toString();
    const data = await api<{ service_agreements: ServiceAgreement[] }>("GET", `/api/service-agreements${qs ? `?${qs}` : ""}`);
    setServiceAgreements(data.service_agreements);
  }, []);

  const fetchInvoices = useCallback(async (pag: PaginatedState, status: string) => {
    const params = withBrand(new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) }));
    if (status) params.set("status", status);
    const data = await api<{ invoices: Invoice[]; total: number }>("GET", `/api/invoices?${params}`);
    setInvoices(data.invoices);
    setInvoicesPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchEstimates = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = withBrand(new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) }));
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ estimates: Estimate[]; total: number }>("GET", `/api/estimates?${params}`);
    setEstimates(data.estimates);
    setEstimatesPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchSchedule = useCallback(async (start: string, end: string) => {
    const params = withBrand(new URLSearchParams({ start, end }));
    const data = await api<{ jobs: Job[] }>("GET", `/api/schedule?${params}`);
    setScheduleJobs(data.jobs);
  }, []);

  const fetchLookups = useCallback(async () => {
    const custQs = withBrand(new URLSearchParams()).toString();
    const [c, t] = await Promise.all([
      api<{ customers: CustomerLookup[] }>("GET", `/api/customers/all${custQs ? `?${custQs}` : ""}`),
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
      const tasks = [fetchStats(), fetchJobs(jobsPag, "", ""), fetchServiceTypes(), fetchMaterials(), fetchProducts(), fetchSchedule(scheduleStart, scheduleEnd), fetchBrands()];
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
  }, [jobsPag.page, jobsSearch, jobsStatusFilter, activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  // These two also run on mount (a dependency array only skips *re-runs*
  // where nothing changed, not the first run) -- same 403-family the
  // initial-load effect above already guards against, so guard here too.
  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchCustomers(customersPag, customersSearch, customersStatusFilter).catch((err) => setError((err as Error).message));
  }, [customersPag.page, customersSearch, customersStatusFilter, activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchInvoices(invoicesPag, invoicesStatusFilter).catch((err) => setError((err as Error).message));
  }, [invoicesPag.page, invoicesStatusFilter, activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estimates are also part of the technician-forbidden resource family
  // (see the blanket role-gate middleware in src/server/index.ts) -- skip
  // the fetch entirely for that role, same as customers/invoices above.
  useEffect(() => {
    if (currentUser?.role === "technician") return;
    fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter).catch((err) => setError((err as Error).message));
  }, [estimatesPag.page, estimatesSearch, estimatesStatusFilter, activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSchedule(scheduleStart, scheduleEnd).catch((err) => setError((err as Error).message));
  }, [scheduleStart, scheduleEnd, activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Account switch: refresh the surfaces the per-list effects above don't
  // cover (dashboard stats, recurring agreements, customer dropdown lookup).
  // Skipped on mount -- the initial-load effect already fetched everything.
  const brandSwitchMounted = useRef(false);
  useEffect(() => {
    if (!brandSwitchMounted.current) { brandSwitchMounted.current = true; return; }
    const tasks = [fetchStats()];
    if (currentUser?.role !== "technician") {
      tasks.push(fetchServiceAgreements(), fetchLookups());
    }
    Promise.allSettled(tasks).then((results) => {
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (firstFailure) setError((firstFailure.reason as Error).message);
    });
  }, [activeBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the active account disappears (brand deleted / stale localStorage id
  // from another environment), fall back to All Accounts rather than
  // filtering everything down to nothing forever.
  useEffect(() => {
    if (activeBrandId !== null && brands.length > 0 && !brands.some((b) => b.id === activeBrandId)) {
      setActiveBrandId(null);
    }
  }, [brands, activeBrandId, setActiveBrandId]);

  // ── Jobs CRUD ──

  const setJobsPage = useCallback((page: number) => setJobsPag((p) => ({ ...p, page })), []);

  const addJob = useCallback(async (data: {
    customer_id: number; technician_id?: number | null; service_type_id?: number | null;
    scheduled_date: string; scheduled_time?: string; duration?: number; price?: number;
    address?: string; notes?: string; priority?: Priority; is_recurring?: number; recurrence_interval?: string;
    brand_id?: number | null; end_date?: string | null;
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

  // ── Job invoice history (progress billing) ──

  const fetchJobInvoices = useCallback(async (jobId: number) => {
    const res = await api<{ invoices: Invoice[] }>("GET", `/api/jobs/${jobId}/invoices`);
    setJobInvoices(res.invoices);
  }, []);

  const addJobProgressInvoice = useCallback(async (jobId: number, data: { description: string; amount: number; tax_rate?: number }) => {
    await api("POST", `/api/jobs/${jobId}/invoices`, data);
    await fetchJobInvoices(jobId);
    await fetchStats();
  }, [fetchJobInvoices, fetchStats]);

  // ── Change orders ──

  const fetchJobChangeOrders = useCallback(async (jobId: number) => {
    const res = await api<{ change_orders: ChangeOrder[] }>("GET", `/api/jobs/${jobId}/change-orders`);
    setJobChangeOrders(res.change_orders);
  }, []);

  const addChangeOrder = useCallback(async (jobId: number, data: { description: string; amount: number }) => {
    await api("POST", `/api/jobs/${jobId}/change-orders`, data);
    await fetchJobChangeOrders(jobId);
  }, [fetchJobChangeOrders]);

  const approveChangeOrder = useCallback(async (id: number, jobId: number) => {
    await api("PUT", `/api/change-orders/${id}/approve`);
    await fetchJobChangeOrders(jobId);
    await fetchJobInvoices(jobId);
    await fetchStats();
  }, [fetchJobChangeOrders, fetchJobInvoices, fetchStats]);

  const rejectChangeOrder = useCallback(async (id: number, jobId: number) => {
    await api("PUT", `/api/change-orders/${id}/reject`);
    await fetchJobChangeOrders(jobId);
  }, [fetchJobChangeOrders]);

  // ── Job crew (many-to-many job<->technician) ──

  const addJobCrewMember = useCallback(async (jobId: number, technicianId: number, role?: string) => {
    await api("POST", `/api/jobs/${jobId}/crew`, { technician_id: technicianId, role });
    const res = await api<{ job: Job }>("GET", `/api/jobs/${jobId}`);
    setSelectedJob(res.job);
  }, []);

  const removeJobCrewMember = useCallback(async (jobId: number, crewId: number) => {
    await api("DELETE", `/api/jobs/${jobId}/crew/${crewId}`);
    const res = await api<{ job: Job }>("GET", `/api/jobs/${jobId}`);
    setSelectedJob(res.job);
  }, []);

  // ── Review request ──

  const requestJobReview = useCallback(async (jobId: number) => {
    const res = await api<{ sent: boolean; reason?: string }>("POST", `/api/jobs/${jobId}/request-review`);
    return { sent: res.sent, reason: res.reason };
  }, []);

  // ── Customers CRUD ──

  const setCustomersPage = useCallback((page: number) => setCustomersPag((p) => ({ ...p, page })), []);

  const addCustomer = useCallback(async (data: Partial<Customer>) => {
    await api("POST", "/api/customers", data);
    await fetchCustomers(customersPag, customersSearch, customersStatusFilter);
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [customersPag, customersSearch, customersStatusFilter, fetchCustomers, fetchStats, fetchLookups]);

  const updateCustomer = useCallback(async (id: number, data: Partial<Customer>) => {
    await api("PUT", `/api/customers/${id}`, data);
    await fetchCustomers(customersPag, customersSearch, customersStatusFilter);
    await fetchLookups();
    if (selectedCustomer && selectedCustomer.id === id) {
      const res = await api<{ customer: Customer; jobs: Job[]; estimates: Estimate[]; invoices: Invoice[]; outstanding_balance: number }>("GET", `/api/customers/${id}`);
      setSelectedCustomer(res.customer);
      setSelectedCustomerJobs(res.jobs);
      setSelectedCustomerEstimates(res.estimates);
      setSelectedCustomerInvoices(res.invoices);
      setSelectedCustomerOutstanding(res.outstanding_balance);
    }
  }, [customersPag, customersSearch, customersStatusFilter, selectedCustomer, fetchCustomers, fetchLookups]);

  const deleteCustomer = useCallback(async (id: number) => {
    await api("DELETE", `/api/customers/${id}`);
    if (selectedCustomer && selectedCustomer.id === id) {
      setSelectedCustomer(null);
      setSelectedCustomerJobs([]);
      setSelectedCustomerEstimates([]);
      setSelectedCustomerInvoices([]);
      setSelectedCustomerOutstanding(0);
      navigate("/customers");
    }
    await fetchCustomers(customersPag, customersSearch, customersStatusFilter);
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [customersPag, customersSearch, customersStatusFilter, selectedCustomer, navigate, fetchCustomers, fetchStats, fetchLookups]);

  const selectCustomer = useCallback(async (id: number | null) => {
    if (id === null) {
      setSelectedCustomer(null); setSelectedCustomerJobs([]);
      setSelectedCustomerEstimates([]); setSelectedCustomerInvoices([]); setSelectedCustomerOutstanding(0);
      return;
    }
    const res = await api<{ customer: Customer; jobs: Job[]; estimates: Estimate[]; invoices: Invoice[]; outstanding_balance: number }>("GET", `/api/customers/${id}`);
    setSelectedCustomer(res.customer);
    setSelectedCustomerJobs(res.jobs);
    setSelectedCustomerEstimates(res.estimates);
    setSelectedCustomerInvoices(res.invoices);
    setSelectedCustomerOutstanding(res.outstanding_balance);
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

  // ── Products CRUD (TKC catalog) ──

  const addProduct = useCallback(async (data: Partial<Product>) => {
    await api("POST", "/api/products", data);
    await fetchProducts();
  }, [fetchProducts]);

  const updateProduct = useCallback(async (id: number, data: Partial<Product>) => {
    await api("PUT", `/api/products/${id}`, data);
    await fetchProducts();
  }, [fetchProducts]);

  const deleteProduct = useCallback(async (id: number) => {
    await api("DELETE", `/api/products/${id}`);
    await fetchProducts();
  }, [fetchProducts]);

  // ── Brands CRUD ──

  const addBrand = useCallback(async (data: { name: string; slug: string; color_primary?: string; color_secondary?: string; active?: number; review_url?: string }) => {
    const created = await api<Brand>("POST", "/api/brands", data);
    await fetchBrands();
    return created;
  }, [fetchBrands]);

  // ── Demo workspace (admin-only; the server 403s everyone else) ──
  const resetDemo = useCallback(async () => {
    const res = await api<{ ok: boolean; brand_id: number }>("POST", "/api/demo/reset");
    // The demo cast touches every surface -- refresh all of it.
    await fetchBrands();
    const tasks = [
      fetchStats(),
      fetchJobs(jobsPag, jobsSearch, jobsStatusFilter),
      fetchSchedule(scheduleStart, scheduleEnd),
      fetchCustomers(customersPag, customersSearch, customersStatusFilter),
      fetchInvoices(invoicesPag, invoicesStatusFilter),
      fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter),
      fetchLookups(),
      fetchServiceAgreements(),
    ];
    await Promise.allSettled(tasks);
    return { brand_id: res.brand_id };
  }, [jobsPag, jobsSearch, jobsStatusFilter, scheduleStart, scheduleEnd, customersPag, customersSearch, customersStatusFilter, invoicesPag, invoicesStatusFilter, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchBrands, fetchStats, fetchJobs, fetchSchedule, fetchCustomers, fetchInvoices, fetchEstimates, fetchLookups, fetchServiceAgreements]);

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

  // ── Invoice line management ──

  const addInvoiceLine = useCallback(async (invoiceId: number, line: { description: string; quantity: number; unit_price: number }) => {
    await api("POST", `/api/invoices/${invoiceId}/lines`, line);
    if (selectedInvoice && selectedInvoice.id === invoiceId) {
      const res = await api<{ invoice: Invoice }>("GET", `/api/invoices/${invoiceId}`);
      setSelectedInvoice(res.invoice);
    }
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
  }, [selectedInvoice, invoicesPag, invoicesStatusFilter, fetchInvoices, fetchStats]);

  const deleteInvoiceLine = useCallback(async (lineId: number, invoiceId: number) => {
    await api("DELETE", `/api/invoice-lines/${lineId}`);
    if (selectedInvoice && selectedInvoice.id === invoiceId) {
      const res = await api<{ invoice: Invoice }>("GET", `/api/invoices/${invoiceId}`);
      setSelectedInvoice(res.invoice);
    }
    await fetchInvoices(invoicesPag, invoicesStatusFilter);
    await fetchStats();
  }, [selectedInvoice, invoicesPag, invoicesStatusFilter, fetchInvoices, fetchStats]);

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

  // Start a Stripe checkout for an invoice. Returns { configured:false } when
  // Stripe isn't set up (the route responds 501) so the UI can show a "not
  // configured yet" notice rather than surfacing an error. On success returns
  // the hosted checkout URL for the caller to open.
  const startInvoiceCheckout = useCallback(async (invoiceId: number): Promise<{ configured: boolean; url?: string }> => {
    const r = await fetch(`/api/invoices/${invoiceId}/checkout`, { method: "POST", credentials: "include" });
    const data = await r.json().catch(() => ({})) as { url?: string; error?: string; configured?: boolean };
    if (r.status === 501) return { configured: false };
    if (!r.ok) throw new Error(data.error || "Could not start checkout");
    return { configured: true, url: data.url };
  }, []);

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
    const res = await api<{ ok: boolean; public_token: string; public_url: string; email_sent: boolean; email_reason?: string }>("POST", `/api/estimates/${id}/send`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
    return { public_url: res.public_url, email_sent: res.email_sent, email_reason: res.email_reason };
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
    const res = await api<{ ok: boolean; job_id: number; invoice_id: number; deposit_invoice_id: number | null }>("POST", `/api/estimates/${id}/convert`);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
    await Promise.all([fetchStats(), fetchInvoices(invoicesPag, invoicesStatusFilter), fetchJobs(jobsPag, jobsSearch, jobsStatusFilter)]);
    return { job_id: res.job_id, invoice_id: res.invoice_id, deposit_invoice_id: res.deposit_invoice_id };
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, invoicesPag, invoicesStatusFilter, jobsPag, jobsSearch, jobsStatusFilter, fetchEstimates, fetchStats, fetchInvoices, fetchJobs, refreshSelectedEstimate]);

  const setEstimateDeposit = useCallback(async (id: number, depositAmount: number | null) => {
    await api("PUT", `/api/estimates/${id}/deposit`, { deposit_amount: depositAmount });
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
    if (selectedEstimate && selectedEstimate.id === id) await refreshSelectedEstimate(id);
  }, [estimatesPag, estimatesSearch, estimatesStatusFilter, selectedEstimate, fetchEstimates, refreshSelectedEstimate]);

  // ── Structured estimate builder (rooms -> surfaces) ──

  const fetchEstimateRooms = useCallback(async (estimateId: number) => {
    const res = await api<{ rooms: EstimateRoom[] }>("GET", `/api/estimates/${estimateId}/rooms`);
    setEstimateRooms(res.rooms);
  }, []);

  const addEstimateRoom = useCallback(async (estimateId: number, name: string) => {
    await api("POST", `/api/estimates/${estimateId}/rooms`, { name });
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

  const updateEstimateRoom = useCallback(async (roomId: number, estimateId: number, data: { name?: string; sort_order?: number }) => {
    await api("PUT", `/api/estimate-rooms/${roomId}`, data);
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

  const deleteEstimateRoom = useCallback(async (roomId: number, estimateId: number) => {
    await api("DELETE", `/api/estimate-rooms/${roomId}`);
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

  const addEstimateSurface = useCallback(async (roomId: number, estimateId: number, data: { surface_type: string; measurement?: number; prep_notes?: string; coats?: number; paint_product?: string; labor_cost?: number; material_cost?: number }) => {
    await api("POST", `/api/estimate-rooms/${roomId}/surfaces`, data);
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

  const updateEstimateSurface = useCallback(async (surfaceId: number, estimateId: number, data: Partial<{ surface_type: string; measurement: number; prep_notes: string; coats: number; paint_product: string; labor_cost: number; material_cost: number }>) => {
    await api("PUT", `/api/estimate-surfaces/${surfaceId}`, data);
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

  const deleteEstimateSurface = useCallback(async (surfaceId: number, estimateId: number) => {
    await api("DELETE", `/api/estimate-surfaces/${surfaceId}`);
    await fetchEstimateRooms(estimateId);
    if (selectedEstimate && selectedEstimate.id === estimateId) await refreshSelectedEstimate(estimateId);
    await fetchEstimates(estimatesPag, estimatesSearch, estimatesStatusFilter);
  }, [selectedEstimate, estimatesPag, estimatesSearch, estimatesStatusFilter, fetchEstimateRooms, fetchEstimates, refreshSelectedEstimate]);

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
    activeBrandId, setActiveBrandId, resetDemo,
    jobs, jobsPag, setJobsPage, jobsSearch, setJobsSearch, jobsStatusFilter, setJobsStatusFilter,
    addJob, updateJob, deleteJob,
    selectedJob, selectJob, addJobNote, deleteJobNote,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    addJobMaterial, deleteJobMaterial, createInvoiceFromJob,
    jobInvoices, fetchJobInvoices, addJobProgressInvoice,
    jobChangeOrders, fetchJobChangeOrders, addChangeOrder, approveChangeOrder, rejectChangeOrder,
    addJobCrewMember, removeJobCrewMember, requestJobReview,
    customers, customersPag, setCustomersPage, customersSearch, setCustomersSearch,
    customersStatusFilter, setCustomersStatusFilter,
    addCustomer, updateCustomer, deleteCustomer,
    selectedCustomer, selectedCustomerJobs, selectCustomer,
    selectedCustomerEstimates, selectedCustomerInvoices, selectedCustomerOutstanding,
    technicians, addTechnician, updateTechnician, deleteTechnician,
    serviceTypes, addServiceType, updateServiceType, deleteServiceType,
    materials, addMaterial, updateMaterial, deleteMaterial,
    products, addProduct, updateProduct, deleteProduct,
    brands, addBrand, updateBrand, uploadBrandLogo,
    invoices, invoicesPag, setInvoicesPage, invoicesStatusFilter, setInvoicesStatusFilter,
    selectedInvoice, selectInvoice, addInvoice, updateInvoice, deleteInvoice,
    addInvoiceLine, deleteInvoiceLine,
    recordPayment, startInvoiceCheckout,
    jobAttachments, estimateAttachments, fetchJobAttachments, fetchEstimateAttachments,
    uploadAttachment, deleteAttachment,
    estimates, estimatesPag, setEstimatesPage, estimatesSearch, setEstimatesSearch,
    estimatesStatusFilter, setEstimatesStatusFilter,
    selectedEstimate, selectEstimate, addEstimate, updateEstimate, deleteEstimate,
    sendEstimate, approveEstimate, declineEstimate, addEstimateLine, deleteEstimateLine, convertEstimate,
    setEstimateDeposit,
    estimateRooms, fetchEstimateRooms, addEstimateRoom, updateEstimateRoom, deleteEstimateRoom,
    addEstimateSurface, updateEstimateSurface, deleteEstimateSurface,
    scheduleJobs, scheduleStart, scheduleEnd, setScheduleRange,
    customerLookup, technicianLookup,
    serviceAgreements, addServiceAgreement, updateServiceAgreement, deleteServiceAgreement,
    loading, error, setError,
  };
}
