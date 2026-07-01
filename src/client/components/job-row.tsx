import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatDate, formatTime, formatMoney } from "../format";
import { Trash2, CalendarRange } from "lucide-preact";
import type { Job } from "../types";

export function JobRow({ job }: { job: Job }) {
  const { navigate, deleteJob, isAgent } = useApp();
  const isMultiDay = !!job.end_date && job.end_date !== job.scheduled_date;

  return (
    <tr class="table-row clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
      <td>
        <span class="identifier">{job.identifier}</span>
        {job.brand_name && (
          <span class="brand-chip" style={{ marginLeft: 8 }}>
            <span class="brand-chip-dot" style={{ background: job.brand_color_primary || "#ccc" }} />
            {job.brand_name}
          </span>
        )}
      </td>
      <td>
        {formatDate(job.scheduled_date)}
        {isMultiDay && (
          <span class="text-muted" style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, fontSize: 11 }} title={`Runs through ${formatDate(job.end_date)}`}>
            <CalendarRange size={11} /> → {formatDate(job.end_date)}
          </span>
        )}
      </td>
      <td class="text-muted">{formatTime(job.scheduled_time)}</td>
      <td>{job.customer_name || "—"}</td>
      <td>
        {job.service_type_name ? (
          <span class="service-pill" style={{ borderColor: job.service_type_color || "#ccc" }}>
            <span class="service-dot" style={{ background: job.service_type_color || "#ccc" }} />
            {job.service_type_name}
          </span>
        ) : (
          <span class="text-muted">—</span>
        )}
      </td>
      <td>
        {job.technician_name ? (
          <span class="tech-pill" style={{ borderColor: job.technician_color || "#ccc" }}>
            <span class="tech-dot" style={{ background: job.technician_color || "#ccc" }} />
            {job.technician_name}
          </span>
        ) : (
          <span class="text-muted">Unassigned</span>
        )}
      </td>
      <td><StatusBadge status={job.status} /></td>
      <td class="text-right money">{formatMoney(job.price)}</td>
      {isAgent && (
        <td>
          <button
            class="btn-icon danger"
            onClick={(e) => { e.stopPropagation(); deleteJob(job.id); }}
          >
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  );
}
