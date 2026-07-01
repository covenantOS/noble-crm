import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Pagination } from "./pagination";
import { CreateEstimate } from "./create-estimate";
import { StatusBadge } from "./status-badge";
import { formatDate, formatMoney } from "../format";
import { Search, Trash2, Plus } from "lucide-preact";

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Converted" },
];

export function EstimateList() {
  const {
    estimates, estimatesPag, setEstimatesPage, estimatesSearch, setEstimatesSearch,
    estimatesStatusFilter, setEstimatesStatusFilter, navigate, deleteEstimate, isAgent,
  } = useApp();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div class="page">
      <div class="page-header">
        <h1>Estimates</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Estimate
        </button>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <Search size={14} class="search-icon" />
          <input
            type="text"
            placeholder="Search estimates..."
            value={estimatesSearch}
            onInput={(e) => setEstimatesSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="filter-group">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              class={`filter-btn ${estimatesStatusFilter === s.value ? "active" : ""}`}
              onClick={() => setEstimatesStatusFilter(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        {estimates.length === 0 ? (
          <div class="empty-state">
            <p>No estimates yet</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
              Create your first estimate
            </button>
          </div>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Estimate</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Valid Until</th>
                <th class="text-right">Total</th>
                {isAgent && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {estimates.map((est) => (
                <tr key={est.id} class="table-row clickable" onClick={() => navigate(`/estimates/${est.id}`)}>
                  <td>
                    <span class="identifier">{est.identifier}</span>
                    {est.brand_name && (
                      <span class="brand-chip" style={{ marginLeft: 8 }}>
                        <span class="brand-chip-dot" style={{ background: est.brand_color_primary || "#ccc" }} />
                        {est.brand_name}
                      </span>
                    )}
                  </td>
                  <td>{est.customer_name || "—"}</td>
                  <td><StatusBadge status={est.status} /></td>
                  <td class="text-muted">{formatDate(est.valid_until)}</td>
                  <td class="text-bold text-right money">{formatMoney(est.total)}</td>
                  {isAgent && (
                    <td>
                      <button class="btn-icon danger" onClick={(e) => { e.stopPropagation(); deleteEstimate(est.id); }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination pag={estimatesPag} setPage={setEstimatesPage} />
      {showCreate && <CreateEstimate onClose={() => setShowCreate(false)} />}
    </div>
  );
}
