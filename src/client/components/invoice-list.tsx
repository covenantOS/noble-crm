import { useApp } from "../context";
import { Pagination } from "./pagination";
import { StatusBadge } from "./status-badge";
import { formatDate, formatMoney } from "../format";
import { Trash2 } from "lucide-preact";

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

export function InvoiceList() {
  const {
    invoices, invoicesPag, setInvoicesPage, invoicesStatusFilter, setInvoicesStatusFilter,
    navigate, deleteInvoice, isAgent,
  } = useApp();

  return (
    <div class="page">
      <div class="page-header">
        <h1>Invoices</h1>
      </div>

      <div class="toolbar">
        <div class="filter-group">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              class={`filter-btn ${invoicesStatusFilter === s.value ? "active" : ""}`}
              onClick={() => setInvoicesStatusFilter(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        {invoices.length === 0 ? (
          <div class="empty-state">
            <p>No invoices yet</p>
            <p class="text-muted">Create invoices from completed jobs</p>
          </div>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Job</th>
                <th>Status</th>
                <th>Due Date</th>
                <th class="text-right">Total</th>
                {isAgent && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} class="table-row clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <td>
                    <span class="identifier">{inv.identifier}</span>
                    {inv.brand_name && (
                      <span class="brand-chip" style={{ marginLeft: 8 }}>
                        <span class="brand-chip-dot" style={{ background: inv.brand_color_primary || "#ccc" }} />
                        {inv.brand_name}
                      </span>
                    )}
                  </td>
                  <td>{inv.customer_name || "—"}</td>
                  <td class="text-muted">{inv.job_identifier || "—"}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td class="text-muted">{formatDate(inv.due_date)}</td>
                  <td class="text-bold text-right money">{formatMoney(inv.total)}</td>
                  {isAgent && (
                    <td>
                      <button class="btn-icon danger" onClick={(e) => { e.stopPropagation(); deleteInvoice(inv.id); }}>
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

      <Pagination pag={invoicesPag} setPage={setInvoicesPage} />
    </div>
  );
}
