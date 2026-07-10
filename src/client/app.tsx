import { useEffect, useMemo, useState } from "preact/hooks";
import { Menu, Sparkles } from "lucide-preact";
import { AppContext } from "./context";
import { safeCssHex } from "./format";
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
import { ProductList } from "./components/product-list";
import { InvoiceList } from "./components/invoice-list";
import { InvoiceDetail } from "./components/invoice-detail";
import { EstimateList } from "./components/estimate-list";
import { EstimateDetail } from "./components/estimate-detail";
import { BrandList } from "./components/brand-list";
import { ServiceAgreementList } from "./components/service-agreement-list";
import { ErrorBanner } from "./components/error-banner";
import { Login } from "./components/login";
import { CommandPalette } from "./components/command-palette";
import { NobleAssistant } from "./components/noble-assistant";

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
  const [cmdOpen, setCmdOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [view, id]);

  // ⌘K / Ctrl+K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Demo workspace one-click reset (admin) — from Cmd-K or dashboard
  useEffect(() => {
    const onReset = async () => {
      if (currentUser.role !== "admin") {
        appState.setError("Only admins can reset the demo workspace.");
        return;
      }
      if (!confirm("Reset Sunshine Painting Co (Demo)? This wipes demo data only and reseeds a full cast.")) return;
      try {
        const res = await appState.resetDemo();
        appState.setActiveBrandId(res.brand_id);
      } catch (err) {
        appState.setError(err instanceof Error ? err.message : "Demo reset failed");
      }
    };
    window.addEventListener("noble:demo-reset", onReset);
    return () => window.removeEventListener("noble:demo-reset", onReset);
  }, [currentUser.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active account -> a SUBTLE accent only (switcher dot, active-nav tick,
  // context-bar dot). The brand's color_primary is exposed as --account-accent
  // on the document root; when All Accounts is active the variable is removed
  // so everything falls back to Noble gold. The hex is sanitized through
  // safeCssHex (client mirror of the server's stored-XSS guard) before it is
  // ever injected into a style.
  const activeBrand = appState.activeBrandId !== null
    ? appState.brands.find((b) => b.id === appState.activeBrandId) ?? null
    : null;
  useEffect(() => {
    const root = document.documentElement;
    if (activeBrand && activeBrand.color_primary) {
      root.style.setProperty("--account-accent", safeCssHex(activeBrand.color_primary, "#c9a227"));
    } else {
      root.style.removeProperty("--account-accent");
    }
    return () => { root.style.removeProperty("--account-accent"); };
  }, [activeBrand?.id, activeBrand?.color_primary]); // eslint-disable-line react-hooks/exhaustive-deps

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
      case "products": return <ProductList />;
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
          {/* Account context ribbon -- every page header carries the active
              account's name while a specific account is selected. */}
          {activeBrand && (
            <div class="account-context">
              <span class="account-context-dot" style={{ background: safeCssHex(activeBrand.color_primary, "#c9a227") }} />
              <span class="account-context-name">{activeBrand.name}</span>
              {activeBrand.is_demo === 1 && <span class="demo-badge">DEMO</span>}
              <button class="account-context-clear" onClick={() => appState.setActiveBrandId(null)}>View all accounts</button>
            </div>
          )}
          {appState.loading ? (
            <div class="loading-text">Loading...</div>
          ) : (
            renderMain()
          )}
        </main>
      </div>
      <ErrorBanner />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <NobleAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      {!assistantOpen && (
        <button
          class="assistant-fab"
          onClick={() => setAssistantOpen(true)}
          title="Noble Assistant (keyless AI)"
          aria-label="Open Noble Assistant"
        >
          <Sparkles size={18} />
        </button>
      )}
    </AppContext.Provider>
  );
}
