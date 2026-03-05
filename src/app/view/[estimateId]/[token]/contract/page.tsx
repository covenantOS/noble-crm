'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, Suspense } from 'react';
import { buildContractSections, type ContractData, type PaymentTierKey } from '@/lib/contract';

type EstimateView = {
  id: string;
  scopeOfWork: string | null;
  timeline: string | null;
  basePrice: number | null;
  upfrontCashPrice: number | null;
  upfrontCardPrice: number | null;
  financePrice: number | null;
  paymentPlanPrice: number | null;
  customer: { firstName: string; lastName: string; email: string | null; phone: string; address: string | null; city: string | null; state: string | null; zip: string | null };
  property: { address: string; city: string; state: string; zip: string };
  paymentSchedule: { depositAmount: number; midpointAmount: number; completionAmount: number; total: number };
  company: Record<string, string>;
};

function ContractContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const estimateId = params?.estimateId as string;
  const token = params?.token as string;
  const tier = (searchParams?.get('tier') as PaymentTierKey) || 'UPFRONT_CASH';
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [signerName, setSignerName] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sigRef = useRef<HTMLCanvasElement | null>(null);
  const signaturePadRef = useRef<{ clear: () => void; toDataURL: (type?: string) => string } | null>(null);

  useEffect(() => {
    if (!estimateId || !token) return;
    fetch(`/api/view/estimate?estimateId=${encodeURIComponent(estimateId)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setEstimate)
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [estimateId, token]);

  useEffect(() => {
    if (typeof window === 'undefined' || !sigRef.current) return;
    const canvas = sigRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let drawing = false;
    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      drawing = true;
      const ev = 'touches' in e ? e.touches[0] : e;
      const rect = canvas.getBoundingClientRect();
      ctx.beginPath();
      ctx.moveTo(ev.clientX - rect.left, ev.clientY - rect.top);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const ev = 'touches' in e ? e.touches[0] : e;
      const rect = canvas.getBoundingClientRect();
      ctx.lineTo(ev.clientX - rect.left, ev.clientY - rect.top);
      ctx.stroke();
    };
    const end = () => { drawing = false; };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    signaturePadRef.current = {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
      toDataURL(type = 'image/png') { return canvas.toDataURL(type); },
    };
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseup', end);
      canvas.removeEventListener('mouseleave', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
    };
  }, [estimate]);

  const getTotal = () => {
    if (!estimate) return 0;
    switch (tier) {
      case 'UPFRONT_CASH': return estimate.upfrontCashPrice ?? estimate.basePrice ?? 0;
      case 'UPFRONT_CARD': return estimate.upfrontCardPrice ?? estimate.basePrice ?? 0;
      case 'FINANCE': return estimate.financePrice ?? estimate.basePrice ?? 0;
      case 'PAYMENT_PLAN': return estimate.paymentPlanPrice ?? estimate.basePrice ?? 0;
      default: return estimate.basePrice ?? 0;
    }
  };

  const handleSubmit = async () => {
    if (!estimate || !signerName.trim() || !agree) {
      setError('Please enter your full name and check the agreement.');
      return;
    }
    const sigData = signaturePadRef.current?.toDataURL();
    if (!sigData || sigData.length < 100) {
      setError('Please provide your signature.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/contracts/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimateId,
          token,
          paymentTier: tier,
          signerName: signerName.trim(),
          signatureData: sigData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !estimate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)]">
        <p className="text-[var(--gray-600)]">Loading contract…</p>
      </div>
    );
  }

  const companyName = estimate.company.companyName || 'Westchase Painting Company LLC';
  const companyAddress = estimate.company.companyAddress || 'Tampa, FL';
  const companyPhone = estimate.company.companyPhone || '(813) 555-0123';
  const companyEmail = estimate.company.companyEmail || 'info@nobletampa.com';
  const customerAddr = [estimate.customer.address, estimate.customer.city, estimate.customer.state, estimate.customer.zip].filter(Boolean).join(', ');
  const total = getTotal();
  const schedule = estimate.paymentSchedule;
  const contractData: ContractData = {
    companyName,
    companyAddress,
    companyPhone,
    companyEmail,
    customerName: `${estimate.customer.firstName} ${estimate.customer.lastName}`,
    customerAddress: customerAddr || estimate.property.address,
    propertyAddress: `${estimate.property.address}, ${estimate.property.city}, ${estimate.property.state} ${estimate.property.zip}`,
    scopeOfWork: estimate.scopeOfWork || 'Painting services as described in the estimate.',
    paymentTier: tier,
    totalAmount: total,
    depositAmount: tier === 'PAYMENT_PLAN' ? schedule.depositAmount : undefined,
    midpointAmount: tier === 'PAYMENT_PLAN' ? schedule.midpointAmount : undefined,
    completionAmount: tier === 'PAYMENT_PLAN' ? schedule.completionAmount : undefined,
    timeline: estimate.timeline || 'Within 2 weeks of contract execution and deposit receipt. Completion approximately 5–10 working days from start.',
    warrantyYears: 2,
    changeOrderMarkupPercent: 15,
    contractDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  };

  const sections = buildContractSections(contractData);

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)] p-4">
        <div className="card max-w-lg text-center">
          <h1 className="text-xl font-bold text-[var(--navy)] mb-2">Contract submitted</h1>
          <p className="text-[var(--gray-600)]">Thank you. We will send you a copy and next steps shortly.</p>
          <Link href={`/view/${estimateId}/${token}`} className="mt-4 inline-block text-[var(--gold)] font-medium">Back to estimate</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--gray-50)]">
      <header className="bg-[var(--navy)] text-white py-4 px-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-bold">Westchase Painting Company — Contract</h1>
          <p className="text-[var(--gold)] text-sm">By Noble</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="card">
          <p className="text-sm text-[var(--gray-600)] mb-4">
            Property: {estimate.property.address}, {estimate.property.city}, {estimate.property.state} {estimate.property.zip}
          </p>
          <p className="font-semibold text-[var(--navy)]">Total: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total)}</p>
        </div>

        <div className="card space-y-4">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-sm font-bold text-[var(--navy)] mb-1">{s.title}</h2>
              <p className="text-sm text-[var(--gray-700)] whitespace-pre-wrap">{s.body}</p>
            </section>
          ))}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-3">Sign below</h2>
          <label className="block text-sm font-medium text-[var(--gray-700)] mb-1">Full legal name</label>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="input w-full mb-4"
            placeholder="John Smith"
          />
          <label className="block text-sm font-medium text-[var(--gray-700)] mb-1">Signature</label>
          <div className="border border-[var(--gray-200)] rounded-lg bg-white overflow-hidden mb-4">
            <canvas
              ref={sigRef}
              width={400}
              height={120}
              className="w-full h-[120px] touch-none block"
              style={{ maxWidth: '100%' }}
            />
          </div>
          <button type="button" onClick={() => signaturePadRef.current?.clear()} className="text-sm text-[var(--gray-600)] underline mb-4">
            Clear signature
          </button>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span className="text-sm text-[var(--gray-700)]">
              I have read and agree to all terms of this contract. I authorize the charges and auto-charge (if applicable) as described.
            </span>
          </label>
          {error && <p className="mt-2 text-sm text-[var(--error)]">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-4 w-full py-3 bg-[var(--navy)] text-white font-semibold rounded-lg hover:bg-[var(--navy-light)] disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit contract'}
          </button>
        </div>

        <p className="text-center text-sm text-[var(--gray-500)]">
          <Link href={`/view/${estimateId}/${token}`}>← Back to estimate</Link>
        </p>
      </main>
    </div>
  );
}

export default function ContractPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <ContractContent />
    </Suspense>
  );
}
