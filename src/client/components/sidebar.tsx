import { useApp } from "../context";
import { LayoutDashboard, Briefcase, Users, Wrench, Settings, CalendarDays, FileText, ClipboardList, Package, LogOut, Palette, Repeat, Hammer } from "lucide-preact";
import { NobleMark } from "./noble-mark";
import type { View } from "../types";

const navItems: { view: View; path: string; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", path: "/", label: "Dashboard", icon: LayoutDashboard },
  { view: "schedule", path: "/schedule", label: "Schedule", icon: CalendarDays },
  { view: "jobs", path: "/jobs", label: "Jobs", icon: Briefcase },
  { view: "customers", path: "/customers", label: "Customers", icon: Users },
  { view: "technicians", path: "/technicians", label: "Technicians", icon: Wrench },
  { view: "estimates", path: "/estimates", label: "Estimates", icon: ClipboardList },
  { view: "invoices", path: "/invoices", label: "Invoices", icon: FileText },
  { view: "service-agreements", path: "/service-agreements", label: "Recurring", icon: Repeat },
  { view: "materials", path: "/materials", label: "Materials", icon: Package },
  { view: "products", path: "/products", label: "Products (TKC)", icon: Hammer },
  { view: "services", path: "/services", label: "Service Types", icon: Settings },
  { view: "brands", path: "/brands", label: "Brands", icon: Palette },
];

// Resource families that the backend forbids technicians from (see the
// blanket role-gate middleware in src/server/index.ts). Hidden from the nav
// so a technician's UI never dead-ends into a 403. products' mutations are
// technician-blocked but its list (GET) is technician-readable, same as
// materials -- kept visible in nav for parity with materials, not hidden.
const TECHNICIAN_HIDDEN_VIEWS: View[] = ["customers", "technicians", "invoices", "estimates", "materials", "services", "brands", "service-agreements"];

// Brand identity/colors/logo management is an office/admin task, not a
// sales task -- mirrors requireAdminOrOfficeOrForbid on the brand mutation
// routes in src/server/index.ts. Estimators can still see brand-tagged
// pills elsewhere (jobs/invoices), just not the settings page.
const ESTIMATOR_HIDDEN_VIEWS: View[] = ["brands"];

export function Sidebar({ currentView, open, onNavigate }: { currentView: View; open?: boolean; onNavigate?: () => void }) {
  const { navigate, stats, currentUser, logout, jobsPag } = useApp();
  const go = (path: string) => { navigate(path); onNavigate?.(); };
  const isTechnician = currentUser?.role === "technician";
  const isEstimator = currentUser?.role === "estimator";
  const visibleNavItems = navItems.filter((item) => {
    if (isTechnician && TECHNICIAN_HIDDEN_VIEWS.includes(item.view)) return false;
    if (isEstimator && ESTIMATOR_HIDDEN_VIEWS.includes(item.view)) return false;
    return true;
  });
  // stats.jobs is a global, unscoped count (see /api/stats -- deliberately
  // left unrestricted for technicians). jobsPag.total, in contrast, reflects
  // the technician-scoped list they actually see, so use that for them.
  const jobsBadgeCount = isTechnician ? jobsPag.total : stats.jobs;

  return (
    <aside class={`sidebar ${open ? "open" : ""}`}>
      <div class="sidebar-brand">
        <NobleMark size={34} class="sidebar-brand-mark" />
        <div class="sidebar-wordmark">
          <span class="sidebar-wordmark-name">Noble<em> CRM</em></span>
          <span class="sidebar-wordmark-sub">Noble Tampa</span>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section-title">Menu</div>
        {visibleNavItems.map((item) => (
          <button
            key={item.view}
            class={`sidebar-item ${currentView === item.view ? "active" : ""}`}
            onClick={() => go(item.path)}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
            {item.view === "jobs" && jobsBadgeCount > 0 && (
              <span class="sidebar-badge">{jobsBadgeCount}</span>
            )}
            {item.view === "customers" && stats.customers > 0 && (
              <span class="sidebar-badge">{stats.customers}</span>
            )}
            {item.view === "invoices" && stats.invoices_outstanding > 0 && (
              <span class="sidebar-badge">{stats.invoices_outstanding}</span>
            )}
          </button>
        ))}
        <button class="sidebar-logout" onClick={() => logout()}>
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-stat">
          <span class="sidebar-stat-value">{stats.today_jobs}</span>
          <span class="sidebar-stat-label">Today</span>
        </div>
        <div class="sidebar-stat">
          <span class="sidebar-stat-value">{stats.upcoming_jobs}</span>
          <span class="sidebar-stat-label">Upcoming</span>
        </div>
      </div>
    </aside>
  );
}
