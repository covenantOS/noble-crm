import { useState } from "preact/hooks";
import { useApp } from "../context";
import { X, Plus, Trash2 } from "lucide-preact";

interface DraftLine {
  description: string;
  quantity: string;
  unit_price: string;
}

const emptyLine = (): DraftLine => ({ description: "", quantity: "1", unit_price: "0" });

export function CreateEstimate({ onClose }: { onClose: () => void }) {
  const { addEstimate, customerLookup, brands, setError } = useApp();

  const [customerId, setCustomerId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const updateLine = (i: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const subtotal = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0);
  const taxAmount = subtotal * ((parseFloat(taxRate) || 0) / 100);
  const total = subtotal + taxAmount;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    const validLines = lines.filter((l) => l.description.trim());
    if (validLines.length === 0) { setError("Please add at least one line item"); return; }
    setSubmitting(true);
    try {
      await addEstimate({
        customer_id: parseInt(customerId, 10),
        brand_id: brandId ? parseInt(brandId, 10) : null,
        tax_rate: parseFloat(taxRate) || 0,
        valid_until: validUntil || undefined,
        notes,
        lines: validLines.map((l) => ({
          description: l.description.trim(),
          quantity: parseFloat(l.quantity) || 0,
          unit_price: parseFloat(l.unit_price) || 0,
        })),
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
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>New Estimate</h2>
          <button class="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="form-grid">
            <div class="form-group">
              <label>Customer *</label>
              <select value={customerId} onChange={(e) => setCustomerId((e.target as HTMLSelectElement).value)} required>
                <option value="">Select customer...</option>
                {customerLookup.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div class="form-group">
              <label>Brand</label>
              <select value={brandId} onChange={(e) => setBrandId((e.target as HTMLSelectElement).value)}>
                <option value="">No brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div class="form-group">
              <label>Tax Rate (%)</label>
              <input type="number" step="0.01" min="0" value={taxRate} onInput={(e) => setTaxRate((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group">
              <label>Valid Until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group full-width">
              <label>Notes</label>
              <textarea rows={2} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="Estimate notes..." />
            </div>
          </div>

          <div class="detail-section">
            <h3>Line Items</h3>
            <div class="card">
              <table class="table">
                <thead>
                  <tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Unit Price</th><th class="text-right" style={{ width: 90 }}>Total</th><th></th></tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} class="table-row">
                      <td>
                        <input
                          type="text"
                          value={line.description}
                          onInput={(e) => updateLine(i, { description: (e.target as HTMLInputElement).value })}
                          placeholder="Description"
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.quantity}
                          onInput={(e) => updateLine(i, { quantity: (e.target as HTMLInputElement).value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.unit_price}
                          onInput={(e) => updateLine(i, { unit_price: (e.target as HTMLInputElement).value })}
                        />
                      </td>
                      <td class="text-right">${((parseFloat(line.quantity) || 0) * (parseFloat(line.unit_price) || 0)).toFixed(2)}</td>
                      <td>
                        {lines.length > 1 && (
                          <button type="button" class="btn-icon danger" onClick={() => removeLine(i)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} class="text-right text-muted">Subtotal</td>
                    <td class="text-right">${subtotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                  {parseFloat(taxRate) > 0 && (
                    <tr>
                      <td colSpan={3} class="text-right text-muted">Tax ({taxRate}%)</td>
                      <td class="text-right">${taxAmount.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} class="text-right text-bold">Total</td>
                    <td class="text-right text-bold">${total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <button type="button" class="btn btn-sm" onClick={addLine} style={{ marginTop: 8 }}>
              <Plus size={14} /> Add Line
            </button>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting ? "Creating..." : "Create Estimate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
