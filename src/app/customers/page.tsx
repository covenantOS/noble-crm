'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  estimateCount?: number;
  totalRevenue?: number;
  lastActivity?: string | null;
};

export default function CustomersListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '50');
    fetch(`/api/customers?${params}`)
      .then((r) => r.json())
      .then(setCustomers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>Search and view customers.</p>
        </div>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <div style={{ marginBottom: 20 }}>
              <input
                type="search"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  maxWidth: 400,
                  padding: '10px 14px',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 14,
                }}
              />
            </div>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>Loading…</div>
            ) : customers.length === 0 ? (
              <div className="empty-state">
                <h3>No customers found</h3>
                <p>Customers are created when you add a new estimate.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Estimates</th>
                    <th>Revenue</th>
                    <th>Last activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-primary">
                        <Link href={`/customers/${c.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {c.firstName} {c.lastName}
                        </Link>
                      </td>
                      <td>{c.phone}</td>
                      <td className="cell-muted">{c.email ?? '—'}</td>
                      <td>{c.estimateCount ?? 0}</td>
                      <td>
                        {c.totalRevenue != null && c.totalRevenue > 0
                          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(c.totalRevenue)
                          : '—'}
                      </td>
                      <td className="cell-muted">
                        {c.lastActivity ? new Date(c.lastActivity).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td>
                        <Link href={`/customers/${c.id}`} className="btn btn-ghost btn-sm">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}