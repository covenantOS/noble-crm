import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { StatusBadge, PriorityBadge } from "./status-badge";
import { formatDate, formatTime, formatDuration, formatDateTime, formatMoney } from "../format";
import { ArrowLeft, Trash2, Send, MapPin, Clock, DollarSign, User, Wrench, Plus, X, CheckSquare, Square, Package, FileText, Palette, Camera } from "lucide-preact";
import type { AttachmentKind, JobStatus } from "../types";

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
    currentUser, brands,
    jobAttachments, fetchJobAttachments, uploadAttachment, deleteAttachment,
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

  useEffect(() => {
    if (job) fetchJobAttachments(job.id);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;

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

  return (
    <div class="page">
      <div class="page-header">
        <button class="btn btn-back" onClick={() => navigate("/jobs")}>
          <ArrowLeft size={16} /> Back
        </button>
        <div class="page-header-right">
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

      <div class="detail-layout">
        <div class="detail-main">
          <div class="detail-title-row">
            <span class="identifier-lg">{job.identifier}</span>
            <StatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
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
