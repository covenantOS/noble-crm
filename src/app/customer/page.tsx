'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CustomerLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'identify' | 'code'>('identify');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const isEmail = identifier.includes('@');
      const res = await fetch('/api/customer/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEmail ? { email: identifier.trim() } : { phone: identifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code');
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const isEmail = identifier.includes('@');
      const res = await fetch('/api/customer/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEmail ? { email: identifier } : { phone: identifier }),
          code: code.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      router.push('/customer/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--gray-50)] p-4">
      <div className="card w-full max-w-md">
        <div className="bg-[var(--navy)] text-white -mx-6 -mt-6 px-6 py-6 rounded-t-lg mb-6">
          <h1 className="text-xl font-bold">Customer Portal</h1>
          <p className="text-[var(--gold)] text-sm">Westchase Painting Company by Noble</p>
        </div>
        {step === 'identify' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <p className="text-sm text-[var(--gray-600)]">
              Enter your email or phone number to receive a one-time login code.
            </p>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Email or phone"
              className="input w-full"
              required
            />
            {error && <p className="text-sm text-[var(--error)]">{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-[var(--gray-600)]">
              We sent a 6-digit code to {identifier}. Enter it below.
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="input w-full text-center text-2xl tracking-widest"
              maxLength={6}
              required
            />
            {error && <p className="text-sm text-[var(--error)]">{error}</p>}
            <button type="submit" disabled={loading || code.length !== 6} className="btn btn-primary w-full">
              {loading ? 'Verifying…' : 'Log in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('identify'); setCode(''); setError(''); }}
              className="btn btn-ghost w-full text-sm"
            >
              Use a different email or phone
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-[var(--gray-500)]">
          <Link href="/">Back to main site</Link>
        </p>
      </div>
    </div>
  );
}
