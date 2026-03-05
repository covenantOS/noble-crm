'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  properties: Array<{ id: string; address: string; city: string; state: string; zip: string }>;
  estimates: Array<{
    id: string;
    status: string;
    basePrice: number | null;
    createdAt: string;
    property: { address: string };
  }>;
  contracts: Array<{ id: string; status: string; totalAmount: number; createdAt: string }>;
};

export default function CustomerDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/customers/${id}`)
      .then((r) => r.json())
      .then(setCustomer)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const formatStatus = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (loading || !customer) {
    return (
      <AppLayout>
        <div className="page-header">
          <h1>Customer</h1>
          <p>{loading ? 'Loading…' : 'Not found.'}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <Link href="/customers" style={{ fontSize: 14, color: 'var(--gray-500)', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
            ← Back to customers
          </Link>
          <h1>{customer.firstName} {customer.lastName}</h1>
          <p>
            {customer.phone}
            {customer.email && <> · {customer.email}</>}
          </p>
        </div>
        <Link href={`/estimates/new`} className="btn btn-primary">
          New estimate for this customer
        </Link>
      </div>

      <div className="page-body" style={{ display: 'grid', gap: 24, maxWidth: 900 }}>
        {(customer.address || customer.city) && (
          <div className="card">
            <div className="card-header"><h2>Address</h2></div>
            <div className="card-body">
              <p style={{ margin: 0 }}>
                {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
        )}

        {customer.notes && (
          <div className="card">
            <div className="card-header"><h2>Notes</h2></div>
            <div className="card-body">
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{customer.notes}</p>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <h2>Properties</h2>
            <span style={{ fontSize: 14, color: 'var(--gray-500)' }}>{customer.properties.length}</span>
          </div>
          <div className="card-body">
            {customer.properties.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--gray-500)' }}>No properties yet. Properties are added when you create estimates.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {customer.properties.map((p) => (
                  <li key={p.id}>{p.address}, {p.city}, {p.state} {p.zip}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Estimates</h2>
            <Link href={`/estimates?search=${encodeURIComponent(customer.firstName + ' ' + customer.lastName)}`} className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {customer.estimates.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--gray-500)' }}>No estimates yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customer.estimates.slice(0, 10).map((est) => (
                    <tr key={est.id}>
                      <td>{est.property.address}</td>
                      <td>{formatStatus(est.status)}</td>
                      <td>{est.basePrice != null ? formatCurrency(est.basePrice) : '—'}</td>
                      <td className="cell-muted">{formatDate(est.createdAt)}</td>
                      <td>
                        <Link href={`/estimates/${est.id}`} className="btn btn-ghost btn-sm">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>Contracts</h2></div>
          <div className="card-body" style={{ padding: 0 }}>
            {customer.contracts.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--gray-500)' }}>No contracts yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.contracts.map((c) => (
                    <tr key={c.id}>
                      <td>{formatStatus(c.status)}</td>
                      <td>{formatCurrency(c.totalAmount)}</td>
                      <td className="cell-muted">{formatDate(c.createdAt)}</td>
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