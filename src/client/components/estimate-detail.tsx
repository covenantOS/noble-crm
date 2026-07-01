import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { ACORN_FINANCE_URL } from "../constants";
import { NobleMark } from "./noble-mark";
import { StatusBadge } from "./status-badge";
import { formatDate, formatDateTime, formatMoney } from "../format";
import { ArrowLeft, Trash2, Send, CheckCircle, XCircle, ArrowRightLeft, ExternalLink, Plus, X, Camera } from "lucide-preact";

export function EstimateDetail() {
  const {
    selectedEstimate: estimate, navigate, updateEstimate, deleteEstimate,
    sendEstimate, approveEstimate, declineEstimate, addEstimateLine, deleteEstimateLine,
    convertEstimate, brands, setError,
    estimateAttachments, fetchEstimateAttachments, uploadAttachment, deleteAttachment,
  } = useApp();
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("0");
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ job_id: number; invoice_id: number } | null>(null);
  const photoFileInput = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (estimate) fetchEstimateAttachments(estimate.id);
  }, [estimate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!estimate) return null;

  const handlePhotoSelected = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      await uploadAttachment("estimate", estimate.id, file, "doc");
    } finally {
      setUploadingPhoto(false);
      input.value = "";
    }
  };

  // Resolve the brand record (for a logo) from the estimate's brand_id.
  const brand = estimate.brand_id ? brands.find((b) => b.id === estimate.brand_id) : undefined;
  const orgName = estimate.brand_name || "Noble CRM";

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
        <div class="card" style={{ padding: 12, marginBottom: 16, borderColor: "var(--success)" }}>
          <strong>Converted successfully.</strong>{" "}
          <a href={`/jobs/${convertResult.job_id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${convertResult.job_id}`); }}>View Job</a>
          {" · "}
          <a href={`/invoices/${convertResult.invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${convertResult.invoice_id}`); }}>View Invoice</a>
        </div>
      )}

      <div class="detail-layout">
        <div class="detail-main">
          {/* Letterhead — makes the estimate read as a sendable document */}
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
              <div class="doc-title">Estimate</div>
              <div class="doc-title-sub">{estimate.identifier || "Draft"}</div>
              <div class="doc-title-sub">{formatDate(estimate.created_at)}</div>
            </div>
          </div>

          <div class="detail-title-row">
            <span class="identifier-lg">{estimate.identifier}</span>
            <StatusBadge status={estimate.status} />
          </div>

          <div class="detail-meta-grid">
            <div class="detail-meta-item">
              <span class="detail-meta-label">Customer</span>
              <span>{estimate.customer_name || "—"}</span>
            </div>
            {estimate.brand_name && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Brand</span>
                <span class="brand-chip">
                  <span class="brand-chip-dot" style={{ background: estimate.brand_color_primary || "#ccc" }} />
                  {estimate.brand_name}
                </span>
              </div>
            )}
            <div class="detail-meta-item">
              <span class="detail-meta-label">Valid Until</span>
              <span>{formatDate(estimate.valid_until)}</span>
            </div>
            {estimate.approved_at && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Approved</span>
                <span>{formatDateTime(estimate.approved_at)}</span>
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
                  {(estimate.lines || []).map((line) => (
                    <tr key={line.id} class="table-row">
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td class="money">{formatMoney(line.unit_price)}</td>
                      <td class="text-right money">{formatMoney(line.total)}</td>
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
                    <td class="text-right money">{formatMoney(estimate.subtotal)}</td>
                    <td></td>
                  </tr>
                  {estimate.tax_rate > 0 && (
                    <tr>
                      <td colSpan={3} class="text-right text-muted">Tax ({estimate.tax_rate}%)</td>
                      <td class="text-right money">{formatMoney(estimate.tax_amount)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} class="text-right text-bold">Total</td>
                    <td class="text-right text-bold money" style={{ fontSize: 16 }}>{formatMoney(estimate.total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Financing — tasteful on-brand gold chip near the totals */}
            <div style={{ marginTop: 12 }}>
              <a href={ACORN_FINANCE_URL} target="_blank" rel="noopener noreferrer" class="financing-callout">
                <ExternalLink size={14} /> Financing available — pre-qualify now
              </a>
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
          </div>

          {/* Photos / supporting documents -- no before/after distinction
              for estimates, just attachments supporting the quote. */}
          <div class="detail-section">
            <h3><Camera size={16} style={{ verticalAlign: "text-bottom" }} /> Photos</h3>
            <div class="photo-gallery">
              {estimateAttachments.map((a) => (
                <div key={a.id} class="photo-thumb">
                  <img src={`/api/r2/${a.r2_key}`} alt={a.filename || "attachment"} />
                  <button class="photo-thumb-remove" onClick={() => deleteAttachment(a.id, "estimate", estimate.id)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button class="photo-thumb-add" disabled={uploadingPhoto} onClick={() => photoFileInput.current?.click()}>
                <Plus size={16} />
              </button>
            </div>
            <input ref={photoFileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoSelected} />
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
