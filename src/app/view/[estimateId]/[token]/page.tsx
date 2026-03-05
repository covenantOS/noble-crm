'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

type EstimateView = {
  id: string;
  status: string;
  scopeType: string;
  basePrice: number | null;
  upfrontCashPrice: number | null;
  upfrontCardPrice: number | null;
  financePrice: number | null;
  paymentPlanPrice: number | null;
  scopeOfWork: string | null;
  timeline: string | null;
  viewToken: string | null;
  customer: { firstName: string; lastName: string; email: string | null; phone: string };
  property: { address: string; city: string; state: string; zip: string };
  lineItems: Array<{ description: string; quantity: number; unit: string; unitCost: number; totalCost: number }>;
  photos: Array<{ id: string; url: string; caption: string | null; location: string | null }>;
  paymentSchedule: { depositAmount: number; midpointAmount: number; completionAmount: number; total: number };
  company: Record<string, string>;
};

const PAYMENT_TIERS = [
  {
    id: 'UPFRONT_CASH',
    name: 'Pay in Full by Check or Bank Transfer',
    badge: 'Best Value',
    description: 'One payment before work begins. You save the most.',
    getPrice: (e: EstimateView) => e.upfrontCashPrice ?? e.basePrice ?? 0,
    savings: (e: EstimateView) => (e.basePrice ?? 0) - (e.upfrontCashPrice ?? e.basePrice ?? 0),
    highlight: true,
  },
  {
    id: 'UPFRONT_CARD',
    name: 'Pay in Full by Card',
    badge: null,
    description: 'One payment by credit or debit card.',
    getPrice: (e: EstimateView) => e.upfrontCardPrice ?? e.basePrice ?? 0,
    savings: (e: EstimateView) => (e.basePrice ?? 0) - (e.upfrontCardPrice ?? e.basePrice ?? 0),
    highlight: false,
  },
  {
    id: 'FINANCE',
    name: 'Finance with Klarna or Afterpay',
    badge: 'Most Popular',
    description: 'Pay over time with Klarna or Afterpay. Standard price.',
    getPrice: (e: EstimateView) => e.financePrice ?? e.basePrice ?? 0,
    savings: () => 0,
    highlight: false,
  },
  {
    id: 'PAYMENT_PLAN',
    name: 'Payment Plan (50/40/10)',
    badge: null,
    description: 'Split into 3 payments: at signing, midpoint, and completion.',
    getPrice: (e: EstimateView) => e.paymentPlanPrice ?? e.basePrice ?? 0,
    schedule: (e: EstimateView) => e.paymentSchedule,
    highlight: false,
  },
];

