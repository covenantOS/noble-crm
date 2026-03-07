'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, Suspense, useEffect } from 'react';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [valid, setValid] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setValid(false);
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => setValid(data.valid === true))
      .catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (valid === null) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>Westchase Painting Co.</h1>
            <p>By Noble</p>
            <h2>Loading…</h2>
          </div>
          <div style={{ padding: 32, textAlign: 'center' }}>Checking link…</div>
        </div>
      </div>
    );
  }

  if (valid === false) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>Westchase Painting Co.</h1>
            <p>By Noble</p>
            <h2>Invalid or expired link</h2>
          </div>
          <p style={{ padding: '0 32px 24px', color: 'var(--gray-600)' }}>
            This password reset link is invalid or has expired. Request a new one.
          </p>
          <div style={{ padding: '0 32px 32px' }}>
            <Link href="/forgot-password" className="btn btn-primary btn-lg" style={{ display: 'inline-block', textAlign: 'center' }}>
              Request new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>Westchase Painting Co.</h1>
            <p>By Noble</p>
            <h2>Password updated</h2>
          </div>
          <p style={{ padding: '0 32px 24px', color: 'var(--gray-600)' }}>
            You can sign in with your new password. Redirecting to login…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>Westchase Painting Co.</h1>
          <p>By Noble</p>
          <h2>Set new password</h2>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            <Link href="/login" style={{ fontSize: 14, color: 'var(--gold)', textDecoration: 'none' }}>
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-card"><div style={{ padding: 32, textAlign: 'center' }}>Loading…</div></div></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
