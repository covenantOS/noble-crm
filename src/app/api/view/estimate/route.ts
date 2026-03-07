import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getPaymentPlanScheduleFromTotal } from '@/lib/pricing';

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
  const configRows = await prisma.pricingConfig.findMany();
  const pricingConfig = configRows.reduce<Record<string, string>>(
    (acc: Record<string, string>, r: { key: string; value: string }) => {
      acc[r.key] = r.value;
      return acc;
    },
    {}
  );
  const paymentSchedule = getPaymentPlanScheduleFromTotal(paymentPlanPrice, pricingConfig);

  const companyRows = await prisma.companySettings.findMany({
    where: { key: { in: ['company_name', 'company_address', 'company_phone', 'company_email', 'companyName', 'companyAddress', 'companyPhone', 'companyEmail'] } },
  });
  const company: Record<string, string> = {};
  const keyMap: Record<string, string> = { company_name: 'companyName', company_address: 'companyAddress', company_phone: 'companyPhone', company_email: 'companyEmail' };
  companyRows.forEach((r: { key: string; value: string }) => {
    const camel = keyMap[r.key] || r.key;
    company[camel] = r.value;
  });

  await prisma.estimate.update({
    where: { id: estimateId },
    data: {
      status: estimate.status === 'SENT' ? 'VIEWED' : undefined,
      viewedAt: estimate.status === 'SENT' ? new Date() : undefined,
    },
  }).catch(() => {});

  return NextResponse.json({
    ...estimate,
    paymentSchedule: {
      depositAmount: paymentSchedule.depositAmount,
      midpointAmount: paymentSchedule.midpointAmount,
      completionAmount: paymentSchedule.completionAmount,
      total: paymentSchedule.totalAmount,
    },
    company,
  });
}