function ViewContent() {
  const params = useParams();
  const estimateId = params?.estimateId as string;
  const token = params?.token as string;
  const [data, setData] = useState<EstimateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!estimateId || !token) return;
    fetch(`/api/view/estimate?estimateId=${encodeURIComponent(estimateId)}&token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Invalid or expired link');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [estimateId, token]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)]">
        <div className="text-center">
          <div className="animate-pulse w-12 h-12 border-4 border-[var(--gold)] border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-[var(--gray-600)]">Loading your estimate…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)] p-4">
        <div className="card max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-[var(--navy)] mb-2">Link invalid or expired</h1>
          <p className="text-[var(--gray-600)]">Please request a new estimate link from Westchase Painting Company.</p>
        </div>
      </div>
    );
  }

  const basePrice = data.basePrice ?? 0;

  return (
    <div className="min-h-screen bg-[var(--gray-50)]">
      {/* Header */}
      <header className="bg-[var(--navy)] text-white py-6 px-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold">Westchase Painting Company</h1>
          <p className="text-[var(--gold)] font-medium">By Noble</p>
          <div className="flex flex-wrap gap-3 mt-4 text-sm opacity-90">
            <span>Bonded &amp; Insured</span>
            <span>•</span>
            <span>EPA Lead-Safe Certified</span>
            <span>•</span>
            <span>PCA Member</span>
            <span>•</span>
            <span>Sherwin-Williams PRO+ Partner</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="card">
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-1">Property</h2>
          <p className="text-[var(--gray-700)]">
            {data.property.address}, {data.property.city}, {data.property.state} {data.property.zip}
          </p>
        </div>

        {data.scopeOfWork && (
          <div className="card">
            <h2 className="text-lg font-semibold text-[var(--navy)] mb-3">Scope of Work</h2>
            <div className="text-[var(--gray-700)] whitespace-pre-wrap">{data.scopeOfWork}</div>
            {data.timeline && (
              <p className="mt-3 text-sm text-[var(--gray-600)]">
                <strong>Timeline:</strong> {data.timeline}
              </p>
            )}
          </div>
        )}

        {data.photos.length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold text-[var(--navy)] mb-3">Photos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {data.photos.map((p) => (
                <div key={p.id} className="rounded-lg overflow-hidden bg-[var(--gray-200)] aspect-video">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || p.location || 'Photo'} className="w-full h-full object-cover" />
                  {(p.caption || p.location) && (
                    <p className="p-2 text-xs text-[var(--gray-600)]">{p.caption || p.location}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-2">Line Items</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gray-200)]">
                <th className="text-left py-2 font-medium">Description</th>
                <th className="text-right py-2 font-medium">Qty</th>
                <th className="text-right py-2 font-medium">Unit</th>
                <th className="text-right py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.lineItems.map((item, i) => (
                <tr key={i} className="border-b border-[var(--gray-100)]">
                  <td className="py-2">{item.description}</td>
                  <td className="text-right py-2">{item.quantity}</td>
                  <td className="text-right py-2">{item.unit}</td>
                  <td className="text-right py-2 font-medium">{formatCurrency(item.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section>
          <h2 className="text-xl font-bold text-[var(--navy)] mb-4">Choose Your Payment Option</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {PAYMENT_TIERS.map((tier) => {
              const price = tier.getPrice(data);
              const savings = tier.savings?.(data) ?? 0;
              const schedule = tier.schedule?.(data);
              const isCash = tier.id === 'UPFRONT_CASH';
              return (
                <div
                  key={tier.id}
                  className={`card relative overflow-hidden ${tier.highlight ? 'ring-2 ring-[var(--gold)] shadow-[var(--shadow-gold)]' : ''}`}
                >
                  {tier.badge && (
                    <span className="absolute top-0 right-0 bg-[var(--gold)] text-[var(--navy)] text-xs font-bold px-2 py-1 rounded-bl">
                      {tier.badge}
                    </span>
                  )}
                  <h3 className="text-base font-semibold text-[var(--navy)] pr-20">{tier.name}</h3>
                  <p className="text-sm text-[var(--gray-600)] mt-1">{tier.description}</p>
                  <p className="mt-3 text-2xl font-bold text-[var(--navy)]">{formatCurrency(price)}</p>
                  {savings > 0 && (
                    <p className="text-sm text-[var(--success)] font-medium">You save {formatCurrency(savings)}</p>
                  )}
                  {schedule && (
                    <div className="mt-2 text-sm text-[var(--gray-600)]">
                      <p>Deposit: {formatCurrency(schedule.depositAmount)}</p>
                      <p>Midpoint: {formatCurrency(schedule.midpointAmount)}</p>
                      <p>Completion: {formatCurrency(schedule.completionAmount)}</p>
                    </div>
                  )}
                  <Link
                    href={`/view/${estimateId}/${token}/contract?tier=${tier.id}`}
                    className={`mt-4 inline-block w-full text-center py-2.5 rounded-lg font-medium transition ${isCash ? 'bg-[var(--gold)] text-[var(--navy)] hover:bg-[var(--gold-light)]' : 'bg-[var(--navy)] text-white hover:bg-[var(--navy-light)]'}`}
                  >
                    Select This Option
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="text-center text-sm text-[var(--gray-500)] py-6">
          {data.company.companyName || 'Westchase Painting Company'} • {data.company.companyPhone || '(813) 555-0123'}
        </footer>
      </main>
    </div>
  );
}

export default function ViewEstimatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)]">Loading…</div>}>
      <ViewContent />
    </Suspense>
  );
}
