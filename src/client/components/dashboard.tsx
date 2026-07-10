import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatMoney, formatTime, formatDate } from "../format";
import { api } from "../api";
import { CalendarDays, CheckCircle, Receipt, Sparkles, AlertTriangle, Clock } from "lucide-preact";

type DigestSentence = { text: string; href: string; tone: "neutral" | "good" | "warn" | "danger" };
type TodayData = {
  date: string;
  jobs: Array<{
    id: number;
    identifier: string | null;
    scheduled_time: string | null;
    status: string;
    customer_name: string | null;
    technician_name: string | null;
    address: string | null;
  }>;
  estimates_awaiting: Array<{
    id: number;
    identifier: string | null;
    customer_name: string | null;
    total: number;
    age_days: number;
  }>;
  overdue_invoices: Array<{
    id: number;
    identifier: string | null;
    customer_name: string | null;
    total: number;
    days_overdue: number;
  }>;
  signed_overnight: Array<{
    id: number;
    identifier: string | null;
    customer_name: string | null;
    total: number;
  }>;
};

export function Dashboard() {
  const { stats, navigate, jobs, invoices, estimates, activeBrandId, currentUser } = useApp();
  const [digest, setDigest] = useState<{ sentences: DigestSentence[]; brand_label: string; claude_ready: boolean } | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeBrandId !== null) params.set("brand_id", String(activeBrandId));
    const q = params.toString() ? `?${params}` : "";
    let cancelled = false;
    Promise.all([
      api<{ sentences: DigestSentence[]; brand_label: string; claude_ready: boolean }>("GET", `/api/digest${q}`),
      api<TodayData>("GET", `/api/today${q}`),
    ]).then(([d, t]) => {
      if (cancelled) return;
      setDigest(d);
      setToday(t);
    }).catch(() => { /* dashboard still works from client cache */ });
    return () => { cancelled = true; };
  }, [activeBrandId]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayJobs = (today?.jobs?.length
    ? today.jobs.map((j) => ({
      id: j.id,
      identifier: j.identifier || "",
      scheduled_time: j.scheduled_time,
      status: j.status as any,
      customer_name: j.customer_name || undefined,
      technician_name: j.technician_name || undefined,
      technician_color: undefined as string | undefined,
    }))
    : jobs
      .filter((j) => j.scheduled_date === todayStr && j.status !== "cancelled")
      .sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""))
  );

  const outstandingInvoices = invoices
    .filter((inv) => inv.status === "sent" || inv.status === "overdue")
    .slice(0, 6);

  const recentEstimates = [...estimates]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 6);

  const isAdmin = currentUser?.role === "admin";

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Today</h1>
          <p class="page-sub">
            {today?.date || todayStr}
            {digest ? ` · ${digest.brand_label}` : ""}
            {" · "}
            <span class="text-muted">⌘K search · assistant bottom-right</span>
          </p>
        </div>
        {isAdmin && (
          <button
            class="btn btn-sm"
            onClick={() => window.dispatchEvent(new CustomEvent("noble:demo-reset"))}
            title="Wipe and reseed Sunshine Painting demo"
          >
            Reset demo
          </button>
        )}
      </div>

      {/* Narrative digest — C14 owner intelligence */}
      {digest && digest.sentences.length > 0 && (
        <div class="digest-card">
          <div class="digest-card-header">
            <Sparkles size={16} />
            <span>Owner brief</span>
            {!digest.claude_ready && <span class="digest-badge">keyless AI</span>}
            {digest.claude_ready && <span class="digest-badge digest-badge-on">Claude ready</span>}
          </div>
          <ul class="digest-list">
            {digest.sentences.map((s, i) => (
              <li key={i} class={`digest-line tone-${s.tone}`}>
                <button type="button" onClick={() => navigate(s.href)}>{s.text}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {/* Attention rows from /api/today */}
      {today && (today.overdue_invoices.length > 0 || today.estimates_awaiting.length > 0 || today.signed_overnight.length > 0) && (
        <div class="attention-grid">
          {today.overdue_invoices.length > 0 && (
            <div class="panel attention-panel danger">
              <div class="panel-header">
                <span class="panel-title"><AlertTriangle size={14} /> Overdue AR</span>
                <button class="btn btn-sm" onClick={() => navigate("/invoices")}>All</button>
              </div>
              <div class="panel-body attention-list">
                {today.overdue_invoices.slice(0, 5).map((inv) => (
                  <button key={inv.id} class="attention-row" onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <span class="fc-lead">{inv.identifier || `#${inv.id}`}</span>
                    <span>{inv.customer_name || "—"}</span>
                    <span class="text-muted">{inv.days_overdue}d</span>
                    <span class="fc-lead">{formatMoney(inv.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {today.estimates_awaiting.length > 0 && (
            <div class="panel attention-panel warn">
              <div class="panel-header">
                <span class="panel-title"><Clock size={14} /> Awaiting signature</span>
                <button class="btn btn-sm" onClick={() => navigate("/estimates")}>All</button>
              </div>
              <div class="panel-body attention-list">
                {today.estimates_awaiting.slice(0, 5).map((est) => (
                  <button key={est.id} class="attention-row" onClick={() => navigate(`/estimates/${est.id}`)}>
                    <span class="fc-lead">{est.identifier || `#${est.id}`}</span>
                    <span>{est.customer_name || "—"}</span>
                    <span class={`age-chip ${est.age_days >= 7 ? "hot" : ""}`}>{est.age_days}d</span>
                    <span class="fc-lead">{formatMoney(est.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {today.signed_overnight.length > 0 && (
            <div class="panel attention-panel good">
              <div class="panel-header">
                <span class="panel-title"><CheckCircle size={14} /> Signed overnight</span>
              </div>
              <div class="panel-body attention-list">
                {today.signed_overnight.map((est) => (
                  <button key={est.id} class="attention-row" onClick={() => navigate(`/estimates/${est.id}`)}>
                    <span class="fc-lead">{est.identifier || `#${est.id}`}</span>
                    <span>{est.customer_name || "—"}</span>
                    <span class="fc-lead">{formatMoney(est.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
                            <span class="tech-pill" style={{ borderColor: (job as any).technician_color || "#ccc" }}>
                              <span class="tech-dot" style={{ background: (job as any).technician_color || "#ccc" }} />
                              {job.technician_name}
                            </span>
                          ) : "—"}
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

        {/* Outstanding invoices */}
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Open invoices</span>
            <button class="btn btn-sm" onClick={() => navigate("/invoices")}>View all</button>
          </div>
          <div class="panel-body" style={{ padding: 0 }}>
            {outstandingInvoices.length === 0 ? (
              <div class="empty-state">
                <Receipt size={30} />
                <p>No open invoices</p>
              </div>
            ) : (
              <div class="table-wrap">
                <table class="table table-flow">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Due</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstandingInvoices.map((inv) => (
                      <tr key={inv.id} class="table-row clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td class="fc-lead"><span class="identifier">{inv.identifier}</span></td>
                        <td class="fc-full">{inv.customer_name || "—"}</td>
                        <td class="text-muted nowrap">{formatDate(inv.due_date)}</td>
                        <td class="fc-lead">{formatMoney(inv.total)}</td>
                        <td><StatusBadge status={inv.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent estimates */}
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Recent estimates</span>
            <button class="btn btn-sm" onClick={() => navigate("/estimates")}>View all</button>
          </div>
          <div class="panel-body" style={{ padding: 0 }}>
            {recentEstimates.length === 0 ? (
              <div class="empty-state">
                <CheckCircle size={30} />
                <p>No estimates yet</p>
              </div>
            ) : (
              <div class="table-wrap">
                <table class="table table-flow">
                  <thead>
                    <tr>
                      <th>Estimate</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEstimates.map((est) => (
                      <tr key={est.id} class="table-row clickable" onClick={() => navigate(`/estimates/${est.id}`)}>
                        <td class="fc-lead"><span class="identifier">{est.identifier}</span></td>
                        <td class="fc-full">{est.customer_name || "—"}</td>
                        <td class="fc-lead">{formatMoney(est.total)}</td>
                        <td><StatusBadge status={est.status} /></td>
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
