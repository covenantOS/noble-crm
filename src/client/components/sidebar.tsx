import { useApp } from "../context";
import { CalendarClock, LayoutDashboard, Briefcase, Users, Wrench, Settings, CalendarDays, FileText, Package, LogOut } from "lucide-preact";
import type { View } from "../types";

const navItems: { view: View; path: string; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", path: "/", label: "Dashboard", icon: LayoutDashboard },
  { view: "schedule", path: "/schedule", label: "Schedule", icon: CalendarDays },
  { view: "jobs", path: "/jobs", label: "Jobs", icon: Briefcase },
  { view: "customers", path: "/customers", label: "Customers", icon: Users },
  { view: "technicians", path: "/technicians", label: "Technicians", icon: Wrench },
  { view: "invoices", path: "/invoices", label: "Invoices", icon: FileText },
  { view: "materials", path: "/materials", label: "Materials", icon: Package },
  { view: "services", path: "/services", label: "Service Types", icon: Settings },
];

// Resource families that the backend forbids technicians from (see the
// blanket role-gate middleware in src/server/index.ts). Hidden from the nav
// so a technician's UI never dead-ends into a 403.
const TECHNICIAN_HIDDEN_VIEWS: View[] = ["customers", "technicians", "invoices", "materials", "services"];

export function Sidebar({ currentView }: { currentView: View }) {
  const { navigate, stats, currentUser, logout, jobsPag } = useApp();
  const isTechnician = currentUser?.role === "technician";
  const visibleNavItems = isTechnician
    ? navItems.filter((item) => !TECHNICIAN_HIDDEN_VIEWS.includes(item.view))
    : navItems;
  // stats.jobs is a global, unscoped count (see /api/stats -- deliberately
  // left unrestricted for technicians). jobsPag.total, in contrast, reflects
  // the technician-scoped list they actually see, so use that for them.
  const jobsBadgeCount = isTechnician ? jobsPag.total : stats.jobs;

  return (
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">
          <CalendarClock size={16} />
        </div>
        Field Scheduler
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section-title">Menu</div>
        {visibleNavItems.map((item) => (
          <button
            key={item.view}
            class={`sidebar-item ${currentView === item.view ? "active" : ""}`}
            onClick={() => navigate(item.path)}
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
