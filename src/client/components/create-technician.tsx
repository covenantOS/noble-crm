import { useState } from "preact/hooks";
import { useApp } from "../context";
import { X } from "lucide-preact";

export function CreateTechnician({ onClose }: { onClose: () => void }) {
  const { addTechnician, setError } = useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [color, setColor] = useState("#16a34a");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setSubmitting(true);
    try {
      await addTechnician({ name: name.trim(), email, phone, color });
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
          <h2>Add Technician</h2>
          <button class="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="form-grid">
            <div class="form-group full-width">
              <label>Name *</label>
              <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required placeholder="Jane Doe" />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group">
              <label>Color</label>
              <input type="color" value={color} onChange={(e) => setColor((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting ? "Adding..." : "Add Technician"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
