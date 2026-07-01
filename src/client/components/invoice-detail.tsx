import { useState } from "preact/hooks";
import { useApp } from "../context";
import { ACORN_FINANCE_URL, PAYMENT_TIERS, computePaymentAmount } from "../constants";
import { NobleMark } from "./noble-mark";
import { StatusBadge } from "./status-badge";
import { formatDate, formatDateTime, formatMoney } from "../format";
import { ArrowLeft, Trash2, ExternalLink, CreditCard, Plus } from "lucide-preact";
import type { InvoiceStatus, PaymentMethod } from "../types";

const ALL_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "check", "card", "financing"];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  financing: "Financing",
};

export function InvoiceDetail() {
  const { selectedInvoice: invoice, navigate, updateInvoice, deleteInvoice, addInvoiceLine, deleteInvoiceLine, brands, recordPayment, setError } = useApp();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [customAmount, setCustomAmount] = useState("");
  const [recording, setRecording] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("0");

  if (!invoice) return null;

  const handleAddLine = async () => {
    if (!lineDesc.trim()) return;
    await addInvoiceLine(invoice.id, {
      description: lineDesc.trim(),
      quantity: parseFloat(lineQty) || 0,
      unit_price: parseFloat(linePrice) || 0,
    });
    setLineDesc("");
    setLineQty("1");
    setLinePrice("0");
    setShowAddLine(false);
  };

  const tierAmount = computePaymentAmount(invoice.total, paymentMethod).amount;

  // Resolve the brand record (for a logo) from the invoice's brand_id.
  const brand = invoice.brand_id ? brands.find((b) => b.id === invoice.brand_id) : undefined;
  const orgName = invoice.brand_name || "Noble CRM";

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
          {/* Letterhead — makes the invoice read as a sendable document */}
          <div class="doc-letterhead">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              {brand?.logo_r2_key ? (
                <img class="doc-logo" src={`/api/r2/${brand.logo_r2_key}`} alt={orgName} />
              ) : (
                <NobleMark size={46} />
              )}
              <div>
                <div class="doc-org-name">{orgName}</div>
                <div class="doc-org-meta">Tampa, FL</div>
              </div>
            </div>
            <div>
              <div class="doc-title">Invoice</div>
              <div class="doc-title-sub">{invoice.identifier}</div>
              <div class="doc-title-sub">{formatDate(invoice.created_at)}</div>
            </div>
          </div>

          <div class="detail-title-row">
            <span class="identifier-lg">{invoice.identifier}</span>
            <StatusBadge status={invoice.status} />
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
                <span class="brand-chip">
                  <span class="brand-chip-dot" style={{ background: invoice.brand_color_primary || "#ccc" }} />
                  {invoice.brand_name}
                </span>
              </div>
            )}
            <div class="detail-meta-item">
              <span class="detail-meta-label">Due Date</span>
              <span>{formatDate(invoice.due_date)}</span>
            </div>
            {invoice.paid_date && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Paid Date</span>
                <span>{formatDate(invoice.paid_date)}</span>
              </div>
            )}
          </div>

          {/* Line items */}
          <div class="detail-section">
            <h3>Line Items</h3>
            <div class="card">
              <table class="table">
                <thead>
                  <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th class="text-right">Total</th><th></th></tr>
                </thead>
                <tbody>
                  {(invoice.lines || []).map((line) => (
                    <tr key={line.id} class="table-row">
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td class="money">{formatMoney(line.unit_price)}</td>
                      <td class="text-right money">{formatMoney(line.total)}</td>
                      <td>
                        <button class="btn-icon danger" onClick={() => deleteInvoiceLine(line.id, invoice.id)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} class="text-right text-muted">Subtotal</td>
                    <td class="text-right money">{formatMoney(invoice.subtotal)}</td>
                    <td></td>
                  </tr>
                  {invoice.tax_rate > 0 && (
                    <tr>
                      <td colSpan={3} class="text-right text-muted">Tax ({invoice.tax_rate}%)</td>
                      <td class="text-right money">{formatMoney(invoice.tax_amount)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} class="text-right text-bold">Total</td>
                    <td class="text-right text-bold money" style={{ fontSize: 16 }}>{formatMoney(invoice.total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {showAddLine ? (
              <div class="note-input-row" style={{ marginTop: 12 }}>
                <input type="text" value={lineDesc} onInput={(e) => setLineDesc((e.target as HTMLInputElement).value)} placeholder="Description" style={{ flex: 2 }} />
                <input type="number" step="0.01" min="0" value={lineQty} onInput={(e) => setLineQty((e.target as HTMLInputElement).value)} style={{ width: 70 }} placeholder="Qty" />
                <input type="number" step="0.01" min="0" value={linePrice} onInput={(e) => setLinePrice((e.target as HTMLInputElement).value)} style={{ width: 90 }} placeholder="Unit Price" />
                <button class="btn btn-primary btn-sm" onClick={handleAddLine}>Add</button>
                <button class="btn btn-sm" onClick={() => setShowAddLine(false)}>Cancel</button>
              </div>
            ) : (
              <button class="btn btn-sm" onClick={() => setShowAddLine(true)} style={{ marginTop: 8 }}>
                <Plus size={14} /> Add Line
              </button>
            )}

            {/* Financing — tasteful on-brand gold chip near the totals */}
            <div style={{ marginTop: 12 }}>
              <a href={ACORN_FINANCE_URL} target="_blank" rel="noopener noreferrer" class="financing-callout">
                <ExternalLink size={14} /> Financing available — pre-qualify now
              </a>
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
                          {surchargeAmount === 0 ? "—" : `${surchargeAmount > 0 ? "+" : ""}${(PAYMENT_TIERS[m] * 100).toFixed(0)}% (${surchargeAmount > 0 ? "+" : ""}${formatMoney(surchargeAmount)})`}
                        </td>
                        <td class="text-right text-bold money">{formatMoney(amount)}</td>
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
                        <td class="text-right money">{formatMoney(p.amount)}</td>
                        <td class="text-right money">{p.surcharge_amount ? `${p.surcharge_amount > 0 ? "+" : ""}${formatMoney(p.surcharge_amount)}` : "—"}</td>
                        <td class="text-muted">{formatDateTime(p.paid_at)}</td>
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
                placeholder={formatMoney(tierAmount)}
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
            <h4>Tax Rate (%)</h4>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={invoice.tax_rate}
              onChange={(e) => updateInvoice(invoice.id, { tax_rate: parseFloat((e.target as HTMLInputElement).value) || 0 })}
            />
          </div>

          <div class="detail-sidebar-section">
            <h4>Due Date</h4>
            <input
              type="date"
              value={invoice.due_date}
              onChange={(e) => updateInvoice(invoice.id, { due_date: (e.target as HTMLInputElement).value })}
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
