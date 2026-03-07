'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>Westchase Painting Co.</h1>
            <p>By Noble</p>
            <h2>Check your email</h2>
          </div>
          <p style={{ padding: '0 32px 24px', color: 'var(--gray-600)', lineHeight: 1.5 }}>
            If an account exists for <strong>{email}</strong>, we sent a password reset link. It expires in 1 hour.
            You may also receive it via text if we have your number on file.
          </p>
          <div style={{ padding: '0 32px 32px' }}>
            <Link href="/login" className="btn btn-primary btn-lg" style={{ display: 'inline-block', textAlign: 'center' }}>
              Back to sign in
            </Link>
          </div>
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
          <h2>Forgot password</h2>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="will@servicelinepro.com"
          />
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
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
