import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatMoney, formatTime, formatDate } from "../format";
import { CalendarDays, CheckCircle, Receipt } from "lucide-preact";

export function Dashboard() {
  const { stats, navigate, jobs, invoices, estimates } = useApp();

  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = jobs
    .filter((j) => j.scheduled_date === todayStr && j.status !== "cancelled")
    .sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));

  const outstandingInvoices = invoices
    .filter((inv) => inv.status === "sent" || inv.status === "overdue")
    .slice(0, 6);

  const recentEstimates = [...estimates]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 6);

  return (
    <div class="page">
      <div class="page-header">
        <h1>Dashboard</h1>
      </div>

      {/* One designed strip of figures — revenue carries the visual weight */}
      <div class="kpi-strip">
        <button class="kpi kpi-revenue" onClick={() => navigate("/invoices")}>
          <span class="kpi-label">Revenue</span>
          <span class="kpi-value">{formatMoney(stats.revenue)}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/invoices")}>
          <span class="kpi-label">Open Invoices</span>
          <span class="kpi-value">{stats.invoices_outstanding}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/invoices")}>
          <span class="kpi-label">Overdue</span>
          <span class={`kpi-value ${stats.invoices_overdue > 0 ? "danger" : "quiet"}`}>{stats.invoices_overdue}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/jobs")}>
          <span class="kpi-label">Today's Jobs</span>
          <span class="kpi-value">{stats.today_jobs}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/jobs")}>
          <span class="kpi-label">Upcoming</span>
          <span class="kpi-value">{stats.upcoming_jobs}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/jobs")}>
          <span class="kpi-label">Completed</span>
          <span class="kpi-value">{stats.completed_jobs}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/jobs")}>
          <span class="kpi-label">Total Jobs</span>
          <span class="kpi-value">{stats.jobs}</span>
        </button>
        <button class="kpi" onClick={() => navigate("/customers")}>
          <span class="kpi-label">Customers</span>
          <span class="kpi-value">{stats.customers}</span>
        </button>
      </div>

      <div class="dash-grid">
        {/* Today's schedule */}
        <div class="panel dash-schedule">
          <div class="panel-header">
            <span class="panel-title">Today's Schedule</span>
            <button class="btn btn-sm" onClick={() => navigate("/schedule")}>View schedule</button>
          </div>
          <div class="panel-body" style={{ padding: 0 }}>
            {todayJobs.length === 0 ? (
              <div class="empty-state">
                <CalendarDays size={30} />
                <p>No jobs scheduled for today</p>
                <button class="btn btn-primary btn-sm" onClick={() => navigate("/jobs")}>Schedule a job</button>
              </div>
            ) : (
              <div class="table-wrap">
                <table class="table table-flow">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Technician</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayJobs.map((job) => (
                      <tr key={job.id} class="table-row clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
                        <td class="text-muted nowrap fc-lead">{formatTime(job.scheduled_time)}</td>
                        <td class="fc-lead"><span class="identifier">{job.identifier}</span></td>
                        <td class="fc-full">{job.customer_name || "—"}</td>
                        <td>
                          {job.technician_name ? (
                            <span class="tech-pill" style={{ borderColor: job.technician_color || "#ccc" }}>
                              <span class="tech-dot" style={{ background: job.technician_color || "#ccc" }} />
                              {job.technician_name}
                            </span>
                          ) : (
                            <span class="text-muted">Unassigned</span>
                          )}
                        </td>
                        <td class="fc-end"><StatusBadge status={job.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div class="panel dash-invoices">
          <div class="panel-header">
            <span class="panel-title">Outstanding Invoices</span>
            <button class="btn btn-sm" onClick={() => navigate("/invoices")}>All</button>
          </div>
          <div class="panel-body" style={{ padding: 0 }}>
            {outstandingInvoices.length === 0 ? (
              <div class="empty-state">
                <CheckCircle size={28} />
                <p>All caught up</p>
              </div>
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <tbody>
                    {outstandingInvoices.map((inv) => (
                      <tr key={inv.id} class="table-row clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td>
                          <span class="identifier">{inv.identifier}</span>
                          <div class="text-muted" style={{ fontSize: 12 }}>{inv.customer_name || "—"}</div>
                        </td>
                        <td><StatusBadge status={inv.status} /></td>
                        <td class="text-right text-bold money">{formatMoney(inv.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div class="panel dash-estimates">
          <div class="panel-header">
            <span class="panel-title">Recent Estimates</span>
            <button class="btn btn-sm" onClick={() => navigate("/estimates")}>All</button>
          </div>
          <div class="panel-body" style={{ padding: 0 }}>
            {recentEstimates.length === 0 ? (
              <div class="empty-state">
                <Receipt size={28} />
                <p>No estimates yet</p>
              </div>
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <tbody>
                    {recentEstimates.map((est) => (
                      <tr key={est.id} class="table-row clickable" onClick={() => navigate(`/estimates/${est.id}`)}>
                        <td>
                          <span class="identifier">{est.identifier || "Draft"}</span>
                          <div class="text-muted" style={{ fontSize: 12 }}>{est.customer_name || "—"} · {formatDate(est.created_at)}</div>
                        </td>
                        <td><StatusBadge status={est.status} /></td>
                        <td class="text-right text-bold money">{formatMoney(est.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
