'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function EstimateEditPage() {
  const params = useParams();
  const id = params?.id as string;
  const [scopeOfWork, setScopeOfWork] = useState('');
  const [timeline, setTimeline] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/estimates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setScopeOfWork(data.scopeOfWork ?? '');
        setTimeline(data.timeline ?? '');
        setStatus(data.status ?? 'DRAFT');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/estimates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeOfWork, timeline, status }),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="page-header"><h1>Edit Estimate</h1><p>Loading…</p></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <Link href={`/estimates/${id}`} style={{ fontSize: 14, color: 'var(--gray-500)', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
            ← Back to estimate
          </Link>
          <h1>Edit Estimate</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="page-body" style={{ maxWidth: 720 }}>
        <div className="card">
          <div className="card-body">
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}>
                <option value="DRAFT">Draft</option>
                <option value="REVIEW">Review</option>
                <option value="SENT">Sent</option>
                <option value="VIEWED">Viewed</option>
                <option value="APPROVED">Approved</option>
                <option value="DECLINED">Declined</option>
                <option value="EXPIRED">Expired</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Scope of work</label>
              <textarea value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} rows={6} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Timeline</label>
              <input type="text" value={timeline} onChange={(e) => setTimeline(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
