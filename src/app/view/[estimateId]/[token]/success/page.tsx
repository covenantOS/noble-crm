'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SuccessContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const estimateId = params?.estimateId as string;
  const token = params?.token as string;
  const contractId = searchParams?.get('contractId');

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)] p-4">
      <div className="card max-w-lg text-center">
        <h1 className="text-2xl font-bold text-[var(--navy)] mb-2">You&apos;re all set</h1>
        <p className="text-[var(--gray-600)] mb-4">
          Thank you for your payment. We&apos;ve received your signed contract and will be in touch soon to schedule your project.
        </p>
        {contractId && <p className="text-sm text-[var(--gray-500)]">Contract reference: {contractId}</p>}
        <Link href={`/view/${estimateId}/${token}`} className="mt-6 inline-block text-[var(--gold)] font-medium">
          Back to estimate
        </Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <SuccessContent />
    </Suspense>
  );
}
