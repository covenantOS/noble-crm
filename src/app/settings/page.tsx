'use client';

import AppLayout from '@/components/layout/AppLayout';
import { useEffect, useState } from 'react';

type PricingItem = { id: string; key: string; value: string; category: string; label: string; description: string | null };
type TemplateItem = { id: string; key: string; name: string; channel: string; subject: string | null; content: string };

const CATEGORY_ORDER = ['MATERIAL', 'LABOR', 'MARKUP', 'PAYMENT', 'COVERAGE', 'OTHER'];
const COMPANY_KEYS = [
  'company_name',
  'company_legal_name',
  'company_address',
  'company_phone',
  'company_email',
  'estimates_email',
  'company_website',
  'google_review_link',
  'credentials',
];

const POLICY_KEYS: { key: string; label: string }[] = [
  { key: 'policy_subcontractor', label: 'Sub-Contractor Payment Policy' },
  { key: 'policy_material', label: 'Material Procurement Policy' },
  { key: 'policy_quality', label: 'Quality Control Policy' },
  { key: 'policy_review', label: 'Review Collection Policy' },
];

export default function SettingsPage() {
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [company, setCompany] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setPricing(data.pricing || []);
        setCompany(data.company || {});
        setTemplates(data.templates || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const savePricing = async () => {
    setSavingSection('pricing');
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'pricing',
          data: pricing.map((p) => ({ key: p.key, value: p.value })),
        }),
      });
    } finally {
      setSavingSection(null);
    }
  };

  const saveCompany = async () => {
    setSavingSection('company');
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'company', data: company }),
      });
    } finally {
      setSavingSection(null);
    }
  };

  const saveTemplates = async () => {
    setSavingSection('templates');
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'templates',
          data: templates.map((t) => ({ key: t.key, subject: t.subject, content: t.content })),
        }),
      });
    } finally {
      setSavingSection(null);
    }
  };

  const pricingByCategory = CATEGORY_ORDER.reduce<Record<string, PricingItem[]>>((acc, cat) => {
    acc[cat] = pricing.filter((p) => p.category === cat);
    return acc;
  }, {});

  if (loading) {
    return (
      <AppLayout>
        <div className="page-header">
          <h1>Settings</h1>
          <p>Loading…</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Pricing, company info, and message templates.</p>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 900 }}>
        {/* Pricing Configuration */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Pricing Configuration</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={savePricing}
              disabled={savingSection === 'pricing'}
            >
              {savingSection === 'pricing' ? 'Saving…' : 'Save pricing'}
            </button>
          </div>
          <div className="card-body">
            {CATEGORY_ORDER.map((cat) => {
              const items = pricingByCategory[cat] || [];
              if (items.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)', marginBottom: 12, textTransform: 'capitalize' }}>
                    {cat.toLowerCase()}
                  </h3>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {items.map((p) => (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>{p.label}</div>
                          {p.description && (
                            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{p.description}</div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={p.value}
                          onChange={(e) =>
                            setPricing((prev) => prev.map((x) => (x.id === p.id ? { ...x, value: e.target.value } : x)))
                          }
                          style={{
                            padding: '8px 12px',
                            border: '1px solid var(--gray-200)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 14,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Company Info */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Company Info</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveCompany}
              disabled={savingSection === 'company'}
            >
              {savingSection === 'company' ? 'Saving…' : 'Save company'}
            </button>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {COMPANY_KEYS.map((key) => (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
                    {key.replace(/_/g, ' ')}
                  </label>
                  <input
                    type="text"
                    value={company[key] ?? ''}
                    onChange={(e) => setCompany((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--gray-200)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 14,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Internal policies (admin reference) */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Internal Operations Policies</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveCompany}
              disabled={savingSection === 'company'}
            >
              {savingSection === 'company' ? 'Saving…' : 'Save policies'}
            </button>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
              Reference policies for the team. Stored in company settings.
            </p>
            {POLICY_KEYS.map(({ key: pk, label }) => (
              <div key={pk} style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>
                  {label}
                </label>
                <textarea
                  value={company[pk] ?? ''}
                  onChange={(e) => setCompany((prev) => ({ ...prev, [pk]: e.target.value }))}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--gray-200)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Integrations (read-only hint) */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Integrations</h2>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 14, color: 'var(--gray-600)', margin: 0 }}>
              API keys and webhooks are configured via environment variables (e.g. STRIPE_SECRET_KEY, RESEND_API_KEY,
              BLOO_API_KEY, ANTHROPIC_API_KEY, NEXTAUTH_SECRET). Set these in your deployment environment.
            </p>
          </div>
        </div>

        {/* Message Templates */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Message Templates</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveTemplates}
              disabled={savingSection === 'templates'}
            >
              {savingSection === 'templates' ? 'Saving…' : 'Save templates'}
            </button>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {templates.map((t) => (
                <div key={t.id} style={{ borderBottom: '1px solid var(--gray-100)', paddingBottom: 20 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                    {t.name} ({t.channel})
                  </div>
                  {t.channel === 'EMAIL' && (
                    <input
                      type="text"
                      placeholder="Subject"
                      value={t.subject ?? ''}
                      onChange={(e) =>
                        setTemplates((prev) =>
                          prev.map((x) => (x.id === t.id ? { ...x, subject: e.target.value } : x))
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid var(--gray-200)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 14,
                        marginBottom: 8,
                      }}
                    />
                  )}
                  <textarea
                    value={t.content}
                    onChange={(e) =>
                      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, content: e.target.value } : x)))
                    }
                    rows={4}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--gray-200)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 14,
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
                    Variables: {'{{customerFirstName}}'}, {'{{propertyAddress}}'}, {'{{estimateTotal}}'}, {'{{estimateLink}}'}, etc.
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
