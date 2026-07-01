import { useState } from "preact/hooks";
import { useApp } from "../context";
import { formatMoney } from "../format";
import { Plus, Trash2, Edit3 } from "lucide-preact";

// TKC (Tampa Kitchen Cabinets) product catalog -- distinct from the painting
// Materials list. Mirrors material-list.tsx's CRUD pattern exactly; mutations
// are admin/office only (server-enforced, same as materials).
export function ProductList() {
  const { products, brands, addProduct, updateProduct, deleteProduct, isAgent, setError } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", sku: "", category: "", unit_cost: 0, unit: "ea", brand_id: "" as string | number });
  const [newForm, setNewForm] = useState({ name: "", sku: "", category: "", unit_cost: 0, unit: "ea", brand_id: "" as string | number });

  const startEdit = (p: typeof products[0]) => {
    setEditForm({ name: p.name, sku: p.sku || "", category: p.category || "", unit_cost: p.unit_cost, unit: p.unit, brand_id: p.brand_id ?? "" });
    setEditingId(p.id);
  };

  const saveEdit = async (id: number) => {
    await updateProduct(id, { ...editForm, brand_id: editForm.brand_id ? Number(editForm.brand_id) : null });
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!newForm.name.trim()) { setError("Name is required"); return; }
    await addProduct({ ...newForm, brand_id: newForm.brand_id ? Number(newForm.brand_id) : null });
    setNewForm({ name: "", sku: "", category: "", unit_cost: 0, unit: "ea", brand_id: "" });
    setShowCreate(false);
  };

  return (
    <div class="page">
      <div class="page-header">
        <h1>Products</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div class="card">
        {products.length === 0 && !showCreate ? (
          <div class="empty-state">
            <p>No products yet</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add your first product
            </button>
          </div>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Brand</th>
                <th>Category</th>
                <th>SKU</th>
                <th>Unit Cost</th>
                <th>Unit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {showCreate && (
                <tr class="table-row">
                  <td><input type="text" value={newForm.name} onInput={(e) => setNewForm({ ...newForm, name: (e.target as HTMLInputElement).value })} class="inline-input" placeholder="Product name" /></td>
                  <td>
                    <select value={newForm.brand_id} onChange={(e) => setNewForm({ ...newForm, brand_id: (e.target as HTMLSelectElement).value })} class="inline-input">
                      <option value="">—</option>
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={newForm.category} onInput={(e) => setNewForm({ ...newForm, category: (e.target as HTMLInputElement).value })} class="inline-input" placeholder="e.g. door style" /></td>
                  <td><input type="text" value={newForm.sku} onInput={(e) => setNewForm({ ...newForm, sku: (e.target as HTMLInputElement).value })} class="inline-input" style={{ width: 90 }} /></td>
                  <td><input type="number" step="0.01" value={newForm.unit_cost} onInput={(e) => setNewForm({ ...newForm, unit_cost: parseFloat((e.target as HTMLInputElement).value) || 0 })} class="inline-input" style={{ width: 90 }} /></td>
                  <td><input type="text" value={newForm.unit} onInput={(e) => setNewForm({ ...newForm, unit: (e.target as HTMLInputElement).value })} class="inline-input" style={{ width: 60 }} /></td>
                  <td>
                    <div class="action-btns">
                      <button class="btn btn-sm btn-primary" onClick={handleCreate}>Add</button>
                      <button class="btn btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} class="table-row">
                  {editingId === p.id ? (
                    <>
                      <td><input type="text" value={editForm.name} onInput={(e) => setEditForm({ ...editForm, name: (e.target as HTMLInputElement).value })} class="inline-input" /></td>
                      <td>
                        <select value={editForm.brand_id} onChange={(e) => setEditForm({ ...editForm, brand_id: (e.target as HTMLSelectElement).value })} class="inline-input">
                          <option value="">—</option>
                          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </td>
                      <td><input type="text" value={editForm.category} onInput={(e) => setEditForm({ ...editForm, category: (e.target as HTMLInputElement).value })} class="inline-input" /></td>
                      <td><input type="text" value={editForm.sku} onInput={(e) => setEditForm({ ...editForm, sku: (e.target as HTMLInputElement).value })} class="inline-input" style={{ width: 90 }} /></td>
                      <td><input type="number" step="0.01" value={editForm.unit_cost} onInput={(e) => setEditForm({ ...editForm, unit_cost: parseFloat((e.target as HTMLInputElement).value) || 0 })} class="inline-input" style={{ width: 90 }} /></td>
                      <td><input type="text" value={editForm.unit} onInput={(e) => setEditForm({ ...editForm, unit: (e.target as HTMLInputElement).value })} class="inline-input" style={{ width: 60 }} /></td>
                      <td>
                        <div class="action-btns">
                          <button class="btn btn-sm btn-primary" onClick={() => saveEdit(p.id)}>Save</button>
                          <button class="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td class="text-bold">{p.name}</td>
                      <td class="text-muted">{p.brand_name || "—"}</td>
                      <td class="text-muted">{p.category || "—"}</td>
                      <td class="text-muted">{p.sku || "—"}</td>
                      <td class="money">{formatMoney(p.unit_cost)}</td>
                      <td class="text-muted">{p.unit}</td>
                      <td>
                        <div class="action-btns">
                          <button class="btn-icon" onClick={() => startEdit(p)}><Edit3 size={14} /></button>
                          {isAgent && (
                            <button class="btn-icon danger" onClick={() => deleteProduct(p.id)}><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
