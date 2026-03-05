'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Estimate = {
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
  humanNotes: string | null;
  viewToken: string | null;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string; email: string | null; phone: string };
  property: { address: string; city: string; state: string; zip: string };
  lineItems: Array<{ id: string; category: string; description: string; quantity: number; unit: string; unitCost: number; totalCost: number }>;
  photos: Array<{ id: string; url: string; caption: string | null; location: string | null }>;
  aiAnalysis?: {
    photoAnalysis?: Array<{ photoIndex: number; findings: string; severity: string; recommendation?: string }>;
    flags?: Array<{ type: string; message: string; estimatedAdditionalCost?: number | null }>;
  };
};

export default function EstimateDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const isReview = searchParams?.get('review') === '1';
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/estimates/${id}`)
      .then((r) => r.json())
      .then(setEstimate)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const formatCurrency = (n: number | null) =>
    n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : '—';
  const formatStatus = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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

  if (loading || !estimate) {
    return (
      <AppLayout>
        <div className="page-header">
          <h1>Estimate</h1>
          <p>{loading ? 'Loading…' : 'Not found.'}</p>
        </div>
      </AppLayout>
    );
  }

  const viewLink = estimate.viewToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/view/${estimate.id}/${estimate.viewToken}`
    : null;

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <Link href="/estimates" style={{ fontSize: 14, color: 'var(--gray-500)', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
            ← Back to estimates
          </Link>
          <h1>Estimate</h1>
          <p>
            {estimate.customer.firstName} {estimate.customer.lastName} — {estimate.property.address}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={getStatusClass(estimate.status)}>{formatStatus(estimate.status)}</span>
          {viewLink && (
            <a href={viewLink} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              View customer page
            </a>
          )}
          <Link href={`/estimates/${estimate.id}/edit`} className="btn btn-ghost btn-sm">
            Edit
          </Link>
        </div>
      </div>

      {isReview && estimate.status === 'REVIEW' && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--info-light)', borderRadius: 'var(--radius-md)', color: 'var(--gray-800)' }}>
          <strong>Review mode.</strong> Review the AI-generated estimate below. Approve to generate PDF and send to customer, or edit to adjust.
        </div>
      )}

      <div className="page-body" style={{ display: 'grid', gap: 24, maxWidth: 900 }}>
        <div className="card">
          <div className="card-header">
            <h2>Customer & Property</h2>
          </div>
          <div className="card-body">
            <p style={{ margin: 0 }}>
              <strong>{estimate.customer.firstName} {estimate.customer.lastName}</strong><br />
              {estimate.customer.phone}
              {estimate.customer.email && <> · {estimate.customer.email}</>}
            </p>
            <p style={{ margin: '12px 0 0', color: 'var(--gray-600)' }}>
              {estimate.property.address}, {estimate.property.city}, {estimate.property.state} {estimate.property.zip}
            </p>
            {estimate.humanNotes && (
              <p style={{ marginTop: 12, fontSize: 14, fontStyle: 'italic', color: 'var(--gray-600)' }}>{estimate.humanNotes}</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Pricing</h2>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>Base (finance)</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(estimate.basePrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>Upfront cash</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(estimate.upfrontCashPrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>Upfront card</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(estimate.upfrontCardPrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>Payment plan</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(estimate.paymentPlanPrice)}</div>
              </div>
            </div>
          </div>
        </div>

        {estimate.scopeOfWork && (
          <div className="card">
            <div className="card-header">
              <h2>Scope of Work</h2>
            </div>
            <div className="card-body">
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{estimate.scopeOfWork}</div>
              {estimate.timeline && (
                <p style={{ marginTop: 16, fontWeight: 600 }}>Timeline: {estimate.timeline}</p>
              )}
            </div>
          </div>
        )}

        {estimate.lineItems.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>Line Items</h2>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.lineItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ textTransform: 'capitalize' }}>{item.category.toLowerCase()}</td>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{formatCurrency(item.unitCost)}</td>
                      <td className="cell-primary">{formatCurrency(item.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {estimate.aiAnalysis?.flags && estimate.aiAnalysis.flags.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>AI Flags & Recommendations</h2>
            </div>
            <div className="card-body">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {estimate.aiAnalysis.flags.map((f, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{f.type.toLowerCase()}:</span> {f.message}
                    {f.estimatedAdditionalCost != null && f.estimatedAdditionalCost > 0 && (
                      <span> (est. +{formatCurrency(f.estimatedAdditionalCost)})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {estimate.aiAnalysis?.photoAnalysis && estimate.aiAnalysis.photoAnalysis.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>Photo Analysis</h2>
            </div>
            <div className="card-body">
              {estimate.aiAnalysis.photoAnalysis.map((pa, i) => (
                <div key={i} style={{ marginBottom: 12, padding: 12, background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4 }}>Photo {pa.photoIndex + 1}</div>
                  <p style={{ margin: 0 }}>{pa.findings}</p>
                  {pa.recommendation && <p style={{ margin: '8px 0 0', fontSize: 13, fontStyle: 'italic' }}>{pa.recommendation}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}