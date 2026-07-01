// The account switcher -- the front door of Noble CRM as a multi-account
// platform. Lives in the sidebar directly under the crest. A brand-colored
// dot + account name + chevron opens a popover listing All Accounts, each
// active brand (DEMO badge on the demo workspace), then admin tools:
// "+ New account" (opens the existing create-brand modal and switches to the
// result) and "Reset demo data" / "Set up demo account" (both hit the
// idempotent POST /api/demo/reset).
//
// Hidden entirely for technicians -- their data is ownership-scoped
// server-side, not account-scoped, so a switcher would be a lie.
import { useEffect, useRef, useState } from "preact/hooks";
import { Check, ChevronsUpDown, Layers, Plus, RefreshCw } from "lucide-preact";
import { useApp } from "../context";
import { safeCssHex } from "../format";
import { CreateBrand } from "./create-brand";
import type { Brand } from "../types";

export function AccountSwitcher() {
  const { brands, activeBrandId, setActiveBrandId, currentUser, resetDemo, setError } = useApp();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!currentUser || currentUser.role === "technician") return null;
  const isAdmin = currentUser.role === "admin";

  const selectableBrands = brands.filter((b) => b.active === 1);
  const active = activeBrandId !== null ? brands.find((b) => b.id === activeBrandId) ?? null : null;
  const demoBrand = brands.find((b) => b.is_demo === 1) ?? null;

  const choose = (id: number | null) => {
    setActiveBrandId(id);
    setOpen(false);
  };

  const handleResetDemo = async () => {
    const message = demoBrand
      ? "Reset the demo account? All demo customers, jobs, estimates, and invoices will be wiped and re-created fresh. Real accounts are never touched."
      : "Set up the demo account? This creates \"Sunshine Painting Co (Demo)\" with a full cast of sample customers, jobs, estimates, and invoices.";
    if (!confirm(message)) return;
    setOpen(false);
    setResetting(true);
    try {
      const res = await resetDemo();
      setActiveBrandId(res.brand_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const dotStyle = (b: Brand | null) =>
    b ? { background: safeCssHex(b.color_primary, "#1a2b4a") } : undefined;

  return (
    <div class="account-switcher" ref={rootRef}>
      <button
        class={`account-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={resetting}
      >
        {active ? (
          <span class="account-dot" style={dotStyle(active)} />
        ) : (
          <span class="account-dot account-dot-all"><Layers size={11} /></span>
        )}
        <span class="account-trigger-label">
          <span class="account-trigger-name">
            {resetting ? "Resetting demo…" : active ? active.name : "All Accounts"}
          </span>
          <span class="account-trigger-sub">
            {active?.is_demo === 1 ? "Demo workspace" : active ? "Account" : `${selectableBrands.length} accounts`}
          </span>
        </span>
        <ChevronsUpDown size={14} class="account-trigger-chevron" />
      </button>

      {open && (
        <div class="account-menu" role="listbox">
          <div class="account-menu-title">Accounts</div>
          <button class={`account-item ${activeBrandId === null ? "selected" : ""}`} onClick={() => choose(null)} role="option" aria-selected={activeBrandId === null}>
            <span class="account-dot account-dot-all"><Layers size={11} /></span>
            <span class="account-item-name">All Accounts</span>
            {activeBrandId === null && <Check size={14} class="account-item-check" />}
          </button>
          {selectableBrands.map((b) => (
            <button key={b.id} class={`account-item ${activeBrandId === b.id ? "selected" : ""}`} onClick={() => choose(b.id)} role="option" aria-selected={activeBrandId === b.id}>
              <span class="account-dot" style={dotStyle(b)} />
              <span class="account-item-name">{b.name}</span>
              {b.is_demo === 1 && <span class="demo-badge">DEMO</span>}
              {activeBrandId === b.id && <Check size={14} class="account-item-check" />}
            </button>
          ))}
          {isAdmin && (
            <>
              <div class="account-menu-divider" />
              <button class="account-item account-item-action" onClick={() => { setOpen(false); setShowCreate(true); }}>
                <span class="account-action-icon"><Plus size={13} /></span>
                <span class="account-item-name">New account</span>
              </button>
              <button class="account-item account-item-action" onClick={handleResetDemo} disabled={resetting}>
                <span class="account-action-icon"><RefreshCw size={13} /></span>
                <span class="account-item-name">{demoBrand ? "Reset demo data" : "Set up demo account"}</span>
              </button>
            </>
          )}
        </div>
      )}

      {showCreate && (
        <CreateBrand
          onClose={() => setShowCreate(false)}
          onCreated={(b) => setActiveBrandId(b.id)}
        />
      )}
    </div>
  );
}
