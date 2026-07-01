import { useApp } from "../context";
import { StatusBadge } from "./status-badge";
import { Trash2 } from "lucide-preact";
import type { Job } from "../types";

export function JobRow({ job }: { job: Job }) {
  const { navigate, deleteJob, isAgent } = useApp();

  return (
    <tr class="table-row clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
      <td>
        <span class="identifier">{job.identifier}</span>
        {job.brand_name && (
          <span class="color-swatch" title={job.brand_name} style={{ background: job.brand_color_primary || "#ccc", marginLeft: 6 }} />
        )}
      </td>
      <td>{job.scheduled_date}</td>
      <td class="text-muted">{job.scheduled_time}</td>
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
      <td class="text-right">${job.price.toFixed(2)}</td>
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
