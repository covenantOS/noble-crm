import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { StatusBadge, PriorityBadge } from "./status-badge";
import { formatDate, formatTime, formatDuration, formatDateTime, formatMoney } from "../format";
import { ArrowLeft, Trash2, Send, MapPin, Clock, DollarSign, User, Wrench, Plus, X, CheckSquare, Square, Package, FileText, Palette, Camera, Edit3, Save, CheckCircle, Receipt, GitPullRequestArrow, Check, Ban, Users, ShieldCheck, Star } from "lucide-preact";
import type { AttachmentKind, JobStatus, Priority } from "../types";

const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

// Internal reminder-note plumbing that should never surface to a user (the
// notification provider isn't wired up yet, so these placeholder notes are
// noise). Filtered out of the activity log.
const REMINDER_PLACEHOLDER = "no notification provider configured yet";

const ALL_STATUSES: JobStatus[] = ["scheduled", "confirmed", "in_progress", "completed", "cancelled"];

export function JobDetail() {
  const {
    selectedJob: job, navigate, updateJob, deleteJob,
    addJobNote, deleteJobNote, technicianLookup, isAgent,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    addJobMaterial, deleteJobMaterial, materials, createInvoiceFromJob,
    currentUser, brands, serviceTypes,
    jobAttachments, fetchJobAttachments, uploadAttachment, deleteAttachment,
    jobInvoices, fetchJobInvoices, addJobProgressInvoice,
    jobChangeOrders, fetchJobChangeOrders, addChangeOrder, approveChangeOrder, rejectChangeOrder,
    addJobCrewMember, removeJobCrewMember, requestJobReview,
  } = useApp();
  // Technicians only have ownership of their own job's working fields
  // server-side -- reassignment (customer_id/technician_id), invoicing, and
  // deletion are all blocked for that role (see src/server/index.ts), so
  // don't show controls that imply they can do those things.
  const canManageJob = currentUser?.role !== "technician";
  const [noteText, setNoteText] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [materialQty, setMaterialQty] = useState("1");
  const beforeFileInput = useRef<HTMLInputElement>(null);
  const afterFileInput = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Editable job-details panel (price/date/time/duration/priority/service).
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    price: "", scheduled_date: "", scheduled_time: "", duration: "", priority: "normal", service_type_id: "", end_date: "",
  });

  // Completion flow.
  const [showComplete, setShowComplete] = useState(false);
  const [completionNotesInput, setCompletionNotesInput] = useState("");
  const [warrantyMonthsInput, setWarrantyMonthsInput] = useState("");
  const [completing, setCompleting] = useState(false);

  // Crew (many-to-many job<->technician, admin/office/estimator only).
  const [showAddCrew, setShowAddCrew] = useState(false);
  const [crewTechnicianId, setCrewTechnicianId] = useState("");
  const [crewRole, setCrewRole] = useState("");
  const [addingCrew, setAddingCrew] = useState(false);

  // Review request.
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [requestingReview, setRequestingReview] = useState(false);

  // Progress billing (additional invoices).
  const [showAddProgressInvoice, setShowAddProgressInvoice] = useState(false);
  const [progressDesc, setProgressDesc] = useState("");
  const [progressAmount, setProgressAmount] = useState("");
  const [addingProgress, setAddingProgress] = useState(false);

  // Change orders.
  const [showAddChangeOrder, setShowAddChangeOrder] = useState(false);
  const [coDesc, setCoDesc] = useState("");
  const [coAmount, setCoAmount] = useState("");
  const [addingChangeOrder, setAddingChangeOrder] = useState(false);

  useEffect(() => {
    if (job) fetchJobAttachments(job.id);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (job && canManageJob) {
      fetchJobInvoices(job.id);
      fetchJobChangeOrders(job.id);
    }
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;

  const startEditDetails = () => {
    setDetailsForm({
      price: String(job.price ?? ""),
      scheduled_date: job.scheduled_date || "",
      scheduled_time: job.scheduled_time || "",
      duration: String(job.duration ?? ""),
      priority: job.priority || "normal",
      service_type_id: job.service_type_id != null ? String(job.service_type_id) : "",
      end_date: job.end_date || "",
    });
    setEditingDetails(true);
  };

  const saveDetails = async () => {
    await updateJob(job.id, {
      price: parseFloat(detailsForm.price) || 0,
      scheduled_date: detailsForm.scheduled_date,
      scheduled_time: detailsForm.scheduled_time,
      duration: parseInt(detailsForm.duration, 10) || 60,
      priority: detailsForm.priority as Priority,
      service_type_id: detailsForm.service_type_id ? parseInt(detailsForm.service_type_id, 10) : null,
      end_date: detailsForm.end_date || null,
    });
    setEditingDetails(false);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const months = parseInt(warrantyMonthsInput, 10);
      await updateJob(job.id, {
        status: "completed",
        completion_notes: completionNotesInput.trim(),
        ...(months > 0 ? { warranty_months: months } : {}),
      });
      setShowComplete(false);
      setCompletionNotesInput("");
      setWarrantyMonthsInput("");
    } finally {
      setCompleting(false);
    }
  };

  const canComplete = job.status !== "completed" && job.status !== "cancelled";

  // Multi-day badge: shown whenever end_date is set and differs from
  // scheduled_date -- null/equal-to-scheduled_date is a normal single-day job.
  const isMultiDay = !!job.end_date && job.end_date !== job.scheduled_date;

  const handleAddCrew = async () => {
    if (!crewTechnicianId) return;
    setAddingCrew(true);
    try {
      await addJobCrewMember(job.id, parseInt(crewTechnicianId, 10), crewRole.trim() || undefined);
      setCrewTechnicianId("");
      setCrewRole("");
      setShowAddCrew(false);
    } finally {
      setAddingCrew(false);
    }
  };

  const handleRequestReview = async () => {
    setRequestingReview(true);
    setReviewNotice(null);
    try {
      const res = await requestJobReview(job.id);
      setReviewNotice(
        res.sent
          ? "Review request sent — the customer was emailed a link to leave a review."
          : `Not sent (${res.reason || "unknown reason"}).`,
      );
    } finally {
      setRequestingReview(false);
    }
  };

  const handlePhotoSelected = async (kind: AttachmentKind, e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      await uploadAttachment("job", job.id, file, kind);
    } finally {
      setUploadingPhoto(false);
      input.value = "";
    }
  };

  const handleStatusChange = (status: JobStatus) => updateJob(job.id, { status });

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await addJobNote(job.id, noteText.trim());
    setNoteText("");
  };

  const handleAddChecklist = async () => {
    if (!checklistText.trim()) return;
    await addChecklistItem(job.id, checklistText.trim());
    setChecklistText("");
  };

  const handleAddMaterial = async () => {
    if (!materialId) return;
    await addJobMaterial(job.id, parseInt(materialId, 10), parseFloat(materialQty) || 1);
    setMaterialId("");
    setMaterialQty("1");
    setShowAddMaterial(false);
  };

  const handleAddProgressInvoice = async () => {
    if (!progressDesc.trim() || !progressAmount.trim()) return;
    setAddingProgress(true);
    try {
      await addJobProgressInvoice(job.id, { description: progressDesc.trim(), amount: parseFloat(progressAmount) || 0 });
      setProgressDesc("");
      setProgressAmount("");
      setShowAddProgressInvoice(false);
    } finally {
      setAddingProgress(false);
    }
  };

  const handleAddChangeOrder = async () => {
    if (!coDesc.trim() || !coAmount.trim()) return;
    setAddingChangeOrder(true);
    try {
      await addChangeOrder(job.id, { description: coDesc.trim(), amount: parseFloat(coAmount) || 0 });
      setCoDesc("");
      setCoAmount("");
      setShowAddChangeOrder(false);
    } finally {
      setAddingChangeOrder(false);
    }
  };

  return (
    <div class="page page-doc">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/jobs")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
          {canComplete && (
            <button class="btn btn-primary" onClick={() => { setCompletionNotesInput(job.completion_notes || ""); setShowComplete(true); }}>
              <CheckCircle size={14} /> Complete Job
            </button>
          )}
          {canManageJob && job.status === "completed" && (
            <button class="btn" onClick={handleRequestReview} disabled={requestingReview}>
              <Star size={14} /> {requestingReview ? "Sending..." : "Request Review"}
            </button>
          )}
          {canManageJob && (
            <button class="btn" onClick={() => createInvoiceFromJob(job.id)}>
              <FileText size={14} /> Create Invoice
            </button>
          )}
          {canManageJob && (
            <button class="btn btn-danger" onClick={() => deleteJob(job.id)}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>

      {reviewNotice && (
        <div class="card" style={{ padding: 12, marginBottom: 16, borderColor: "var(--gold)" }}>
          {reviewNotice}
        </div>
      )}

      {showComplete && (
        <div class="card" style={{ padding: 14, marginBottom: 16, borderColor: "var(--success)" }}>
          <h3 style={{ marginTop: 0 }}><CheckCircle size={16} style={{ verticalAlign: "text-bottom" }} /> Complete Job</h3>
          <p class="text-muted" style={{ marginTop: 0 }}>Mark this job completed and record what was done.</p>
          <textarea
            rows={3}
            style={{ width: "100%" }}
            value={completionNotesInput}
            onInput={(e) => setCompletionNotesInput((e.target as HTMLTextAreaElement).value)}
            placeholder="Completion notes (work performed, results, follow-ups)..."
          />
          <div style={{ marginTop: 10 }}>
            <label class="detail-meta-label" style={{ display: "block", marginBottom: 4 }}>
              <ShieldCheck size={13} style={{ verticalAlign: "text-bottom" }} /> Warranty (months, optional)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              style={{ width: 120 }}
              value={warrantyMonthsInput}
              onInput={(e) => setWarrantyMonthsInput((e.target as HTMLInputElement).value)}
              placeholder="e.g. 12"
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button class="btn btn-primary" onClick={handleComplete} disabled={completing}>
              {completing ? "Saving..." : "Mark Completed"}
            </button>
            <button class="btn" onClick={() => setShowComplete(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div class="detail-layout">
        <div class="detail-main">
          <div class="detail-title-row">
            <span class="identifier-lg">{job.identifier}</span>
            <StatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
            {isMultiDay && (
              <span class="service-pill" title={`Runs ${formatDate(job.scheduled_date)} – ${formatDate(job.end_date)}`}>
                <Clock size={12} /> Multi-day: through {formatDate(job.end_date)}
              </span>
            )}
          </div>

          <div class="detail-meta-grid">
            <div class="detail-meta-item">
              <User size={14} />
              <span class="detail-meta-label">Customer</span>
              <span>{job.customer_name || "—"}</span>
              {job.customer_phone && <span class="text-muted">{job.customer_phone}</span>}
            </div>
            <div class="detail-meta-item">
              <MapPin size={14} />
              <span class="detail-meta-label">Address</span>
              <span>{job.address || "—"}</span>
            </div>
            <div class="detail-meta-item">
              <Clock size={14} />
              <span class="detail-meta-label">Scheduled</span>
              <span>{formatDate(job.scheduled_date)} at {formatTime(job.scheduled_time)}</span>
              <span class="text-muted">{formatDuration(job.duration)}</span>
            </div>
            <div class="detail-meta-item">
              <DollarSign size={14} />
              <span class="detail-meta-label">Price</span>
              <span class="money">{formatMoney(job.price)}</span>
            </div>
            {job.warranty_expires_at && (
              <div class="detail-meta-item">
                <ShieldCheck size={14} />
                <span class="detail-meta-label">Warranty</span>
                <span>Warranty until {formatDate(job.warranty_expires_at)}</span>
              </div>
            )}
            {job.service_type_name && (
              <div class="detail-meta-item">
                <Wrench size={14} />
                <span class="detail-meta-label">Service</span>
                <span class="service-pill" style={{ borderColor: job.service_type_color || "#ccc" }}>
                  <span class="service-dot" style={{ background: job.service_type_color || "#ccc" }} />
                  {job.service_type_name}
                </span>
              </div>
            )}
            {job.brand_name && (
              <div class="detail-meta-item">
                <Palette size={14} />
                <span class="detail-meta-label">Brand</span>
                <span class="service-pill" style={{ borderColor: job.brand_color_primary || "#ccc" }}>
                  <span class="service-dot" style={{ background: job.brand_color_primary || "#ccc" }} />
                  {job.brand_name}
                </span>
              </div>
            )}
            <div class="detail-meta-item">
              <User size={14} />
              <span class="detail-meta-label">Technician</span>
              {job.technician_name ? (
                <span class="tech-pill" style={{ borderColor: job.technician_color || "#ccc" }}>
                  <span class="tech-dot" style={{ background: job.technician_color || "#ccc" }} />
                  {job.technician_name}
                </span>
              ) : (
                <span class="text-muted">Unassigned</span>
              )}
            </div>
          </div>

          {job.notes && (
            <div class="detail-section">
              <h3>Notes</h3>
              <p class="detail-notes">{job.notes}</p>
            </div>
          )}

          {job.completion_notes && (
            <div class="detail-section">
              <h3><CheckCircle size={16} style={{ verticalAlign: "text-bottom" }} /> Completion</h3>
              <p class="detail-notes">{job.completion_notes}</p>
            </div>
          )}

          {/* Checklist */}
          <div class="detail-section">
            <h3><CheckSquare size={16} style={{ verticalAlign: "text-bottom" }} /> Checklist</h3>
            <div class="checklist-list">
              {(job.checklist || []).map((item) => (
                <div key={item.id} class="checklist-item">
                  <button class="checklist-toggle" onClick={() => toggleChecklistItem(item.id)}>
                    {item.checked ? <CheckSquare size={16} color="#16a34a" /> : <Square size={16} />}
                  </button>
                  <span class={item.checked ? "checklist-done" : ""}>{item.label}</span>
                  {isAgent && (
                    <button class="btn-icon danger" onClick={() => deleteChecklistItem(item.id)}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div class="note-input-row">
              <input
                type="text"
                value={checklistText}
                onInput={(e) => setChecklistText((e.target as HTMLInputElement).value)}
                placeholder="Add checklist item..."
                onKeyDown={(e) => e.key === "Enter" && handleAddChecklist()}
              />
              <button class="btn btn-primary btn-sm" onClick={handleAddChecklist}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Materials Used */}
          <div class="detail-section">
            <h3><Package size={16} style={{ verticalAlign: "text-bottom" }} /> Materials Used</h3>
            {(job.job_materials || []).length > 0 && (
              <div class="card" style={{ marginBottom: 12 }}>
                <table class="table">
                  <thead>
                    <tr><th>Material</th><th>Qty</th><th>Unit Cost</th><th>Total</th>{isAgent && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {(job.job_materials || []).map((jm) => (
                      <tr key={jm.id} class="table-row">
                        <td>{jm.material_name || "—"}</td>
                        <td>{jm.quantity} {jm.material_unit}</td>
                        <td class="money">{formatMoney(jm.unit_cost)}</td>
                        <td class="text-bold money">{formatMoney(jm.quantity * jm.unit_cost)}</td>
                        {isAgent && (
                          <td><button class="btn-icon danger" onClick={() => deleteJobMaterial(jm.id)}><Trash2 size={12} /></button></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showAddMaterial ? (
              <div class="note-input-row">
                <select value={materialId} onChange={(e) => setMaterialId((e.target as HTMLSelectElement).value)} style={{ flex: 2 }}>
                  <option value="">Select material...</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({formatMoney(m.unit_cost)}/{m.unit})</option>
                  ))}
                </select>
                <input type="number" value={materialQty} onInput={(e) => setMaterialQty((e.target as HTMLInputElement).value)} style={{ width: 70 }} min="0.1" step="0.1" />
                <button class="btn btn-primary btn-sm" onClick={handleAddMaterial}>Add</button>
                <button class="btn btn-sm" onClick={() => setShowAddMaterial(false)}>Cancel</button>
              </div>
            ) : (
              <button class="btn btn-sm" onClick={() => setShowAddMaterial(true)}>
                <Plus size={14} /> Add Material
              </button>
            )}
          </div>

          {/* Crew -- many-to-many job<->technician. jobs.technician_id (shown
              above under "Technician") stays the lead; this is ADDITIONAL
              crew. Add/remove is admin/office/estimator only (mirrors the
              server-side gate on reassigning the lead technician) --
              technicians can see this list (it's how they know who else is on
              their job) but never get the add/remove controls. */}
          <div class="detail-section">
            <h3><Users size={16} style={{ verticalAlign: "text-bottom" }} /> Crew</h3>
            {(job.crew || []).length > 0 ? (
              <div class="card" style={{ marginBottom: 12 }}>
                <table class="table">
                  <thead>
                    <tr><th>Technician</th><th>Role</th>{canManageJob && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {(job.crew || []).map((cm) => (
                      <tr key={cm.id} class="table-row">
                        <td>
                          <span class="tech-pill" style={{ borderColor: cm.technician_color || "#ccc" }}>
                            <span class="tech-dot" style={{ background: cm.technician_color || "#ccc" }} />
                            {cm.technician_name || "—"}
                          </span>
                          {!!cm.is_subcontractor && <span class="text-muted" style={{ marginLeft: 6, fontSize: 12 }}>1099</span>}
                        </td>
                        <td class="text-muted">{cm.role || "—"}</td>
                        {canManageJob && (
                          <td><button class="btn-icon danger" onClick={() => removeJobCrewMember(job.id, cm.id)}><Trash2 size={12} /></button></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="text-muted" style={{ marginTop: 0 }}>No additional crew on this job.</p>
            )}
            {canManageJob && (
              showAddCrew ? (
                <div class="note-input-row">
                  <select value={crewTechnicianId} onChange={(e) => setCrewTechnicianId((e.target as HTMLSelectElement).value)} style={{ flex: 2 }}>
                    <option value="">Select technician...</option>
                    {technicianLookup
                      .filter((t) => t.id !== job.technician_id && !(job.crew || []).some((cm) => cm.technician_id === t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                  <input type="text" value={crewRole} onInput={(e) => setCrewRole((e.target as HTMLInputElement).value)} placeholder="Role (optional, e.g. helper)" style={{ flex: 1 }} />
                  <button class="btn btn-primary btn-sm" onClick={handleAddCrew} disabled={addingCrew || !crewTechnicianId}>{addingCrew ? "Adding..." : "Add"}</button>
                  <button class="btn btn-sm" onClick={() => setShowAddCrew(false)}>Cancel</button>
                </div>
              ) : (
                <button class="btn btn-sm" onClick={() => setShowAddCrew(true)}>
                  <Plus size={14} /> Add Crew Member
                </button>
              )
            )}
          </div>

          {/* Invoice history (progress billing) -- every invoice tied to
              this job, not just the one create-invoice-from-job flow.
              Money-adjacent: hidden entirely from technicians, mirroring the
              server-side block on /api/jobs/{id}/invoices for that role. */}
          {canManageJob && (
            <div class="detail-section">
              <h3><Receipt size={16} style={{ verticalAlign: "text-bottom" }} /> Invoices</h3>
              {jobInvoices.length > 0 ? (
                <div class="card" style={{ marginBottom: 12 }}>
                  <table class="table">
                    <thead>
                      <tr><th>Invoice</th><th>Status</th><th class="text-right">Total</th><th></th></tr>
                    </thead>
                    <tbody>
                      {jobInvoices.map((inv) => (
                        <tr key={inv.id} class="table-row">
                          <td class="identifier">{inv.identifier}</td>
                          <td><StatusBadge status={inv.status} /></td>
                          <td class="text-right text-bold money">{formatMoney(inv.total)}</td>
                          <td>
                            <a href={`/invoices/${inv.id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${inv.id}`); }} class="btn btn-sm">View</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p class="text-muted" style={{ marginTop: 0 }}>No invoices yet.</p>
              )}
              {showAddProgressInvoice ? (
                <div class="note-input-row">
                  <input type="text" value={progressDesc} onInput={(e) => setProgressDesc((e.target as HTMLInputElement).value)} placeholder="Description (e.g. Progress payment - Phase 2)" style={{ flex: 2 }} />
                  <input type="number" step="0.01" min="0" value={progressAmount} onInput={(e) => setProgressAmount((e.target as HTMLInputElement).value)} style={{ width: 100 }} placeholder="Amount" />
                  <button class="btn btn-primary btn-sm" onClick={handleAddProgressInvoice} disabled={addingProgress}>{addingProgress ? "Adding..." : "Add"}</button>
                  <button class="btn btn-sm" onClick={() => setShowAddProgressInvoice(false)}>Cancel</button>
                </div>
              ) : (
                <button class="btn btn-sm" onClick={() => setShowAddProgressInvoice(true)}>
                  <Plus size={14} /> Add Progress Invoice
                </button>
              )}
            </div>
          )}

          {/* Change orders -- money-adjacent, hidden from technicians. */}
          {canManageJob && (
            <div class="detail-section">
              <h3><GitPullRequestArrow size={16} style={{ verticalAlign: "text-bottom" }} /> Change Orders</h3>
              {jobChangeOrders.length > 0 ? (
                <div class="card" style={{ marginBottom: 12 }}>
                  <table class="table">
                    <thead>
                      <tr><th>Description</th><th class="text-right">Amount</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {jobChangeOrders.map((co) => (
                        <tr key={co.id} class="table-row">
                          <td>{co.description}</td>
                          <td class="text-right money">{formatMoney(co.amount)}</td>
                          <td><StatusBadge status={co.status} /></td>
                          <td>
                            {co.status === "pending" && (
                              <div style={{ display: "flex", gap: 4 }}>
                                <button class="btn-icon" title="Approve" onClick={() => approveChangeOrder(co.id, job.id)}>
                                  <Check size={13} color="var(--success)" />
                                </button>
                                <button class="btn-icon danger" title="Reject" onClick={() => rejectChangeOrder(co.id, job.id)}>
                                  <Ban size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p class="text-muted" style={{ marginTop: 0 }}>No change orders yet.</p>
              )}
              {showAddChangeOrder ? (
                <div class="note-input-row">
                  <input type="text" value={coDesc} onInput={(e) => setCoDesc((e.target as HTMLInputElement).value)} placeholder="Description (e.g. Add ceiling repaint)" style={{ flex: 2 }} />
                  <input type="number" step="0.01" min="0" value={coAmount} onInput={(e) => setCoAmount((e.target as HTMLInputElement).value)} style={{ width: 100 }} placeholder="Amount" />
                  <button class="btn btn-primary btn-sm" onClick={handleAddChangeOrder} disabled={addingChangeOrder}>{addingChangeOrder ? "Adding..." : "Add"}</button>
                  <button class="btn btn-sm" onClick={() => setShowAddChangeOrder(false)}>Cancel</button>
                </div>
              ) : (
                <button class="btn btn-sm" onClick={() => setShowAddChangeOrder(true)}>
                  <Plus size={14} /> Add Change Order
                </button>
              )}
              <p class="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Approving adds the amount to the job's most recent draft/sent invoice (or creates a new one if none qualifies).
              </p>
            </div>
          )}

          {/* Photos (before/after) */}
          <div class="detail-section">
            <h3><Camera size={16} style={{ verticalAlign: "text-bottom" }} /> Photos</h3>
            {(["before", "after"] as const).map((kind) => {
              const photos = jobAttachments.filter((a) => a.kind === kind);
              return (
                <div key={kind} style={{ marginBottom: 12 }}>
                  <div class="detail-meta-label" style={{ marginBottom: 6, textTransform: "capitalize" }}>{kind}</div>
                  <div class="photo-gallery">
                    {photos.map((a) => (
                      <div key={a.id} class="photo-thumb">
                        <img src={`/api/r2/${a.r2_key}`} alt={a.filename || kind} />
                        <button class="photo-thumb-remove" onClick={() => deleteAttachment(a.id, "job", job.id)}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      class="photo-thumb-add"
                      disabled={uploadingPhoto}
                      onClick={() => (kind === "before" ? beforeFileInput : afterFileInput).current?.click()}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            <input ref={beforeFileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoSelected("before", e)} />
            <input ref={afterFileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoSelected("after", e)} />
          </div>

          {/* Activity / Notes */}
          <div class="detail-section">
            <h3>Activity</h3>
            <div class="note-input-row">
              <input
                type="text"
                value={noteText}
                onInput={(e) => setNoteText((e.target as HTMLInputElement).value)}
                placeholder="Add a note..."
                onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              />
              <button class="btn btn-primary btn-sm" onClick={handleAddNote}>
                <Send size={14} />
              </button>
            </div>
            <div class="notes-list">
              {(job.job_notes || [])
                .filter((note) => !note.content.includes(REMINDER_PLACEHOLDER))
                .map((note) => (
                <div key={note.id} class="note-item">
                  <div class="note-content">{note.content}</div>
                  <div class="note-meta">
                    <span>{formatDateTime(note.created_at)}</span>
                    {isAgent && (
                      <button class="btn-icon danger" onClick={() => deleteJobNote(note.id)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div class="detail-sidebar">
          {/* Editable details -- price/schedule/duration/priority/service.
              Available to technicians on their own job too (working fields);
              only reassignment + brand stay office-only below. */}
          <div class="detail-sidebar-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h4 style={{ margin: 0 }}>Details</h4>
              {editingDetails ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button class="btn btn-sm" onClick={() => setEditingDetails(false)}><X size={12} /></button>
                  <button class="btn btn-primary btn-sm" onClick={saveDetails}><Save size={12} /></button>
                </div>
              ) : (
                <button class="btn btn-sm" onClick={startEditDetails}><Edit3 size={12} /> Edit</button>
              )}
            </div>
            {editingDetails ? (
              <div class="form-grid" style={{ marginTop: 10 }}>
                <div class="form-group full-width">
                  <label>Price</label>
                  <input type="number" step="0.01" min="0" value={detailsForm.price} onInput={(e) => setDetailsForm({ ...detailsForm, price: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="form-group full-width">
                  <label>Date</label>
                  <input type="date" value={detailsForm.scheduled_date} onChange={(e) => setDetailsForm({ ...detailsForm, scheduled_date: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="form-group full-width">
                  <label>End Date (multi-day, optional)</label>
                  <input type="date" min={detailsForm.scheduled_date || undefined} value={detailsForm.end_date} onChange={(e) => setDetailsForm({ ...detailsForm, end_date: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="form-group full-width">
                  <label>Time</label>
                  <input type="time" value={detailsForm.scheduled_time} onChange={(e) => setDetailsForm({ ...detailsForm, scheduled_time: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="form-group full-width">
                  <label>Duration (min)</label>
                  <input type="number" step="1" min="1" value={detailsForm.duration} onInput={(e) => setDetailsForm({ ...detailsForm, duration: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="form-group full-width">
                  <label>Priority</label>
                  <select value={detailsForm.priority} onChange={(e) => setDetailsForm({ ...detailsForm, priority: (e.target as HTMLSelectElement).value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div class="form-group full-width">
                  <label>Service Type</label>
                  <select value={detailsForm.service_type_id} onChange={(e) => setDetailsForm({ ...detailsForm, service_type_id: (e.target as HTMLSelectElement).value })}>
                    <option value="">None</option>
                    {serviceTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <div class="detail-meta-item"><span class="detail-meta-label">Price</span><span class="money">{formatMoney(job.price)}</span></div>
                <div class="detail-meta-item"><span class="detail-meta-label">Date</span><span>{formatDate(job.scheduled_date)}</span></div>
                {isMultiDay && (
                  <div class="detail-meta-item"><span class="detail-meta-label">End Date</span><span>{formatDate(job.end_date)}</span></div>
                )}
                <div class="detail-meta-item"><span class="detail-meta-label">Time</span><span>{formatTime(job.scheduled_time)}</span></div>
                <div class="detail-meta-item"><span class="detail-meta-label">Duration</span><span>{formatDuration(job.duration)}</span></div>
                <div class="detail-meta-item"><span class="detail-meta-label">Priority</span><span style={{ textTransform: "capitalize" }}>{job.priority}</span></div>
                <div class="detail-meta-item"><span class="detail-meta-label">Service</span><span>{job.service_type_name || "—"}</span></div>
              </div>
            )}
          </div>

          <div class="detail-sidebar-section">
            <h4>Status</h4>
            <div class="status-buttons">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  class={`status-btn ${job.status === s ? "active" : ""}`}
                  onClick={() => handleStatusChange(s)}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {canManageJob && (
            <div class="detail-sidebar-section">
              <h4>Assign Technician</h4>
              <select
                value={job.technician_id || ""}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  updateJob(job.id, { technician_id: val ? parseInt(val, 10) : null });
                }}
              >
                <option value="">Unassigned</option>
                {technicianLookup.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {canManageJob && (
            <div class="detail-sidebar-section">
              <h4>Brand</h4>
              <select
                value={job.brand_id || ""}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  updateJob(job.id, { brand_id: val ? parseInt(val, 10) : null });
                }}
              >
                <option value="">No brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          {job.is_recurring === 1 && (
            <div class="detail-sidebar-section">
              <h4>Recurring</h4>
              <p class="text-muted">{job.recurrence_interval || "Not set"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
