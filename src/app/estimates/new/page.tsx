'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect, useRef } from 'react';

const SCOPE_OPTIONS = [
  { value: 'EXTERIOR', label: 'Exterior' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'BOTH', label: 'Both' },
];

const EXTERIOR_SURFACES = [
  'EXTERIOR_WALL',
  'TRIM',
  'FASCIA',
  'SOFFIT',
  'DOOR',
  'GARAGE_DOOR',
  'SHUTTERS',
  'FENCE',
  'DECK',
];
const INTERIOR_SURFACES = ['INTERIOR_WALL', 'CEILING', 'TRIM', 'DOOR', 'CABINET', 'ACCENT_WALL'];

const CONSTRUCTION_TYPES = ['STUCCO', 'WOOD', 'HARDIE_BOARD', 'BRICK', 'VINYL', 'ALUMINUM', 'MIXED'];
const SOURCE_OPTIONS = ['GBP', 'REFERRAL', 'ANGI', 'DOOR_HANGER', 'WEBSITE', 'OTHER'];
const CONDITION_OPTIONS = ['GOOD', 'FAIR', 'POOR'];

type SurfaceEntry = { surfaceType: string; description?: string; condition: string; notes?: string; included: boolean };
type MeasurementEntry = {
  surface: string;
  description?: string;
  linearFeet?: number;
  height?: number;
  grossArea?: number;
  windowDeduction?: number;
  doorDeduction?: number;
  netPaintableArea?: number;
  coatsRequired: number;
  notes?: string;
};

const STEPS = ['Customer & Property', 'Scope', 'Measurements', 'Photos & Notes'];

