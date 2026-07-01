import { useState } from "preact/hooks";
import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatDate, formatMoney } from "../format";
import { ArrowLeft, Trash2, Edit3, Save, X } from "lucide-preact";
import type { Customer } from "../types";

const SOURCE_LABELS: Record<string, string> = {
  referral: "Referral", google: "Google", repeat: "Repeat", website: "Website", other: "Other",
};

export function CustomerDetail() {
  const {
    selectedCustomer: customer, selectedCustomerJobs: jobs,
    selectedCustomerEstimates: estimates, selectedCustomerInvoices: invoices,
    selectedCustomerOutstanding: outstanding,
    navigate, updateCustomer, deleteCustomer,
  } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", city: "", state: "", zip: "", notes: "", status: "lead", source: "" });

  if (!customer) return null;

  const startEdit = () => {
    setForm({
      name: customer.name, email: customer.email, phone: customer.phone,
      address: customer.address, city: customer.city, state: customer.state,
      zip: customer.zip, notes: customer.notes,
      status: customer.status, source: customer.source || "",
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    await updateCustomer(customer.id, {
      name: form.name, email: form.email, phone: form.phone,
      address: form.address, city: form.city, state: form.state,
      zip: form.zip, notes: form.notes,
      status: form.status as Customer["status"],
      source: form.source ? (form.source as Customer["source"]) : null,
    });
    setEditing(false);
  };

  // Lifetime billed = sum of every invoice total for this customer (their
  // full billed history, regardless of paid/unpaid).
  const lifetimeBilled = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  return (
    <div class="page page-doc">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/customers")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
          {editing ? (
            <>
              <button class="btn" onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
              <button class="btn btn-primary" onClick={saveEdit}><Save size={14} /> Save</button>
            </>
          ) : (
            <>
              <button class="btn" onClick={startEdit}><Edit3 size={14} /> Edit</button>
              <button class="btn btn-danger" onClick={() => deleteCustomer(customer.id)}><Trash2 size={14} /> Delete</button>
            </>
          )}
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          {editing ? (
            <div class="form-grid">
              <div class="form-group full-width">
                <label>Name</label>
                <input type="text" value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onInput={(e) => setForm({ ...form, email: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" value={form.phone} onInput={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group full-width">
                <label>Address</label>
                <input type="text" value={form.address} onInput={(e) => setForm({ ...form, address: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>City</label>
                <input type="text" value={form.city} onInput={(e) => setForm({ ...form, city: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>State</label>
                <input type="text" value={form.state} onInput={(e) => setForm({ ...form, state: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>ZIP</label>
                <input type="text" value={form.zip} onInput={(e) => setForm({ ...form, zip: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="form-group">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: (e.target as HTMLSelectElement).value })}>
                  <option value="lead">Lead</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div class="form-group">
                <label>Source</label>
                <select value={form.source} onChange={(e) => setForm({ ...form, source: (e.target as HTMLSelectElement).value })}>
                  <option value="">Unknown</option>
                  <option value="referral">Referral</option>
                  <option value="google">Google</option>
                  <option value="repeat">Repeat</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group full-width">
                <label>Notes</label>
                <textarea rows={3} value={form.notes} onInput={(e) => setForm({ ...form, notes: (e.target as HTMLTextAreaElement).value })} />
              </div>
            </div>
          ) : (
            <>
              <div class="detail-title-row">
                <h2 class="detail-customer-name" style={{ margin: 0 }}>{customer.name}</h2>
                <StatusBadge status={customer.status} />
              </div>
              <div class="detail-meta-grid">
                <div class="detail-meta-item">
                  <span class="detail-meta-label">Phone</span>
                  <span>{customer.phone || "—"}</span>
                </div>
                <div class="detail-meta-item">
                  <span class="detail-meta-label">Email</span>
                  <span>{customer.email || "—"}</span>
                </div>
                <div class="detail-meta-item">
                  <span class="detail-meta-label">Address</span>
                  <span>{[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ") || "—"}</span>
                </div>
                <div class="detail-meta-item">
                  <span class="detail-meta-label">Source</span>
                  <span>{customer.source ? SOURCE_LABELS[customer.source] || customer.source : "—"}</span>
                </div>
              </div>
              {customer.notes && (
                <div class="detail-section">
                  <h3>Notes</h3>
                  <p class="detail-notes">{customer.notes}</p>
                </div>
              )}
            </>
          )}

          {/* Money summary rollup */}
          <div class="detail-section">
            <div class="kpi-strip kpi-strip-auto">
              <div class="kpi">
                <span class="kpi-label">Lifetime Billed</span>
                <span class="kpi-value money">{formatMoney(lifetimeBilled)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">Outstanding Balance</span>
                <span class="kpi-value money">{formatMoney(outstanding)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">Jobs</span>
                <span class="kpi-value">{jobs.length}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h3>Service History ({jobs.length})</h3>
            {jobs.length === 0 ? (
              <p class="text-muted">No jobs yet</p>
            ) : (
              <div class="card">
                <table class="table">
                  <thead>
                    <tr><th>ID</th><th>Date</th><th>Service</th><th>Technician</th><th>Status</th><th>Warranty</th><th>Price</th></tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} class="table-row clickable" onClick={() => navigate(`/jobs/${j.id}`)}>
                        <td><span class="identifier">{j.identifier}</span></td>
                        <td>{formatDate(j.scheduled_date)}</td>
                        <td>{j.service_type_name || "—"}</td>
                        <td>{j.technician_name || "Unassigned"}</td>
                        <td><StatusBadge status={j.status} /></td>
                        <td class="text-muted">{j.warranty_expires_at ? `Warranty until ${formatDate(j.warranty_expires_at)}` : "—"}</td>
                        <td class="text-right money">{formatMoney(j.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div class="detail-section">
            <h3>Estimates ({estimates.length})</h3>
            {estimates.length === 0 ? (
              <p class="text-muted">No estimates yet</p>
            ) : (
              <div class="card">
                <table class="table">
                  <thead>
                    <tr><th>ID</th><th>Date</th><th>Status</th><th class="text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {estimates.map((e) => (
                      <tr key={e.id} class="table-row clickable" onClick={() => navigate(`/estimates/${e.id}`)}>
                        <td><span class="identifier">{e.identifier || "Draft"}</span></td>
                        <td>{formatDate(e.created_at)}</td>
                        <td><StatusBadge status={e.status} /></td>
                        <td class="text-right money">{formatMoney(e.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div class="detail-section">
            <h3>Invoices ({invoices.length})</h3>
            {invoices.length === 0 ? (
              <p class="text-muted">No invoices yet</p>
            ) : (
              <div class="card">
                <table class="table">
                  <thead>
                    <tr><th>ID</th><th>Date</th><th>Due</th><th>Status</th><th class="text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} class="table-row clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td><span class="identifier">{inv.identifier}</span></td>
                        <td>{formatDate(inv.created_at)}</td>
                        <td>{formatDate(inv.due_date)}</td>
                        <td><StatusBadge status={inv.status} /></td>
                        <td class="text-right money">{formatMoney(inv.total)}</td>
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
