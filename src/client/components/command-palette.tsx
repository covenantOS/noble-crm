import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Search, FileText, Briefcase, Users, ClipboardList, ArrowRight } from "lucide-preact";
import { api } from "../api";
import { useApp } from "../context";

type Hit = {
  type: "customer" | "job" | "estimate" | "invoice" | "action";
  id?: number;
  title: string;
  subtitle: string | null;
  href: string;
};

const STATIC_ACTIONS: Hit[] = [
  { type: "action", title: "New estimate", subtitle: "Create a quote", href: "/estimates" },
  { type: "action", title: "Go to schedule", subtitle: "Dispatch board", href: "/schedule" },
  { type: "action", title: "Go to jobs", subtitle: "All jobs", href: "/jobs" },
  { type: "action", title: "Go to customers", subtitle: "CRM list", href: "/customers" },
  { type: "action", title: "Go to invoices", subtitle: "Money", href: "/invoices" },
  { type: "action", title: "Reset demo workspace", subtitle: "Admin · Sunshine Painting", href: "/?demo=reset" },
];

const TYPE_ICON = {
  customer: Users,
  job: Briefcase,
  estimate: ClipboardList,
  invoice: FileText,
  action: ArrowRight,
} as const;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate, activeBrandId } = useApp();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits(STATIC_ACTIONS);
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits(STATIC_ACTIONS.filter((a) =>
        !term || a.title.toLowerCase().includes(term.toLowerCase()),
      ));
      setActive(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ q: term });
    if (activeBrandId !== null) params.set("brand_id", String(activeBrandId));
    const handle = setTimeout(() => {
      api<{ hits: Hit[] }>("GET", `/api/search?${params}`)
        .then((res) => {
          if (cancelled) return;
          const actions = STATIC_ACTIONS.filter((a) =>
            a.title.toLowerCase().includes(term.toLowerCase()),
          );
          setHits([...res.hits, ...actions].slice(0, 18));
          setActive(0);
        })
        .catch(() => {
          if (!cancelled) setHits(STATIC_ACTIONS);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, open, activeBrandId]);

  const go = (hit: Hit) => {
    onClose();
    if (hit.href.startsWith("/?demo=reset")) {
      navigate("/");
      window.dispatchEvent(new CustomEvent("noble:demo-reset"));
      return;
    }
    navigate(hit.href);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  const groups = useMemo(() => {
    const order = ["customer", "job", "estimate", "invoice", "action"] as const;
    return order
      .map((type) => ({ type, items: hits.filter((h) => h.type === type) }))
      .filter((g) => g.items.length > 0);
  }, [hits]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div class="cmdk-overlay" onClick={onClose} role="presentation">
      <div
        class="cmdk"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown as any}
      >
        <div class="cmdk-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            class="cmdk-input"
            placeholder="Search customers, jobs, estimates… or jump"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
          <kbd class="cmdk-kbd">esc</kbd>
        </div>
        <div class="cmdk-results">
          {loading && <div class="cmdk-hint">Searching…</div>}
          {!loading && hits.length === 0 && <div class="cmdk-hint">No matches</div>}
          {groups.map((g) => (
            <div key={g.type} class="cmdk-group">
              <div class="cmdk-group-title">{g.type === "action" ? "Actions" : g.type + "s"}</div>
              {g.items.map((hit) => {
                flatIndex += 1;
                const idx = flatIndex;
                const Icon = TYPE_ICON[hit.type];
                return (
                  <button
                    key={`${hit.type}-${hit.id ?? hit.href}-${hit.title}`}
                    class={`cmdk-item ${idx === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(hit)}
                  >
                    <Icon size={16} />
                    <span class="cmdk-item-main">
                      <span class="cmdk-item-title">{hit.title}</span>
                      {hit.subtitle && <span class="cmdk-item-sub">{hit.subtitle}</span>}
                    </span>
                    <span class="cmdk-item-type">{hit.type}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div class="cmdk-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
