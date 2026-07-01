import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Plus, Trash2 } from "lucide-preact";
import type { ServiceAgreementInterval } from "../types";

const INTERVALS: ServiceAgreementInterval[] = ["weekly", "monthly", "quarterly", "annual"];

// Simple list + inline create form, modeled on material-list.tsx -- this is
// a secondary/back-office feature (recurring-job templates consumed by the
// scheduled() cron handler), so it doesn't need its own modal component.
export function ServiceAgreementList() {
  const {
    serviceAgreements, addServiceAgreement, updateServiceAgreement, deleteServiceAgreement,
    customerLookup, technicianLookup, serviceTypes, brands, setError,
  } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const [newForm, setNewForm] = useState({
    customer_id: "", brand_id: "", service_type_id: "", interval: "monthly" as ServiceAgreementInterval, next_run_date: today,
  });

  const handleCreate = async () => {
    if (!newForm.customer_id) { setError("Please select a customer"); return; }
    if (!newForm.next_run_date) { setError("Please select a next run date"); return; }
    setSubmitting(true);
    try {
      await addServiceAgreement({
        customer_id: parseInt(newForm.customer_id, 10),
        brand_id: newForm.brand_id ? parseInt(newForm.brand_id, 10) : null,
        service_type_id: newForm.service_type_id ? parseInt(newForm.service_type_id, 10) : null,
        interval: newForm.interval,
        next_run_date: newForm.next_run_date,
      });
      setNewForm({ customer_id: "", brand_id: "", service_type_id: "", interval: "monthly", next_run_date: today });
      setShowCreate(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // technicianLookup is unused here on purpose -- service agreements don't
  // assign a technician (that happens per-generated-job, same as any other
  // job), kept as a destructured import only because useApp() is typed as a
  // single big context; left out of the JSX below.
  void technicianLookup;

  return (
    <div class="page">
      <div class="page-header">
        <h1>Recurring Service Agreements</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          <Plus size={16} /> Add Agreement
        </button>
      </div>

      <div class="card">
        {serviceAgreements.length === 0 && !showCreate ? (
          <div class="empty-state">
            <p>No recurring service agreements yet</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add your first agreement
            </button>
          </div>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Service Type</th>
                <th>Brand</th>
                <th>Interval</th>
                <th>Next Run</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {showCreate && (
                <tr class="table-row">
                  <td>
                    <select value={newForm.customer_id} onChange={(e) => setNewForm({ ...newForm, customer_id: (e.target as HTMLSelectElement).value })} class="inline-input">
                      <option value="">Select customer...</option>
                      {customerLookup.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={newForm.service_type_id} onChange={(e) => setNewForm({ ...newForm, service_type_id: (e.target as HTMLSelectElement).value })} class="inline-input">
                      <option value="">None</option>
                      {serviceTypes.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={newForm.brand_id} onChange={(e) => setNewForm({ ...newForm, brand_id: (e.target as HTMLSelectElement).value })} class="inline-input">
                      <option value="">None</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={newForm.interval} onChange={(e) => setNewForm({ ...newForm, interval: (e.target as HTMLSelectElement).value as ServiceAgreementInterval })} class="inline-input">
                      {INTERVALS.map((i) => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="date" value={newForm.next_run_date} onChange={(e) => setNewForm({ ...newForm, next_run_date: (e.target as HTMLInputElement).value })} class="inline-input" />
                  </td>
                  <td class="text-muted">Active</td>
                  <td>
                    <div class="action-btns">
                      <button class="btn btn-sm btn-primary" disabled={submitting} onClick={handleCreate}>
                        {submitting ? "Adding..." : "Add"}
                      </button>
                      <button class="btn btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              )}
              {serviceAgreements.map((a) => (
                <tr key={a.id} class="table-row">
                  <td class="text-bold">{a.customer_name || "—"}</td>
                  <td>{a.service_type_name || <span class="text-muted">—</span>}</td>
                  <td>{a.brand_name || <span class="text-muted">—</span>}</td>
                  <td class="text-muted">{a.interval}</td>
                  <td>{a.next_run_date || "—"}</td>
                  <td>
                    <button
                      class={`status-badge-sm clickable ${a.active ? "active" : "inactive"}`}
                      onClick={() => updateServiceAgreement(a.id, { active: a.active ? 0 : 1 })}
                    >
                      {a.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td>
                    <div class="action-btns">
                      <button class="btn-icon danger" onClick={() => deleteServiceAgreement(a.id)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
