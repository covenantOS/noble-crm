import { useState } from "preact/hooks";
import { useApp } from "../context";
import { ACORN_FINANCE_URL } from "../constants";
import { ArrowLeft, Trash2, Send, CheckCircle, XCircle, ArrowRightLeft, ExternalLink, Plus } from "lucide-preact";
import type { EstimateStatus } from "../types";

const STATUS_COLORS: Record<EstimateStatus, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  approved: "#16a34a",
  declined: "#dc2626",
  expired: "#9ca3af",
  converted: "#7c3aed",
};

export function EstimateDetail() {
  const {
    selectedEstimate: estimate, navigate, updateEstimate, deleteEstimate,
    sendEstimate, approveEstimate, declineEstimate, addEstimateLine, deleteEstimateLine,
    convertEstimate, brands, setError,
  } = useApp();
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("0");
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ job_id: number; invoice_id: number } | null>(null);

  if (!estimate) return null;

  const color = STATUS_COLORS[(estimate.status as EstimateStatus)] || "#6b7280";

  const handleAddLine = async () => {
    if (!lineDesc.trim()) return;
    await addEstimateLine(estimate.id, {
      description: lineDesc.trim(),
      quantity: parseFloat(lineQty) || 0,
      unit_price: parseFloat(linePrice) || 0,
    });
    setLineDesc("");
    setLineQty("1");
    setLinePrice("0");
    setShowAddLine(false);
  };

  const handleConvert = async () => {
    setConverting(true);
    try {
      const result = await convertEstimate(estimate.id);
      setConvertResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div class="page">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/estimates")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
          {estimate.status === "draft" && (
            <button class="btn" onClick={() => sendEstimate(estimate.id)}>
              <Send size={14} /> Send
            </button>
          )}
          {(estimate.status === "draft" || estimate.status === "sent") && (
            <button class="btn" onClick={() => approveEstimate(estimate.id)}>
              <CheckCircle size={14} /> Approve
            </button>
          )}
          {(estimate.status === "draft" || estimate.status === "sent") && (
            <button class="btn" onClick={() => declineEstimate(estimate.id)}>
              <XCircle size={14} /> Decline
            </button>
          )}
          {estimate.status === "approved" && (
            <button class="btn btn-primary" onClick={handleConvert} disabled={converting}>
              <ArrowRightLeft size={14} /> {converting ? "Converting..." : "Convert to Job"}
            </button>
          )}
          <button class="btn btn-danger" onClick={() => deleteEstimate(estimate.id)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {convertResult && (
        <div class="card" style={{ padding: 12, marginBottom: 16, borderColor: "#16a34a" }}>
          <strong>Converted successfully.</strong>{" "}
          <a href={`/jobs/${convertResult.job_id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${convertResult.job_id}`); }}>View Job</a>
          {" · "}
          <a href={`/invoices/${convertResult.invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${convertResult.invoice_id}`); }}>View Invoice</a>
        </div>
      )}

      <div class="detail-layout">
        <div class="detail-main">
          <div class="detail-title-row">
            <span class="identifier-lg">{estimate.identifier}</span>
            <span class="status-badge" style={{ background: `${color}14`, color, borderColor: `${color}30` }}>
              <span class="status-dot" style={{ background: color }} />
              {estimate.status}
            </span>
          </div>

          <div class="detail-meta-grid">
            <div class="detail-meta-item">
              <span class="detail-meta-label">Customer</span>
              <span>{estimate.customer_name || "—"}</span>
            </div>
            {estimate.brand_name && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Brand</span>
                <span class="service-pill" style={{ borderColor: estimate.brand_color_primary || "#ccc" }}>
                  <span class="service-dot" style={{ background: estimate.brand_color_primary || "#ccc" }} />
                  {estimate.brand_name}
                </span>
              </div>
            )}
            <div class="detail-meta-item">
              <span class="detail-meta-label">Valid Until</span>
              <span>{estimate.valid_until || "Not set"}</span>
            </div>
            {estimate.approved_at && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Approved</span>
                <span>{estimate.approved_at}</span>
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
                  <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th class="text-right">Total</th><th></th></tr>
                </thead>
                <tbody>
                  {(estimate.lines || []).map((line) => (
                    <tr key={line.id} class="table-row">
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>${line.unit_price.toFixed(2)}</td>
                      <td class="text-right">${line.total.toFixed(2)}</td>
                      <td>
                        <button class="btn-icon danger" onClick={() => deleteEstimateLine(line.id)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} class="text-right text-muted">Subtotal</td>
                    <td class="text-right">${estimate.subtotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                  {estimate.tax_rate > 0 && (
                    <tr>
                      <td colSpan={3} class="text-right text-muted">Tax ({estimate.tax_rate}%)</td>
                      <td class="text-right">${estimate.tax_amount.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} class="text-right text-bold">Total</td>
                    <td class="text-right text-bold" style={{ fontSize: 16 }}>${estimate.total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {showAddLine ? (
              <div class="note-input-row">
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
          </div>

          {estimate.notes && (
            <div class="detail-section">
              <h3>Notes</h3>
              <p class="detail-notes">{estimate.notes}</p>
            </div>
          )}
        </div>

        <div class="detail-sidebar">
          <div class="detail-sidebar-section">
            <h4>Valid Until</h4>
            <input
              type="date"
              value={estimate.valid_until || ""}
              onChange={(e) => updateEstimate(estimate.id, { valid_until: (e.target as HTMLInputElement).value })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13 }}
            />
          </div>

          <div class="detail-sidebar-section">
            <h4>Tax Rate (%)</h4>
            <input
              type="number"
              step="0.01"
              min="0"
              value={estimate.tax_rate}
              onChange={(e) => updateEstimate(estimate.id, { tax_rate: parseFloat((e.target as HTMLInputElement).value) || 0 })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13 }}
            />
          </div>

          <div class="detail-sidebar-section">
            <h4>Brand</h4>
            <select
              value={estimate.brand_id || ""}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                updateEstimate(estimate.id, { brand_id: val ? parseInt(val, 10) : null });
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