export default function NewEstimatePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState({
    id: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    source: 'OTHER',
  });
  const [property, setProperty] = useState({
    address: '',
    city: 'Tampa',
    state: 'FL',
    zip: '',
    squareFootageInterior: '',
    squareFootageExterior: '',
    stories: '1',
    constructionType: 'STUCCO',
    yearBuilt: '',
    notes: '',
  });
  const [scopeType, setScopeType] = useState<'EXTERIOR' | 'INTERIOR' | 'BOTH'>('EXTERIOR');
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementEntry[]>([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Array<{ base64: string; mediaType: string; location?: string; notes?: string }>>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Array<{ id: string; firstName: string; lastName: string; email: string | null; phone: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addressInputRef = useRef<HTMLInputElement>(null);

  const surfaceTypes = scopeType === 'BOTH' ? [...new Set([...EXTERIOR_SURFACES, ...INTERIOR_SURFACES])] : scopeType === 'EXTERIOR' ? EXTERIOR_SURFACES : INTERIOR_SURFACES;

  const ensureSurfaces = useCallback(() => {
    setSurfaces((prev) => {
      const byType = new Map(prev.map((s) => [s.surfaceType, s]));
      surfaceTypes.forEach((st) => {
        if (!byType.has(st)) byType.set(st, { surfaceType: st, condition: 'GOOD', included: true });
      });
      return Array.from(byType.values()).filter((s) => surfaceTypes.includes(s.surfaceType));
    });
  }, [surfaceTypes.join(',')]);

  const ensureMeasurements = useCallback(() => {
    setMeasurements((prev) => {
      const bySurface = new Map(prev.map((m) => [m.surface, m]));
      surfaceTypes.forEach((st) => {
        if (!bySurface.has(st)) bySurface.set(st, { surface: st, coatsRequired: 2 });
      });
      return Array.from(bySurface.values()).filter((m) => surfaceTypes.includes(m.surface));
    });
  }, [surfaceTypes.join(',')]);

  useEffect(() => {
    if (step >= 2) {
      ensureSurfaces();
      ensureMeasurements();
    }
  }, [step, scopeType, ensureSurfaces, ensureMeasurements]);

  // Optional Google Places address autocomplete (when NEXT_PUBLIC_GOOGLE_PLACES_API_KEY is set)
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!key || !addressInputRef.current) return;
    let cancelled = false;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onload = () => {
      if (cancelled || !addressInputRef.current || typeof (window as unknown as { google?: { maps?: { places?: { Autocomplete?: unknown } } } }).google?.maps?.places?.Autocomplete !== 'function') return;
      const Autocomplete = (window as unknown as { google: { maps: { places: { Autocomplete: new (el: HTMLInputElement, opts: { types?: string[] }) => { addListener: (ev: string, fn: () => void) => void; getPlace: () => { address_components?: Array<{ long_name: string; short_name: string; types: string[] }>; formatted_address?: string } } } } } }).google.maps.places.Autocomplete;
      const autocomplete = new Autocomplete(addressInputRef.current, { types: ['address'] });
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        const addr = place.formatted_address || '';
        let city = '';
        let state = '';
        let zip = '';
        for (const c of place.address_components || []) {
          if (c.types.includes('locality')) city = c.long_name;
          if (c.types.includes('administrative_area_level_1')) state = c.short_name;
          if (c.types.includes('postal_code')) zip = c.long_name;
        }
        setProperty((p) => ({ ...p, address: addr, ...(city && { city }), ...(state && { state }), ...(zip && { zip }) }));
      });
    };
    document.head.appendChild(script);
    return () => { cancelled = true; script.remove(); };
  }, [step]);

  const searchCustomers = () => {
    if (!customerSearch.trim()) return;
    fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}&limit=10`)
      .then((r) => r.json())
      .then(setCustomerResults)
      .catch(console.error);
  };

  const selectCustomer = (c: { id: string; firstName: string; lastName: string; email: string | null; phone: string }) => {
    setCustomer({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email || '',
      phone: c.phone,
      source: customer.source,
    });
    setCustomerResults([]);
    setCustomerSearch('');
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const next: typeof photos = [];
    const add = (i: number) => {
      if (i >= files.length) {
        setPhotos((p) => [...p, ...next]);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const base64 = data.split(',')[1] || '';
        const mediaType = files[i].type || 'image/jpeg';
        next.push({ base64, mediaType });
        add(i + 1);
      };
      reader.readAsDataURL(files[i]);
    };
    add(0);
  };

  const buildPayload = () => ({
    customer: customer.id ? { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email || null, phone: customer.phone, source: customer.source } : { firstName: customer.firstName, lastName: customer.lastName, email: customer.email || null, phone: customer.phone, source: customer.source },
    property: {
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zip,
      squareFootageInterior: property.squareFootageInterior ? parseInt(property.squareFootageInterior, 10) : undefined,
      squareFootageExterior: property.squareFootageExterior ? parseInt(property.squareFootageExterior, 10) : undefined,
      stories: property.stories ? parseInt(property.stories, 10) : 1,
      constructionType: property.constructionType,
      yearBuilt: property.yearBuilt ? parseInt(property.yearBuilt, 10) : undefined,
      notes: property.notes || undefined,
    },
    scopeType,
    surfaces: surfaces.filter((s) => s.included).map((s) => ({ surfaceType: s.surfaceType, description: s.description, condition: s.condition, notes: s.notes })),
    measurements: measurements.filter((m) => m.surface).map((m) => ({
      surface: m.surface,
      description: m.description,
      linearFeet: m.linearFeet,
      height: m.height,
      grossArea: m.grossArea,
      windowDeduction: m.windowDeduction ?? 0,
      doorDeduction: m.doorDeduction ?? 0,
      netPaintableArea: m.netPaintableArea,
      coatsRequired: m.coatsRequired ?? 2,
      notes: m.notes,
    })),
    notes,
  });

  const handleGenerate = async () => {
    setError('');
    setSaving(true);
    try {
      const createRes = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create estimate');
      }
      const estimate = await createRes.json();

      const analyzeRes = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimateId: estimate.id, photos }),
      });
      if (!analyzeRes.ok) {
        const data = await analyzeRes.json().catch(() => ({}));
        throw new Error(data.error || 'AI analysis failed');
      }
      router.push(`/estimates/${estimate.id}?review=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const canProceedStep1 = customer.firstName && customer.lastName && customer.phone && property.address && property.zip;
  const canProceedStep2 = true;
  const canProceedStep3 = true;

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <Link href="/estimates" style={{ fontSize: 14, color: 'var(--gray-500)', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
            ← Back to estimates
          </Link>
          <h1>New Estimate</h1>
          <p>Step {step} of 4: {STEPS[step - 1]}</p>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 720 }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i + 1)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: step === i + 1 ? '2px solid var(--gold)' : '1px solid var(--gray-200)',
                background: step === i + 1 ? 'rgba(201,168,76,0.1)' : 'var(--white)',
                fontSize: 13,
                fontWeight: step === i + 1 ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="login-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="card">
            <div className="card-header"><h2>Customer & Property</h2></div>
            <div className="card-body">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Search existing customer</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Name, email, or phone"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onBlur={searchCustomers}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}
                  />
                  <button type="button" className="btn btn-outline" onClick={searchCustomers}>Search</button>
                </div>
                {customerResults.length > 0 && (
                  <ul style={{ marginTop: 8, padding: 0, listStyle: 'none', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', maxHeight: 200, overflow: 'auto' }}>
                    {customerResults.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => selectCustomer(c)} style={{ width: '100%', padding: '10px 12px', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>
                          {c.firstName} {c.lastName} — {c.phone}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>First name *</label>
                  <input value={customer.firstName} onChange={(e) => setCustomer((c) => ({ ...c, firstName: e.target.value }))} required style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Last name *</label>
                  <input value={customer.lastName} onChange={(e) => setCustomer((c) => ({ ...c, lastName: e.target.value }))} required style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Phone *</label>
                  <input type="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} required style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Email</label>
                  <input type="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>How they heard about us</label>
                <select value={customer.source} onChange={(e) => setCustomer((c) => ({ ...c, source: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}>
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--gray-200)', margin: '24px 0' }} />
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Property address *</label>
                <input
                  ref={addressInputRef}
                  value={property.address}
                  onChange={(e) => setProperty((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Street address (start typing for suggestions if enabled)"
                  required
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: 12, marginBottom: 16 }}>
                <input value={property.city} onChange={(e) => setProperty((p) => ({ ...p, city: e.target.value }))} placeholder="City" style={{ padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                <input value={property.state} onChange={(e) => setProperty((p) => ({ ...p, state: e.target.value }))} placeholder="State" style={{ padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                <input value={property.zip} onChange={(e) => setProperty((p) => ({ ...p, zip: e.target.value }))} placeholder="ZIP" required style={{ padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Interior sq ft</label>
                  <input type="number" value={property.squareFootageInterior} onChange={(e) => setProperty((p) => ({ ...p, squareFootageInterior: e.target.value }))} min={0} placeholder="Quick total" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Exterior sq ft</label>
                  <input type="number" value={property.squareFootageExterior} onChange={(e) => setProperty((p) => ({ ...p, squareFootageExterior: e.target.value }))} min={0} placeholder="Quick total" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Stories</label>
                  <input type="number" value={property.stories} onChange={(e) => setProperty((p) => ({ ...p, stories: e.target.value }))} min={1} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Year built</label>
                  <input type="number" value={property.yearBuilt} onChange={(e) => setProperty((p) => ({ ...p, yearBuilt: e.target.value }))} min={1800} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Construction type</label>
                <select value={property.constructionType} onChange={(e) => setProperty((p) => ({ ...p, constructionType: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}>
                  {CONSTRUCTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Property notes</label>
                <textarea value={property.notes} onChange={(e) => setProperty((p) => ({ ...p, notes: e.target.value }))} rows={2} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card">
            <div className="card-header"><h2>Scope</h2></div>
            <div className="card-body">
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Scope type</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {SCOPE_OPTIONS.map((o) => (
                    <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name="scopeType" value={o.value} checked={scopeType === o.value} onChange={() => { setScopeType(o.value as 'EXTERIOR' | 'INTERIOR' | 'BOTH'); ensureSurfaces(); ensureMeasurements(); }} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Surfaces (check included, set condition)</label>
                {surfaceTypes.map((st) => {
                  const entry = surfaces.find((s) => s.surfaceType === st) || { surfaceType: st, condition: 'GOOD', included: true };
                  const idx = surfaces.findIndex((s) => s.surfaceType === st);
                  const update = (patch: Partial<SurfaceEntry>) => {
                    if (idx >= 0) setSurfaces((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
                    else setSurfaces((prev) => [...prev, { ...entry, ...patch }]);
                  };
                  return (
                    <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                      <input type="checkbox" checked={entry.included} onChange={(e) => update({ included: e.target.checked })} />
                      <span style={{ minWidth: 140 }}>{st.replace(/_/g, ' ')}</span>
                      <select value={entry.condition} onChange={(e) => update({ condition: e.target.value })} style={{ padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}>
                        {CONDITION_OPTIONS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input type="text" placeholder="Description (optional)" value={entry.description || ''} onChange={(e) => update({ description: e.target.value })} style={{ flex: 1, minWidth: 120, padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <div className="card-header"><h2>Measurements</h2></div>
            <div className="card-body">
              <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16 }}>Enter measurements for each surface. You can use quick total sq ft for exterior or interior.</p>
              {surfaceTypes.map((st) => {
                const m = measurements.find((x) => x.surface === st) || { surface: st, coatsRequired: 2 };
                const idx = measurements.findIndex((x) => x.surface === st);
                const update = (patch: Partial<MeasurementEntry>) => {
                  if (idx >= 0) setMeasurements((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                  else setMeasurements((prev) => [...prev, { ...m, ...patch }]);
                };
                return (
                  <div key={st} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 100px 100px 100px 80px', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{st.replace(/_/g, ' ')}</span>
                    <input type="text" placeholder="Description" value={m.description || ''} onChange={(e) => update({ description: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    <input type="number" placeholder="Lin ft" value={m.linearFeet ?? ''} onChange={(e) => update({ linearFeet: e.target.value ? parseFloat(e.target.value) : undefined })} min={0} step={0.1} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    <input type="number" placeholder="Height" value={m.height ?? ''} onChange={(e) => update({ height: e.target.value ? parseFloat(e.target.value) : undefined })} min={0} step={0.1} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    <input type="number" placeholder="Net sq ft" value={m.netPaintableArea ?? ''} onChange={(e) => update({ netPaintableArea: e.target.value ? parseFloat(e.target.value) : undefined })} min={0} step={1} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    <input type="number" placeholder="Windows" value={m.windowDeduction ?? ''} onChange={(e) => update({ windowDeduction: e.target.value ? parseFloat(e.target.value) : 0 })} min={0} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                    <input type="number" placeholder="Coats" value={m.coatsRequired ?? 2} onChange={(e) => update({ coatsRequired: parseInt(e.target.value, 10) || 2 })} min={1} style={{ padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="card">
            <div className="card-header"><h2>Photos & Notes</h2></div>
            <div className="card-body">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Photos (optional)</label>
                <input type="file" accept="image/*" multiple onChange={handlePhotoChange} style={{ fontSize: 14 }} />
                {photos.length > 0 && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--gray-500)' }}>{photos.length} photo(s) added. They will be sent to AI for analysis.</p>}
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 }}>Notes for AI</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="e.g. homeowner wants to keep current trim color, large oak tree on south side..." style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }} />
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button type="button" className="btn btn-outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            Previous
          </button>
          {step < 4 ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => Math.min(4, s + 1))} disabled={(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2) || (step === 3 && !canProceedStep3)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={saving}>
              {saving ? 'Creating & analyzing…' : 'Generate Estimate'}
            </button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}