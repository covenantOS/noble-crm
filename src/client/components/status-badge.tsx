import type { JobStatus, Priority } from "../types";

const STATUS_COLORS: Record<JobStatus, string> = {
  scheduled: "#3b82f6",
  confirmed: "#8b5cf6",
  in_progress: "#f59e0b",
  completed: "#16a34a",
  cancelled: "#6b7280",
};

const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#6b7280",
  normal: "#3b82f6",
  high: "#f59e0b",
  urgent: "#dc2626",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span class="status-badge" style={{ background: `${color}14`, color, borderColor: `${color}30` }}>
      <span class="status-dot" style={{ background: color }} />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = PRIORITY_COLORS[priority] || "#6b7280";
  return (
    <span class="priority-badge" style={{ color }}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}
