import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { ACORN_FINANCE_URL } from "../constants";
import { NobleMark } from "./noble-mark";
import { StatusBadge } from "./status-badge";
import { formatDate, formatDateTime, formatMoney } from "../format";
import { ArrowLeft, Trash2, Send, CheckCircle, XCircle, ArrowRightLeft, ExternalLink, Plus, X, Camera, FileDown, Link2, Copy, RefreshCw, Hammer, ChevronDown, ChevronRight, DollarSign } from "lucide-preact";

export function EstimateDetail() {
  const {
    selectedEstimate: estimate, navigate, updateEstimate, deleteEstimate,
    sendEstimate, approveEstimate, declineEstimate, addEstimateLine, deleteEstimateLine,
    convertEstimate, brands, setError, products,
    estimateAttachments, fetchEstimateAttachments, uploadAttachment, deleteAttachment,
    setEstimateDeposit,
    estimateRooms, fetchEstimateRooms, addEstimateRoom, updateEstimateRoom, deleteEstimateRoom,
    addEstimateSurface, updateEstimateSurface, deleteEstimateSurface,
  } = useApp();
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("0");
  // Product-picker convenience: selecting a product prefills description +
  // unit_price. Purely additive -- a line can still be typed freehand.
  const [linePickedProductId, setLinePickedProductId] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ job_id: number; invoice_id: number; deposit_invoice_id: number | null } | null>(null);
  const photoFileInput = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Send/resend delivery feedback + copy-link confirmation.
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [depositInput, setDepositInput] = useState("");

  // Structured builder UI state.
  const [showBuilder, setShowBuilder] = useState(false);
  const [expandedRooms, setExpandedRooms] = useState<Record<number, boolean>>({});
  const [newRoomName, setNewRoomName] = useState("");
  const [surfaceForms, setSurfaceForms] = useState<Record<number, { surface_type: string; measurement: string; prep_notes: string; coats: string; paint_product: string; labor_cost: string; material_cost: string }>>({});

  useEffect(() => {
    if (estimate) fetchEstimateAttachments(estimate.id);
  }, [estimate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (estimate) fetchEstimateRooms(estimate.id);
  }, [estimate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDepositInput(estimate?.deposit_amount != null ? String(estimate.deposit_amount) : "");
  }, [estimate?.id, estimate?.deposit_amount]);

  if (!estimate) return null;

  const isDraft = estimate.status === "draft";
  const canSetDeposit = estimate.status === "draft" || estimate.status === "sent" || estimate.status === "approved";

  const toggleRoom = (roomId: number) => setExpandedRooms((prev) => ({ ...prev, [roomId]: !prev[roomId] }));

  const handleAddRoom = async () => {
    if (!newRoomName.trim()) return;
    await addEstimateRoom(estimate.id, newRoomName.trim());
    setNewRoomName("");
  };

  const defaultSurfaceForm = { surface_type: "", measurement: "", prep_notes: "", coats: "2", paint_product: "", labor_cost: "0", material_cost: "0" };

  const handleAddSurface = async (roomId: number) => {
    const form = surfaceForms[roomId] || defaultSurfaceForm;
    if (!form.surface_type.trim()) return;
    await addEstimateSurface(roomId, estimate.id, {
      surface_type: form.surface_type.trim(),
      measurement: parseFloat(form.measurement) || 0,
      prep_notes: form.prep_notes.trim() || undefined,
      coats: parseInt(form.coats, 10) || 2,
      paint_product: form.paint_product.trim() || undefined,
      labor_cost: parseFloat(form.labor_cost) || 0,
      material_cost: parseFloat(form.material_cost) || 0,
    });
    setSurfaceForms((prev) => ({ ...prev, [roomId]: defaultSurfaceForm }));
  };

  const handleSaveDeposit = async () => {
    const val = depositInput.trim();
    await setEstimateDeposit(estimate.id, val ? parseFloat(val) || 0 : null);
  };

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
    setLinePickedProductId("");
    setShowAddLine(false);
  };

  // Product-picker convenience: prefills description + unit_price from the
  // selected product. Additive only -- doesn't stop the fields being
  // hand-edited afterward.
  const handlePickProduct = (productId: string) => {
    setLinePickedProductId(productId);
    const product = products.find((p) => String(p.id) === productId);
    if (product) {
      setLineDesc(product.name);
      setLinePrice(String(product.unit_cost));
    }
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

  // The public customer link (only exists once the estimate has a token, i.e.
  // after it's been sent). Absolute URL so it can be copied and shared.
  const publicUrl = estimate.public_token ? `${window.location.origin}/p/e/${estimate.public_token}` : null;

  // Send (draft -> sent): mints the token + tries to email the customer.
  // Surfaces an honest delivery notice (email actually sent, vs link ready
  // to copy when no email provider is configured).
  const doSend = async () => {
    setSending(true);
    setSendNotice(null);
    try {
      const res = await sendEstimate(estimate.id);
      setSendNotice(
        res.email_sent
          ? "Sent — the customer was emailed their estimate link."
          : `Estimate marked as sent. Email wasn't delivered (${res.email_reason || "no email provider configured"}) — copy the link below to share it.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the link — select and copy it manually.");
    }
  };

  // Open the estimate PDF in a new tab (authed route).
  const downloadPdf = () => window.open(`/api/estimates/${estimate.id}/pdf`, "_blank", "noopener");

  return (
    <div class="page page-doc">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/estimates")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
          {estimate.status === "draft" && (
            <button class="btn" onClick={doSend} disabled={sending}>
              <Send size={14} /> {sending ? "Sending..." : "Send"}
            </button>
          )}
          {estimate.status === "sent" && (
            <button class="btn" onClick={doSend} disabled={sending} title="Re-email the customer their link">
              <RefreshCw size={14} /> {sending ? "Resending..." : "Resend"}
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
          <button class="btn" onClick={downloadPdf} title="Open a branded PDF of this estimate">
            <FileDown size={14} /> PDF
          </button>
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
          {convertResult.deposit_invoice_id && (
            <>
              {" · "}
              <a href={`/invoices/${convertResult.deposit_invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${convertResult.deposit_invoice_id}`); }}>View Deposit Invoice</a>
            </>
          )}
        </div>
      )}

      {sendNotice && (
        <div class="card" style={{ padding: 12, marginBottom: 16, borderColor: "var(--gold)" }}>
          {sendNotice}
        </div>
      )}

      {/* Public customer link — always shown once the estimate has been sent
          (it has a token). Copyable so the office can share it directly even
          when no email provider is configured. */}
      {publicUrl && (
        <div class="card" style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontWeight: 600, color: "var(--navy-deep)" }}>
            <Link2 size={15} /> Customer link
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 13, wordBreak: "break-all", flex: 1 }}>{publicUrl}</a>
            <button class="btn btn-sm" onClick={copyLink}>
              <Copy size={13} /> {copied ? "Copied!" : "Copy"}
            </button>
            <a class="btn btn-sm" href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> Open
            </a>
          </div>
          <div class="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
            This is what the customer sees — they can review, e-sign, and accept or decline from here.
          </div>
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
            {estimate.signed_name && (
              <div class="detail-meta-item">
                <span class="detail-meta-label">Signed By</span>
                <span>{estimate.signed_name}{estimate.signed_at ? ` · ${formatDateTime(estimate.signed_at)}` : ""}</span>
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
              <div style={{ marginTop: 12 }}>
                {products.length > 0 && (
                  <div class="note-input-row" style={{ marginBottom: 6 }}>
                    <select value={linePickedProductId} onChange={(e) => handlePickProduct((e.target as HTMLSelectElement).value)} style={{ flex: 1 }}>
                      <option value="">Prefill from product catalog (optional)...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.brand_name ? ` (${p.brand_name})` : ""} — {formatMoney(p.unit_cost)}/{p.unit}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div class="note-input-row">
                  <input type="text" value={lineDesc} onInput={(e) => setLineDesc((e.target as HTMLInputElement).value)} placeholder="Description" style={{ flex: 2 }} />
                  <input type="number" step="0.01" min="0" value={lineQty} onInput={(e) => setLineQty((e.target as HTMLInputElement).value)} style={{ width: 70 }} placeholder="Qty" />
                  <input type="number" step="0.01" min="0" value={linePrice} onInput={(e) => setLinePrice((e.target as HTMLInputElement).value)} style={{ width: 90 }} placeholder="Unit Price" />
                  <button class="btn btn-primary btn-sm" onClick={handleAddLine}>Add</button>
                  <button class="btn btn-sm" onClick={() => setShowAddLine(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button class="btn btn-sm" onClick={() => setShowAddLine(true)} style={{ marginTop: 8 }}>
                <Plus size={14} /> Add Line
              </button>
            )}
          </div>

          {/* Structured builder -- rooms -> surfaces -> coats/prep/paint spec,
              labor vs materials. Optional: an estimate can still use plain
              flat lines above without ever touching this. Only editable
              while the estimate is draft (frozen/read-only after send). */}
          <div class="detail-section">
            <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span><Hammer size={16} style={{ verticalAlign: "text-bottom" }} /> Builder{estimateRooms.length > 0 ? ` (${estimateRooms.length} room${estimateRooms.length === 1 ? "" : "s"})` : ""}</span>
              <button class="btn btn-sm" onClick={() => setShowBuilder((v) => !v)}>
                {showBuilder ? "Hide" : estimateRooms.length > 0 ? "Show" : "Add Rooms & Surfaces"}
              </button>
            </h3>
            {showBuilder && (
              <div class="card" style={{ padding: 14 }}>
                {!isDraft && (
                  <p class="text-muted" style={{ marginTop: 0, fontSize: 12.5 }}>
                    This estimate is {estimate.status} -- the structured breakdown is frozen and read-only.
                  </p>
                )}
                {estimateRooms.map((room) => {
                  const form = surfaceForms[room.id] || defaultSurfaceForm;
                  const expanded = !!expandedRooms[room.id];
                  return (
                    <div key={room.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button class="btn-icon" onClick={() => toggleRoom(room.id)}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <strong style={{ flex: 1 }}>{room.name}</strong>
                        <span class="text-muted" style={{ fontSize: 12 }}>{(room.surfaces || []).length} surface{(room.surfaces || []).length === 1 ? "" : "s"}</span>
                        {isDraft && (
                          <button class="btn-icon danger" onClick={() => deleteEstimateRoom(room.id, estimate.id)}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div style={{ marginTop: 10, marginLeft: 22 }}>
                          {(room.surfaces || []).map((s) => (
                            <div key={s.id} class="card" style={{ padding: 10, marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <strong style={{ textTransform: "capitalize" }}>{s.surface_type}</strong>
                                {isDraft && (
                                  <button class="btn-icon danger" onClick={() => deleteEstimateSurface(s.id, estimate.id)}>
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                              <div class="text-muted" style={{ fontSize: 12.5 }}>
                                {s.measurement} {s.measurement === 1 ? "unit" : "units"} · {s.coats} coat{s.coats === 1 ? "" : "s"}
                                {s.paint_product ? ` · ${s.paint_product}` : ""}
                              </div>
                              {s.prep_notes && <div class="text-muted" style={{ fontSize: 12.5 }}>Prep: {s.prep_notes}</div>}
                              <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
                                <span>Labor: <span class="money">{formatMoney(s.labor_cost)}</span></span>
                                <span>Materials: <span class="money">{formatMoney(s.material_cost)}</span></span>
                                <span class="text-bold">Total: <span class="money">{formatMoney(s.labor_cost + s.material_cost)}</span></span>
                              </div>
                            </div>
                          ))}
                          {isDraft && (
                            <div class="card" style={{ padding: 10, background: "var(--row-hover)" }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                <input type="text" placeholder="Surface (e.g. Walls, Trim, Cabinets)" value={form.surface_type}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, surface_type: (e.target as HTMLInputElement).value } }))}
                                  style={{ flex: 2, minWidth: 140 }} />
                                <input type="number" step="0.01" min="0" placeholder="Sqft/Linear ft" value={form.measurement}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, measurement: (e.target as HTMLInputElement).value } }))}
                                  style={{ width: 110 }} />
                                <input type="number" step="1" min="1" placeholder="Coats" value={form.coats}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, coats: (e.target as HTMLInputElement).value } }))}
                                  style={{ width: 70 }} />
                              </div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                <input type="text" placeholder="Paint product (e.g. SW Duration, Eggshell, Dover White)" value={form.paint_product}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, paint_product: (e.target as HTMLInputElement).value } }))}
                                  style={{ flex: 1, minWidth: 180 }} />
                                <input type="text" placeholder="Prep notes" value={form.prep_notes}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, prep_notes: (e.target as HTMLInputElement).value } }))}
                                  style={{ flex: 1, minWidth: 180 }} />
                              </div>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input type="number" step="0.01" min="0" placeholder="Labor $" value={form.labor_cost}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, labor_cost: (e.target as HTMLInputElement).value } }))}
                                  style={{ width: 100 }} />
                                <input type="number" step="0.01" min="0" placeholder="Material $" value={form.material_cost}
                                  onInput={(e) => setSurfaceForms((prev) => ({ ...prev, [room.id]: { ...form, material_cost: (e.target as HTMLInputElement).value } }))}
                                  style={{ width: 100 }} />
                                <button class="btn btn-primary btn-sm" onClick={() => handleAddSurface(room.id)}>
                                  <Plus size={14} /> Add Surface
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {isDraft && (
                  <div class="note-input-row" style={{ marginTop: 4 }}>
                    <input type="text" placeholder="Room name (e.g. Living Room, Exterior - North Wall)" value={newRoomName}
                      onInput={(e) => setNewRoomName((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddRoom()} />
                    <button class="btn btn-primary btn-sm" onClick={handleAddRoom}>
                      <Plus size={14} /> Add Room
                    </button>
                  </div>
                )}
                {estimateRooms.length === 0 && !isDraft && (
                  <p class="text-muted" style={{ margin: 0 }}>No structured rooms/surfaces on this estimate -- it uses plain line items.</p>
                )}
                <p class="text-muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                  Each surface auto-generates a matching line item above (labor + materials = line total) -- the Line Items table and totals stay in sync automatically.
                </p>
              </div>
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
            <h4><DollarSign size={13} style={{ verticalAlign: "text-bottom" }} /> Deposit</h4>
            {canSetDeposit ? (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={estimate.total || undefined}
                  placeholder="No deposit"
                  value={depositInput}
                  onInput={(e) => setDepositInput((e.target as HTMLInputElement).value)}
                  onBlur={handleSaveDeposit}
                />
                <p class="text-muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  If set, converting this estimate mints a second "Deposit" invoice (due immediately) alongside the full-value invoice.
                </p>
              </>
            ) : (
              <span>{estimate.deposit_amount ? formatMoney(estimate.deposit_amount) : "—"}</span>
            )}
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
