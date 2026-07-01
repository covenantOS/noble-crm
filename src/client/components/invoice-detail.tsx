import { useState } from "preact/hooks";
import { useApp } from "../context";
import { ACORN_FINANCE_URL, PAYMENT_TIERS, computePaymentAmount } from "../constants";
import { ArrowLeft, Trash2, ExternalLink, CreditCard } from "lucide-preact";
import type { InvoiceStatus, PaymentMethod } from "../types";

const ALL_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  paid: "#16a34a",
  overdue: "#dc2626",
  cancelled: "#9ca3af",
};

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "check", "card", "financing"];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  financing: "Financing",
};

export function InvoiceDetail() {
  const { selectedInvoice: invoice, navigate, updateInvoice, deleteInvoice, brands, recordPayment, setError } = useApp();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [customAmount, setCustomAmount] = useState("");
  const [recording, setRecording] = useState(false);

  if (!invoice) return null;

  const color = STATUS_COLORS[(invoice.status as InvoiceStatus)] || "#6b7280";

  const tierAmount = computePaymentAmount(invoice.total, paymentMethod).amount;

  const handleRecordPayment = async () => {
    setRecording(true);
    try {
      const amount = customAmount.trim() ? parseFloat(customAmount) : undefined;
      await recordPayment(invoice.id, paymentMethod, amount);
      setCustomAmount("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecording(false);
    }
  };

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

          {/* Payment tiers -- preview of what the customer owes under each
              method (cash/check discount 8%, card surcharges 4%, financing
              surcharges 6% -- see PAYMENT_TIERS in ../constants.ts, kept in
              sync with the server's copy in src/server/index.ts). */}
          <div class="detail-section">
            <h3><CreditCard size={16} style={{ verticalAlign: "text-bottom" }} /> Payments</h3>
            <div class="card">
              <table class="table">
                <thead>
                  <tr><th>Method</th><th>Adjustment</th><th class="text-right">Customer Owes</th></tr>
                </thead>
                <tbody>
                  {PAYMENT_METHODS.map((m) => {
                    const { amount, surchargeAmount } = computePaymentAmount(invoice.total, m);
                    return (
                      <tr key={m} class="table-row">
                        <td>{PAYMENT_METHOD_LABELS[m]}</td>
                        <td class={surchargeAmount < 0 ? "text-muted" : ""}>
                          {surchargeAmount === 0 ? "—" : `${surchargeAmount > 0 ? "+" : ""}${(PAYMENT_TIERS[m] * 100).toFixed(0)}% (${surchargeAmount > 0 ? "+" : ""}$${surchargeAmount.toFixed(2)})`}
                        </td>
                        <td class="text-right text-bold">${amount.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(invoice.payments || []).length > 0 && (
              <div class="card" style={{ marginTop: 10 }}>
                <table class="table">
                  <thead>
                    <tr><th>Method</th><th class="text-right">Amount</th><th class="text-right">Surcharge</th><th>Paid At</th></tr>
                  </thead>
                  <tbody>
                    {(invoice.payments || []).map((p) => (
                      <tr key={p.id} class="table-row">
                        <td>{PAYMENT_METHOD_LABELS[p.method] || p.method}</td>
                        <td class="text-right">${p.amount.toFixed(2)}</td>
                        <td class="text-right">{p.surcharge_amount ? `${p.surcharge_amount > 0 ? "+" : ""}$${p.surcharge_amount.toFixed(2)}` : "—"}</td>
                        <td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div class="note-input-row" style={{ marginTop: 10 }}>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod((e.target as HTMLSelectElement).value as PaymentMethod)} style={{ flex: 1 }}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={`$${tierAmount.toFixed(2)}`}
                value={customAmount}
                onInput={(e) => setCustomAmount((e.target as HTMLInputElement).value)}
                style={{ width: 110 }}
              />
              <button class="btn btn-primary btn-sm" onClick={handleRecordPayment} disabled={recording}>
                {recording ? "Recording..." : "Record Payment"}
              </button>
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
