'use client';

import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface DashboardStats {
  estimatesThisMonth: number;
  closeRate: number;
  revenueThisMonth: number;
  averageJobSize: number;
}

interface RecentEstimate {
  id: string;
  customerName: string;
  propertyAddress: string;
  status: string;
  basePrice: number | null;
  createdAt: string;
}

// Dashboard stat card icons
const EstimateStatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" />
  </svg>
);

const CloseRateIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
  </svg>
);

const RevenueIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="2" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const AvgJobIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
  </svg>
);

const PlusCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M8 12h8" /><path d="M12 8v8" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
);

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    estimatesThisMonth: 0,
    closeRate: 0,
    revenueThisMonth: 0,
    averageJobSize: 0,
  });
  const [recentEstimates, setRecentEstimates] = useState<RecentEstimate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const response = await fetch('/api/dashboard');
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setRecentEstimates(data.recentEstimates);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

  const getStatusBadgeClass = (status: string) => {
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
    return map[status] || 'badge badge-draft';
  };

  const formatStatus = (status: string) =>
    status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back, Will. Here&apos;s your business at a glance.</p>
        </div>
        <Link href="/estimates/new" className="btn btn-primary btn-lg">
          <PlusCircleIcon />
          New Estimate
        </Link>
      </div>

      <div className="page-body">
        {/* Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          marginBottom: '32px',
        }}>
          <div className="stat-card animate-fade-in stagger-1">
            <div className="stat-card-icon navy">
              <EstimateStatIcon />
            </div>
            <div className="stat-card-value">
              {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : stats.estimatesThisMonth}
            </div>
            <div className="stat-card-label">Estimates This Month</div>
          </div>

          <div className="stat-card animate-fade-in stagger-2">
            <div className="stat-card-icon green">
              <CloseRateIcon />
            </div>
            <div className="stat-card-value">
              {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : `${stats.closeRate}%`}
            </div>
            <div className="stat-card-label">Close Rate</div>
          </div>

          <div className="stat-card animate-fade-in stagger-3">
            <div className="stat-card-icon gold">
              <RevenueIcon />
            </div>
            <div className="stat-card-value">
              {loading ? <div className="skeleton" style={{ width: 80, height: 32 }} /> : formatCurrency(stats.revenueThisMonth)}
            </div>
            <div className="stat-card-label">Revenue This Month</div>
          </div>

          <div className="stat-card animate-fade-in stagger-4">
            <div className="stat-card-icon blue">
              <AvgJobIcon />
            </div>
            <div className="stat-card-value">
              {loading ? <div className="skeleton" style={{ width: 80, height: 32 }} /> : formatCurrency(stats.averageJobSize)}
            </div>
            <div className="stat-card-label">Average Job Size</div>
          </div>
        </div>

        {/* Recent Estimates & Quick Actions */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 380px',
          gap: '24px',
        }}>
          {/* Recent Estimates */}
          <div className="card animate-fade-in" style={{ animationDelay: '200ms' }}>
            <div className="card-header">
              <h2>Recent Estimates</h2>
              <Link href="/estimates" className="btn btn-ghost btn-sm">
                View All <ArrowRightIcon />
              </Link>
            </div>

            {loading ? (
              <div className="card-body">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <div className="skeleton" style={{ width: '100%', height: 20 }} />
                  </div>
                ))}
              </div>
            ) : recentEstimates.length === 0 ? (
              <div className="card-body">
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <EstimateStatIcon />
                  </div>
                  <h3>No estimates yet</h3>
                  <p>Create your first estimate to get started.</p>
                  <Link href="/estimates/new" className="btn btn-primary">
                    <PlusCircleIcon /> Create Estimate
                  </Link>
                </div>
              </div>
            ) : (
              <div style={{ padding: '0' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Property</th>
                      <th>Status</th>
                      <th>Price</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEstimates.map((est) => (
                      <tr key={est.id}>
                        <td className="cell-primary">
                          <Link href={`/estimates/${est.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {est.customerName}
                          </Link>
                        </td>
                        <td>{est.propertyAddress}</td>
                        <td>
                          <span className={getStatusBadgeClass(est.status)}>
                            {formatStatus(est.status)}
                          </span>
                        </td>
                        <td className="cell-primary">
                          {est.basePrice ? formatCurrency(est.basePrice) : '—'}
                        </td>
                        <td className="cell-muted">
                          {formatTimeAgo(est.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Actions & Activity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="card animate-fade-in" style={{ animationDelay: '300ms' }}>
              <div className="card-header">
                <h2>Quick Actions</h2>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Link href="/estimates/new" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  <PlusCircleIcon /> New Estimate
                </Link>
                <Link href="/estimates" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }}>
                  View All Estimates
                </Link>
                <Link href="/customers" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }}>
                  View Customers
                </Link>
                <Link href="/settings" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                  Settings
                </Link>
              </div>
            </div>

            {/* Company Credentials Card */}
            <div className="card animate-fade-in" style={{ animationDelay: '400ms' }}>
              <div className="card-body" style={{ background: 'var(--navy)', borderRadius: 'var(--radius-lg)', color: 'white' }}>
                <div style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Credentials
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    'Bonded & Insured',
                    'EPA Lead-Safe Certified',
                    'OSHA Safety Trained',
                    'PCA Member',
                    'SW PRO+ Partner',
                  ].map((cred) => (
                    <div key={cred} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {cred}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
