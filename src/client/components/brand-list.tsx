import { useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { CreateBrand } from "./create-brand";
import { Plus, Edit3, Upload } from "lucide-preact";

export function BrandList() {
  const { brands, updateBrand, uploadBrandLogo, setError } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", slug: "", color_primary: "#1a2b4a", color_secondary: "#c9a227" });
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetId = useRef<number | null>(null);

  const startEdit = (b: typeof brands[0]) => {
    setEditForm({
      name: b.name,
      slug: b.slug,
      color_primary: b.color_primary || "#1a2b4a",
      color_secondary: b.color_secondary || "#c9a227",
    });
    setEditingId(b.id);
  };

  const saveEdit = async (id: number) => {
    await updateBrand(id, editForm);
    setEditingId(null);
  };

  const openFilePicker = (id: number) => {
    uploadTargetId.current = id;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    const id = uploadTargetId.current;
    input.value = "";
    if (!file || id === null) return;
    setUploadingId(id);
    try {
      await uploadBrandLogo(id, file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div class="page">
      <div class="page-header">
        <h1>Brands</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Add Brand
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <div class="card">
        {brands.length === 0 ? (
          <div class="empty-state">
            <p>No brands yet</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add your first brand
            </button>
          </div>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Logo</th>
                <th>Colors</th>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id} class="table-row">
                  {editingId === b.id ? (
                    <>
                      <td>
                        {b.logo_r2_key ? (
                          <img src={`/api/r2/${b.logo_r2_key}`} alt={b.name} style={{ width: 32, height: 32, objectFit: "contain" }} />
                        ) : (
                          <span class="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <input type="color" value={editForm.color_primary} onChange={(e) => setEditForm({ ...editForm, color_primary: (e.target as HTMLInputElement).value })} style={{ width: 28, height: 24 }} />
                          <input type="color" value={editForm.color_secondary} onChange={(e) => setEditForm({ ...editForm, color_secondary: (e.target as HTMLInputElement).value })} style={{ width: 28, height: 24 }} />
                        </div>
                      </td>
                      <td><input type="text" value={editForm.name} onInput={(e) => setEditForm({ ...editForm, name: (e.target as HTMLInputElement).value })} class="inline-input" /></td>
                      <td><input type="text" value={editForm.slug} onInput={(e) => setEditForm({ ...editForm, slug: (e.target as HTMLInputElement).value })} class="inline-input" /></td>
                      <td>
                        <span class={`status-badge-sm ${b.active ? "active" : "inactive"}`}>
                          {b.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div class="action-btns">
                          <button class="btn btn-sm btn-primary" onClick={() => saveEdit(b.id)}>Save</button>
                          <button class="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        {b.logo_r2_key ? (
                          <img src={`/api/r2/${b.logo_r2_key}`} alt={b.name} style={{ width: 32, height: 32, objectFit: "contain" }} />
                        ) : (
                          <span class="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <span class="color-swatch" style={{ background: b.color_primary || "#ccc" }} />
                          <span class="color-swatch" style={{ background: b.color_secondary || "#ccc" }} />
                        </div>
                      </td>
                      <td class="text-bold">{b.name}</td>
                      <td class="text-muted">{b.slug}</td>
                      <td>
                        <button
                          class={`status-badge-sm clickable ${b.active ? "active" : "inactive"}`}
                          onClick={() => updateBrand(b.id, { active: b.active ? 0 : 1 })}
                        >
                          {b.active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td>
                        <div class="action-btns">
                          <button class="btn-icon" onClick={() => startEdit(b)}><Edit3 size={14} /></button>
                          <button class="btn-icon" disabled={uploadingId === b.id} onClick={() => openFilePicker(b.id)}>
                            <Upload size={14} />
                          </button>
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

      {showCreate && <CreateBrand onClose={() => setShowCreate(false)} />}
    </div>
  );
}
