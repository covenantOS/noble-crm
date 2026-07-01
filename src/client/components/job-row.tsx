import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { formatDate, formatTime, formatMoney } from "../format";
import { Trash2, CalendarRange } from "lucide-preact";
import type { Job } from "../types";

export function JobRow({ job }: { job: Job }) {
  const { navigate, deleteJob, isAgent, activeBrandId } = useApp();
  const isMultiDay = !!job.end_date && job.end_date !== job.scheduled_date;
  // The account chip is only signal when browsing across accounts; under a
  // specific account it repeats the context ribbon on every row.
  const showBrand = activeBrandId === null && !!job.brand_name;

  return (
    <tr class="table-row clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
      <td class="fc-lead">
        <span class="identifier">{job.identifier}</span>
        {showBrand && (
          <span class="brand-chip" style={{ marginLeft: 8 }}>
            <span class="brand-chip-dot" style={{ background: job.brand_color_primary || "#ccc" }} />
            {job.brand_name}
          </span>
        )}
      </td>
      <td>
        <span class="nowrap">{formatDate(job.scheduled_date)}</span>
        {job.scheduled_time && <>{" "}<span class="text-muted nowrap">· {formatTime(job.scheduled_time)}</span></>}
        {isMultiDay && (
          <span class="text-muted" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }} title={`Runs through ${formatDate(job.end_date)}`}>
            <CalendarRange size={11} /> → {formatDate(job.end_date)}
          </span>
        )}
      </td>
      <td class="fc-full">{job.customer_name || "—"}</td>
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
      <td class="text-right money fc-end text-bold">{formatMoney(job.price)}</td>
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
