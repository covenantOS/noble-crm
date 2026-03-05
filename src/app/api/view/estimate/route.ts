import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * GET /api/view/estimate?estimateId=xxx&token=yyy
 * Public: returns estimate + customer + property + lineItems + payment schedule if token matches viewToken.
 */
export async function GET(request: NextRequest) {
  const estimateId = request.nextUrl.searchParams.get('estimateId');
  const token = request.nextUrl.searchParams.get('token');
  if (!estimateId || !token) {
    return NextResponse.json({ error: 'Missing estimateId or token' }, { status: 400 });
  }

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, viewToken: token },
    include: {
      customer: true,
      property: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      photos: { where: { showToCustomer: true }, orderBy: { sortOrder: 'asc' } },
      measurements: true,
    },
  });

  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found or invalid link' }, { status: 404 });
  }

  const paymentPlanPrice = estimate.paymentPlanPrice ?? estimate.basePrice ?? 0;
  const configs = await prisma.pricingConfig.findMany({
    where: { key: { in: ['deposit_percent', 'midpoint_percent', 'completion_percent'] } },
  });
  const map: Record<string, number> = {};
  configs.forEach((c) => { map[c.key] = parseFloat(c.value) || 0; });
  const depPct = map.deposit_percent || 50;
  const midPct = map.midpoint_percent || 40;
  const compPct = map.completion_percent || 10;
  const depositAmount = Math.round(paymentPlanPrice * (depPct / 100));
  const midpointAmount = Math.round(paymentPlanPrice * (midPct / 100));
  const completionAmount = paymentPlanPrice - depositAmount - midpointAmount;

  const companyRows = await prisma.companySettings.findMany({
    where: { key: { in: ['companyName', 'companyAddress', 'companyPhone', 'companyEmail'] } },
  });
  const company: Record<string, string> = {};
  companyRows.forEach((r) => { company[r.key] = r.value; });

  await prisma.estimate.update({
    where: { id: estimateId },
    data: {
      status: estimate.status === 'SENT' ? 'VIEWED' : undefined,
      viewedAt: estimate.status === 'SENT' ? new Date() : undefined,
    },
  }).catch(() => {});

  return NextResponse.json({
    ...estimate,
    paymentSchedule: { depositAmount, midpointAmount, completionAmount, total: paymentPlanPrice },
    company,
  });
}
