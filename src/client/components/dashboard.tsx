import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatMoney, formatTime, formatDate } from "../format";
import { Briefcase, Users, CalendarCheck, DollarSign, Clock, CheckCircle, FileText, AlertCircle, CalendarDays, Receipt } from "lucide-preact";

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

      <div class="stats-grid">
        <button class="stat-card" onClick={() => navigate("/jobs")}>
          <div class="stat-icon"><Briefcase size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.jobs}</div>
            <div class="stat-label">Total Jobs</div>
          </div>
        </button>
        <button class="stat-card" onClick={() => navigate("/customers")}>
          <div class="stat-icon"><Users size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.customers}</div>
            <div class="stat-label">Customers</div>
          </div>
        </button>
        <button class="stat-card" onClick={() => navigate("/jobs")}>
          <div class="stat-icon"><Clock size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.today_jobs}</div>
            <div class="stat-label">Today's Jobs</div>
          </div>
        </button>
        <button class="stat-card" onClick={() => navigate("/jobs")}>
          <div class="stat-icon"><CalendarCheck size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.upcoming_jobs}</div>
            <div class="stat-label">Upcoming</div>
          </div>
        </button>
        <button class="stat-card" onClick={() => navigate("/jobs")}>
          <div class="stat-icon"><CheckCircle size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.completed_jobs}</div>
            <div class="stat-label">Completed</div>
          </div>
        </button>
        <button class="stat-card accent" onClick={() => navigate("/invoices")}>
          <div class="stat-icon"><DollarSign size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{formatMoney(stats.revenue)}</div>
            <div class="stat-label">Revenue</div>
          </div>
        </button>
        <button class="stat-card" onClick={() => navigate("/invoices")}>
          <div class="stat-icon"><FileText size={20} /></div>
          <div class="stat-body">
            <div class="stat-value">{stats.invoices_outstanding}</div>
            <div class="stat-label">Outstanding Invoices</div>
          </div>
        </button>
        {stats.invoices_overdue > 0 && (
          <button class="stat-card" onClick={() => navigate("/invoices")}>
            <div class="stat-icon"><AlertCircle size={20} /></div>
            <div class="stat-body">
              <div class="stat-value">{stats.invoices_overdue}</div>
              <div class="stat-label">Overdue</div>
            </div>
          </button>
        )}
      </div>

      <div class="dash-grid">
        {/* Wide left: today's schedule */}
        <div class="panel">
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
                <table class="table">
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
                        <td class="text-muted">{formatTime(job.scheduled_time)}</td>
                        <td><span class="identifier">{job.identifier}</span></td>
                        <td>{job.customer_name || "—"}</td>
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
                        <td><StatusBadge status={job.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: outstanding invoices + recent estimates */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Outstanding Invoices</span>
              <button class="btn btn-sm" onClick={() => navigate("/invoices")}>All</button>
            </div>
            <div class="panel-body" style={{ padding: 0 }}>
              {outstandingInvoices.length === 0 ? (
                <div class="empty-state" style={{ padding: "34px 24px" }}>
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

          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Recent Estimates</span>
              <button class="btn btn-sm" onClick={() => navigate("/estimates")}>All</button>
            </div>
            <div class="panel-body" style={{ padding: 0 }}>
              {recentEstimates.length === 0 ? (
                <div class="empty-state" style={{ padding: "34px 24px" }}>
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
    </div>
  );
}
