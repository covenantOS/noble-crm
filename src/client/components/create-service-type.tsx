import { useState } from "preact/hooks";
import { useApp } from "../context";
import { X } from "lucide-preact";

export function CreateServiceType({ onClose }: { onClose: () => void }) {
  const { addServiceType, setError } = useApp();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [defaultPrice, setDefaultPrice] = useState(0);
  const [color, setColor] = useState("#6b7280");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setSubmitting(true);
    try {
      await addServiceType({
        name: name.trim(),
        description,
        default_duration: defaultDuration,
        default_price: defaultPrice,
        color,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Add Service Type</h2>
          <button class="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="form-grid">
            <div class="form-group full-width">
              <label>Name *</label>
              <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required placeholder="e.g., Standard Service" />
            </div>
            <div class="form-group full-width">
              <label>Description</label>
              <textarea rows={2} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} placeholder="Brief description..." />
            </div>
            <div class="form-group">
              <label>Default Duration (min)</label>
              <input type="number" value={defaultDuration} onInput={(e) => setDefaultDuration(parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
            </div>
            <div class="form-group">
              <label>Default Price ($)</label>
              <input type="number" step="0.01" value={defaultPrice} onInput={(e) => setDefaultPrice(parseFloat((e.target as HTMLInputElement).value) || 0)} />
            </div>
            <div class="form-group">
              <label>Color</label>
              <input type="color" value={color} onChange={(e) => setColor((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting ? "Adding..." : "Add Service Type"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
