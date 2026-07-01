import { useState } from "preact/hooks";
import { useApp } from "../context";
import { CreateCustomer } from "./create-customer";
import { StatusBadge } from "./status-badge";
import { Pagination } from "./pagination";
import { Plus, Search, Trash2 } from "lucide-preact";

export function CustomerList() {
  const {
    customers, customersPag, setCustomersPage, customersSearch, setCustomersSearch,
    customersStatusFilter, setCustomersStatusFilter,
    navigate, deleteCustomer, isAgent,
  } = useApp();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div class="page">
      <div class="page-header">
        <h1>Customers</h1>
        <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Customer
        </button>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <Search size={14} class="search-icon" />
          <input
            type="text"
            placeholder="Search customers..."
            value={customersSearch}
            onInput={(e) => setCustomersSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <select value={customersStatusFilter} onChange={(e) => { setCustomersStatusFilter((e.target as HTMLSelectElement).value); setCustomersPage(1); }}>
          <option value="">All statuses</option>
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div class="card">
        {customers.length === 0 ? (
          <div class="empty-state">
            <p>No customers found</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add your first customer
            </button>
          </div>
        ) : (
          <table class="table table-flow">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Jobs</th>
                {isAgent && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {customers.filter((c) => c.name && c.name.trim()).map((c) => (
                <tr key={c.id} class="table-row clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                  <td class="text-bold fc-lead">{c.name}</td>
                  <td class="fc-end"><StatusBadge status={c.status} /></td>
                  <td class="text-muted nowrap">{c.phone || "—"}</td>
                  <td class="text-muted">{c.email || "—"}</td>
                  <td class="text-muted fc-full">{[c.address, c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td data-label="Jobs">{c.job_count || 0}</td>
                  {isAgent && (
                    <td>
                      <button
                        class="btn-icon danger"
                        onClick={(e) => { e.stopPropagation(); deleteCustomer(c.id); }}
                      >
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

      <Pagination pag={customersPag} setPage={setCustomersPage} />
      {showCreate && <CreateCustomer onClose={() => setShowCreate(false)} />}
    </div>
  );
}
