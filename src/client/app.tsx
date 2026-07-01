import { useEffect, useMemo, useState } from "preact/hooks";
import { Menu } from "lucide-preact";
import { AppContext } from "./context";
import { useAppState } from "./hooks/use-app";
import { useRouter } from "./hooks/use-router";
import { useSession } from "./hooks/use-session";
import { Sidebar } from "./components/sidebar";
import { NobleMark } from "./components/noble-mark";
import { Dashboard } from "./components/dashboard";
import { ScheduleView } from "./components/schedule-view";
import { JobList } from "./components/job-list";
import { JobDetail } from "./components/job-detail";
import { CustomerList } from "./components/customer-list";
import { CustomerDetail } from "./components/customer-detail";
import { TechnicianList } from "./components/technician-list";
import { ServiceTypeList } from "./components/service-type-list";
import { MaterialList } from "./components/material-list";
import { InvoiceList } from "./components/invoice-list";
import { InvoiceDetail } from "./components/invoice-detail";
import { EstimateList } from "./components/estimate-list";
import { EstimateDetail } from "./components/estimate-detail";
import { BrandList } from "./components/brand-list";
import { ServiceAgreementList } from "./components/service-agreement-list";
import { ErrorBanner } from "./components/error-banner";
import { Login } from "./components/login";

export function App() {
  const isAgent = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("agent") || params.get("mode") === "agent";
  }, []);

  useEffect(() => {
    if (isAgent) {
      document.documentElement.setAttribute("data-agent", "");
    }
  }, [isAgent]);

  const { session, isPending } = useSession();

  if (isPending) {
    return <div class="loading-text">Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return <AuthenticatedApp isAgent={isAgent} session={session} />;
}

function AuthenticatedApp({ isAgent, session }: { isAgent: boolean; session: NonNullable<ReturnType<typeof useSession>["session"]> }) {
  const { view, id, navigate } = useRouter();
  const currentUser = useMemo(() => ({
    id: session.user.id,
    role: (session.user as { role?: string }).role || "office",
    name: session.user.name,
    email: session.user.email,
  }), [session]);
  const appState = useAppState(isAgent, navigate, currentUser);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [view, id]);

  // Load detail when URL has an ID
  useEffect(() => {
    if (view === "jobs" && id) {
      appState.selectJob(parseInt(id, 10));
    } else if (view === "customers" && id) {
      appState.selectCustomer(parseInt(id, 10));
    } else if (view === "invoices" && id) {
      appState.selectInvoice(parseInt(id, 10));
    } else if (view === "estimates" && id) {
      appState.selectEstimate(parseInt(id, 10));
    }
  }, [view, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderMain = () => {
    if (view === "jobs" && id && appState.selectedJob) return <JobDetail />;
    if (view === "customers" && id && appState.selectedCustomer) return <CustomerDetail />;
    if (view === "invoices" && id && appState.selectedInvoice) return <InvoiceDetail />;
    if (view === "estimates" && id && appState.selectedEstimate) return <EstimateDetail />;
    switch (view) {
      case "schedule": return <ScheduleView />;
      case "jobs": return <JobList />;
      case "customers": return <CustomerList />;
      case "technicians": return <TechnicianList />;
      case "services": return <ServiceTypeList />;
      case "materials": return <MaterialList />;
      case "invoices": return <InvoiceList />;
      case "estimates": return <EstimateList />;
      case "brands": return <BrandList />;
      case "service-agreements": return <ServiceAgreementList />;
      default: return <Dashboard />;
    }
  };

  return (
    <AppContext.Provider value={appState}>
      <div class="layout">
        {/* Mobile top bar — hamburger + wordmark (hidden on desktop via CSS) */}
        <header class="topbar">
          <button class="topbar-toggle" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <NobleMark size={28} class="topbar-mark" />
          <span class="topbar-name">Noble<em> CRM</em></span>
        </header>
        <div class={`sidebar-overlay ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
        <Sidebar currentView={view} open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
        <main class="main-content">
          {appState.loading ? (
            <div class="loading-text">Loading...</div>
          ) : (
            renderMain()
          )}
        </main>
      </div>
      <ErrorBanner />
    </AppContext.Provider>
  );
}
