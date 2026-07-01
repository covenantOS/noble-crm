import { useState } from "preact/hooks";
import { useApp } from "../context";
import { X } from "lucide-preact";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateBrand({ onClose }: { onClose: () => void }) {
  const { addBrand, setError } = useApp();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [colorPrimary, setColorPrimary] = useState("#1a2b4a");
  const [colorSecondary, setColorSecondary] = useState("#c9a227");
  const [reviewUrl, setReviewUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleNameInput = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    if (!slug.trim()) { setError("Slug is required"); return; }
    setSubmitting(true);
    try {
      await addBrand({
        name: name.trim(),
        slug: slug.trim(),
        color_primary: colorPrimary,
        color_secondary: colorSecondary,
        ...(reviewUrl.trim() ? { review_url: reviewUrl.trim() } : {}),
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
          <h2>Add Brand</h2>
          <button class="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="form-grid">
            <div class="form-group full-width">
              <label>Name *</label>
              <input type="text" value={name} onInput={(e) => handleNameInput((e.target as HTMLInputElement).value)} required placeholder="e.g., Westchase Painting" />
            </div>
            <div class="form-group full-width">
              <label>Slug *</label>
              <input
                type="text"
                value={slug}
                onInput={(e) => { setSlugTouched(true); setSlug((e.target as HTMLInputElement).value); }}
                required
                placeholder="e.g., westchase-painting"
              />
            </div>
            <div class="form-group">
              <label>Primary Color</label>
              <input type="color" value={colorPrimary} onChange={(e) => setColorPrimary((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group">
              <label>Secondary Color</label>
              <input type="color" value={colorSecondary} onChange={(e) => setColorSecondary((e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-group full-width">
              <label>Review Link (optional)</label>
              <input type="url" value={reviewUrl} onInput={(e) => setReviewUrl((e.target as HTMLInputElement).value)} placeholder="https://g.page/r/.../review" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting ? "Adding..." : "Add Brand"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
