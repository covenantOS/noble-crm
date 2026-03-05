'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Estimate = {
  id: string;
  status: string;
  scopeType: string;
  basePrice: number | null;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string | null; phone: string };
  property: { address: string; city: string; state: string; zip: string };
  _count: { photos: number; lineItems: number };
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'AI_PROCESSING', label: 'Processing' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'SENT', label: 'Sent' },
  { value: 'VIEWED', label: 'Viewed' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'EXPIRED', label: 'Expired' },
];

export default function EstimatesListPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(pagination.page));
    params.set('limit', String(pagination.limit));
    if (status !== 'all') params.set('status', status);
    if (searchApplied.trim()) params.set('search', searchApplied.trim());
    fetch(`/api/estimates?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEstimates(data.estimates || []);
        setPagination((prev) => ({ ...prev, ...data.pagination }));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [status, pagination.page, searchApplied]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchApplied(search);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const formatCurrency = (n: number | null) =>
    n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : '—';
  const formatStatus = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getStatusClass = (s: string) => {
    const map: Record<string, string> = {
      DRAFT: 'badge badge-draft',
      AI_PROCESSING: 'badge badge-processing',
      REVIEW: 'badge badge-review',
      SENT: 'badge badge-sent',
      VIEWED: 'badge badge-viewed',
      APPROVED: 'badge badge-approved',
      DECLINED: 'badge badge-declined',
      EXPIRED: 'badge badge-expired',
    };
    return map[s] || 'badge badge-draft';
  };

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Estimates</h1>
          <p>View and manage all estimates.</p>
        </div>
        <Link href="/estimates/new" className="btn btn-primary btn-lg">
          New Estimate
        </Link>
      </div>

      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <input
                type="search"
                placeholder="Search by customer or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  flex: '1 1 200px',
                  minWidth: 200,
                  padding: '10px 14px',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 14,
                }}
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{
                  padding: '10px 14px',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 14,
                }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-primary">
                Search
              </button>
            </form>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>Loading…</div>
            ) : estimates.length === 0 ? (
              <div className="empty-state">
                <h3>No estimates found</h3>
                <p>Create your first estimate or adjust filters.</p>
                <Link href="/estimates/new" className="btn btn-primary">
                  New Estimate
                </Link>
              </div>
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Property</th>
                      <th>Scope</th>
                      <th>Status</th>
                      <th>Price</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimates.map((est) => (
                      <tr key={est.id}>
                        <td className="cell-primary">
                          <Link href={`/estimates/${est.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {est.customer.firstName} {est.customer.lastName}
                          </Link>
                        </td>
                        <td>{est.property.address}, {est.property.city}</td>
                        <td style={{ textTransform: 'capitalize' }}>{est.scopeType.toLowerCase()}</td>
                        <td>
                          <span className={getStatusClass(est.status)}>{formatStatus(est.status)}</span>
                        </td>
                        <td className="cell-primary">{formatCurrency(est.basePrice)}</td>
                        <td className="cell-muted">{formatDate(est.createdAt)}</td>
                        <td>
                          <Link href={`/estimates/${est.id}`} className="btn btn-ghost btn-sm">
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pagination.pages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                    <span style={{ fontSize: 14, color: 'var(--gray-500)' }}>
                      Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pagination.page <= 1}
                        onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pagination.page >= pagination.pages}
                        onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
