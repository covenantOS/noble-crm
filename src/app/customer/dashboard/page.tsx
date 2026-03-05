'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type CustomerData = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  estimates: Array<{
    id: string;
    status: string;
    basePrice: number | null;
    viewToken: string | null;
    createdAt: string;
    property: { address: string; city: string; state: string };
  }>;
  contracts: Array<{
    id: string;
    status: string;
    totalAmount: number;
    paymentTier: string;
    payments: Array<{ type: string; amount: number; status: string; paidAt: string | null }>;
    estimate: { property: { address: string; city: string } };
  }>;
};

export default function CustomerDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/customer/me')
      .then((r) => {
        if (r.status === 401) {
          router.replace('/customer');
          return null;
        }
        return r.json();
      })
      .then(setData)
      .finally(() => setLoading(false));
  }, [router]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)]">
        <p className="text-[var(--gray-600)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--gray-50)]">
      <header className="bg-[var(--navy)] text-white py-4 px-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold">Welcome, {data.firstName}</h1>
            <p className="text-[var(--gold)] text-sm">Westchase Painting Company — Your projects</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/customer/logout', { method: 'POST' });
              router.replace('/customer');
            }}
            className="text-sm opacity-90 hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <section className="card">
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-4">Your estimates</h2>
          {data.estimates.length === 0 ? (
            <p className="text-[var(--gray-600)]">No estimates yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.estimates.map((est) => (
                <li key={est.id} className="flex justify-between items-center py-2 border-b border-[var(--gray-100)] last:border-0">
                  <div>
                    <p className="font-medium">{est.property.address}, {est.property.city}, {est.property.state}</p>
                    <p className="text-sm text-[var(--gray-500)]">{est.status} • {est.basePrice != null ? formatCurrency(est.basePrice) : '—'}</p>
                  </div>
                  {est.viewToken && (
                    <Link href={`/view/${est.id}/${est.viewToken}`} className="btn btn-outline btn-sm">
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-4">Your contracts & payments</h2>
          {data.contracts.length === 0 ? (
            <p className="text-[var(--gray-600)]">No contracts yet.</p>
          ) : (
            <ul className="space-y-4">
              {data.contracts.map((c) => (
                <li key={c.id} className="py-3 border-b border-[var(--gray-100)] last:border-0">
                  <p className="font-medium">{c.estimate.property.address}, {c.estimate.property.city}</p>
                  <p className="text-sm text-[var(--gray-500)]">
                    Total: {formatCurrency(c.totalAmount)} • {c.paymentTier.replace(/_/g, ' ')} • Status: {c.status}
                  </p>
                  <div className="mt-2 text-sm">
                    {c.payments.map((p, i) => (
                      <span key={i}>
                        {p.type}: {formatCurrency(p.amount)} — {p.status}
                        {p.paidAt && ` (paid)`}
                        {i < c.payments.length - 1 ? ' • ' : ''}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-sm text-[var(--gray-500)]">
          Questions? Contact us at the number on your estimate.
        </p>
      </main>
    </div>
  );
}
