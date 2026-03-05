'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type PaymentRow = {
  id: string;
  type: string;
  amount: number;
  status: string;
  paidAt: string | null;
  dueDate: string | null;
  propertyAddress?: string;
};
type MessageRow = {
  id: string;
  direction: string;
  channel: string;
  content: string;
  status: string;
  createdAt: string;
};
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
  totalRevenue?: number;
  lastActivity?: string | null;
  properties: Array<{ id: string; address: string; city: string; state: string; zip: string }>;
  estimates: Array<{
    id: string;
    status: string;
    basePrice: number | null;
    createdAt: string;
    property: { address: string };
  }>;
  contracts: Array<{ id: string; status: string; totalAmount: number; createdAt: string }>;
  payments?: PaymentRow[];
  messages?: MessageRow[];
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
          {(customer.totalRevenue != null && customer.totalRevenue > 0) && (
            <p style={{ marginTop: 4, fontSize: 14, color: 'var(--gray-600)' }}>
              Total revenue: {formatCurrency(customer.totalRevenue)}
              {customer.lastActivity && ` · Last activity: ${formatDate(customer.lastActivity)}`}
            </p>
          )}
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

        {customer.payments && customer.payments.length > 0 && (
          <div className="card">
            <div className="card-header"><h2>Payments</h2></div>
            <div className="card-body" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatStatus(p.type)}</td>
                      <td>{formatCurrency(p.amount)}</td>
                      <td>{formatStatus(p.status)}</td>
                      <td className="cell-muted">{p.dueDate ? formatDate(p.dueDate) : '—'}</td>
                      <td className="cell-muted">{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {customer.messages && customer.messages.length > 0 && (
          <div className="card">
            <div className="card-header"><h2>Message History</h2></div>
            <div className="card-body" style={{ padding: 0 }}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {customer.messages.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--gray-100)',
                      fontSize: 13,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{m.direction.toLowerCase()} · {m.channel}</span>
                      <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>{formatDate(m.createdAt)}</span>
                    </div>
                    <div style={{ color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}