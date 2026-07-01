import type { Priority } from "../types";

// Canonical status badge. The color map lives entirely in styles.css keyed on
// the data-status attribute (draft/pending/scheduled/sent/confirmed/
// in_progress/approved/completed/paid/cancelled/declined/overdue/expired/
// converted); this component just normalizes the label and stamps the
// attribute so every status across jobs/estimates/invoices renders identically.
// The dot inherits currentColor via CSS, so no inline colors here.
function humanizeStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  const raw = String(status);
  return (
    <span class="status-badge" data-status={raw}>
      <span class="status-dot" />
      {humanizeStatus(raw)}
    </span>
  );
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "var(--text-muted)",
  normal: "var(--info)",
  high: "var(--warning)",
  urgent: "var(--danger)",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = PRIORITY_COLORS[priority] || "var(--text-muted)";
  return (
    <span class="priority-badge" style={{ color }}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}
