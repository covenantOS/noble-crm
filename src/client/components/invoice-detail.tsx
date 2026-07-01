import { useApp } from "../context";
import { ACORN_FINANCE_URL } from "../constants";
import { ArrowLeft, Trash2, ExternalLink } from "lucide-preact";
import type { InvoiceStatus } from "../types";

const ALL_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  paid: "#16a34a",
  overdue: "#dc2626",
  cancelled: "#9ca3af",
};

export function InvoiceDetail() {
  const { selectedInvoice: invoice, navigate, updateInvoice, deleteInvoice, brands } = useApp();

  if (!invoice) return null;

  const color = STATUS_COLORS[(invoice.status as InvoiceStatus)] || "#6b7280";

  return (
    <div class="page">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/invoices")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
          <button class="btn btn-danger" onClick={() => deleteInvoice(invoice.id)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="detail-title-row">
            <span class="identifier-lg">{invoice.identifier}</span>
            <span class="status-badge" style={{ background: `${color}14`, color, borderColor: `${color}30` }}>
              <span class="status-dot" style={{ background: color }} />
              {invoice.status}
            </span>
          </div>

          <div class="detail-meta-grid">
            <div class="detail-meta-item">
              <span class="detail-meta-label">Customer</span>
              <span>{invoice.customer_name || "—"}</span>
            </div>
            {invoice.job_identifier && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Job</span>
                <span class="identifier">{invoice.job_identifier}</span>
              </div>
            )}
            {invoice.brand_name && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Brand</span>
                <span class="service-pill" style={{ borderColor: invoice.brand_color_primary || "#ccc" }}>
                  <span class="service-dot" style={{ background: invoice.brand_color_primary || "#ccc" }} />
                  {invoice.brand_name}
                </span>
              </div>
            )}
            <div class="detail-meta-item">
              <span class="detail-meta-label">Due Date</span>
              <span>{invoice.due_date || "Not set"}</span>
            </div>
            {invoice.paid_date && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Paid Date</span>
                <span>{invoice.paid_date}</span>
              </div>
            )}
          </div>

          {/* Financing CTA */}
          <div class="card" style={{ padding: 12, marginTop: 12, marginBottom: 12 }}>
            <a href={ACORN_FINANCE_URL} target="_blank" rel="noopener noreferrer" class="btn btn-primary">
              <ExternalLink size={14} /> Financing available — pre-qualify now
            </a>
          </div>

          {/* Line items */}
          <div class="detail-section">
            <h3>Line Items</h3>
            <div class="card">
              <table class="table">
                <thead>
                  <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th class="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {(invoice.lines || []).map((line) => (
                    <tr key={line.id} class="table-row">
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>${line.unit_price.toFixed(2)}</td>
                      <td class="text-right">${line.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} class="text-right text-muted">Subtotal</td>
                    <td class="text-right">${invoice.subtotal.toFixed(2)}</td>
                  </tr>
                  {invoice.tax_rate > 0 && (
                    <tr>
                      <td colSpan={3} class="text-right text-muted">Tax ({invoice.tax_rate}%)</td>
                      <td class="text-right">${invoice.tax_amount.toFixed(2)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} class="text-right text-bold">Total</td>
                    <td class="text-right text-bold" style={{ fontSize: 16 }}>${invoice.total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {invoice.notes && (
            <div class="detail-section">
              <h3>Notes</h3>
              <p class="detail-notes">{invoice.notes}</p>
            </div>
          )}
        </div>

        <div class="detail-sidebar">
          <div class="detail-sidebar-section">
            <h4>Status</h4>
            <div class="status-buttons">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  class={`status-btn ${invoice.status === s ? "active" : ""}`}
                  onClick={() => updateInvoice(invoice.id, { status: s, ...(s === "paid" ? { paid_date: new Date().toISOString().split("T")[0] } : {}) })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div class="detail-sidebar-section">
            <h4>Due Date</h4>
            <input
              type="date"
              value={invoice.due_date}
              onChange={(e) => updateInvoice(invoice.id, { due_date: (e.target as HTMLInputElement).value })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13 }}
            />
          </div>

          <div class="detail-sidebar-section">
            <h4>Brand</h4>
            <select
              value={invoice.brand_id || ""}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                updateInvoice(invoice.id, { brand_id: val ? parseInt(val, 10) : null });
              }}
            >
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
