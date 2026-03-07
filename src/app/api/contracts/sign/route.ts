import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  getOrCreateStripeCustomer,
  createUpfrontCardCheckout,
  createFinanceCheckout,
  createPaymentPlanCheckout,
} from '@/lib/stripe';
import { getPaymentPlanScheduleFromTotal, getAmountForTier } from '@/lib/pricing';

const BASE_URL = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { estimateId, token, paymentTier, signerName, signatureData } = body as {
      estimateId?: string;
      token?: string;
      paymentTier?: string;
      signerName?: string;
      signatureData?: string;
    };

    if (!estimateId || !token || !paymentTier || !signerName || !signatureData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, viewToken: token },
      include: { customer: true, property: true },
    });

    if (!estimate) {
      return NextResponse.json({ error: 'Invalid estimate or token' }, { status: 404 });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;

    // Single source of truth: tier amounts from estimate + pricing engine schedule (50/40/10)
    const configRows = await prisma.pricingConfig.findMany();
    const pricingConfig = configRows.reduce<Record<string, string>>(
      (acc: Record<string, string>, r: { key: string; value: string }) => {
        acc[r.key] = r.value;
        return acc;
      },
      {}
    );
    const planPrice = estimate.paymentPlanPrice ?? estimate.basePrice ?? 0;
    const schedule = getPaymentPlanScheduleFromTotal(planPrice, pricingConfig);
    const amounts = getAmountForTier(
      paymentTier as 'UPFRONT_CASH' | 'UPFRONT_CARD' | 'FINANCE' | 'PAYMENT_PLAN',
      estimate,
      paymentTier === 'PAYMENT_PLAN' ? schedule : undefined
    );

    const totalAmount = amounts.totalAmount;
    const depositAmount = amounts.depositAmount ?? null;
    const midpointAmount = amounts.midpointAmount ?? null;
    const completionAmount = amounts.completionAmount ?? null;

    if (
      paymentTier !== 'UPFRONT_CASH' &&
      paymentTier !== 'UPFRONT_CARD' &&
      paymentTier !== 'FINANCE' &&
      paymentTier !== 'PAYMENT_PLAN'
    ) {
      return NextResponse.json({ error: 'Invalid payment tier' }, { status: 400 });
    }

    const contractSnapshot = {
      estimateId,
      scopeOfWork: estimate.scopeOfWork,
      timeline: estimate.timeline,
      paymentTier,
      totalAmount,
      depositAmount,
      midpointAmount,
      completionAmount,
      signerName,
      signedAt: new Date().toISOString(),
      signerIp: ip,
    };

    const contract = await prisma.contract.create({
      data: {
        estimateId,
        customerId: estimate.customerId,
        status: 'GENERATED',
        paymentTier: paymentTier as 'UPFRONT_CASH' | 'UPFRONT_CARD' | 'FINANCE' | 'PAYMENT_PLAN',
        totalAmount,
        depositAmount,
        midpointAmount,
        completionAmount,
        termsAccepted: true,
        autoChargeAuthorized: paymentTier === 'PAYMENT_PLAN',
        signatureData,
        signerName,
        signerIpAddress: ip ?? undefined,
        signedAt: new Date(),
        contractSnapshot: JSON.parse(JSON.stringify(contractSnapshot)),
      },
    });

    if (paymentTier === 'UPFRONT_CASH') {
      const viewToken = (await prisma.estimate.findUnique({ where: { id: estimateId }, select: { viewToken: true } }))?.viewToken;
      const docUrl = viewToken
        ? `${BASE_URL}/api/contracts/${contract.id}/pdf?token=${viewToken}`
        : null;
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'SIGNED', ...(docUrl && { documentUrl: docUrl }) },
      });
      await prisma.estimate.update({
        where: { id: estimateId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      return NextResponse.json({ success: true, contractId: contract.id });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
    }

    const stripeCustomerId = await getOrCreateStripeCustomer(
      estimate.customer.email || `customer-${estimate.customerId}@placeholder.local`,
      `${estimate.customer.firstName} ${estimate.customer.lastName}`,
      estimate.customer.phone
    );

    await prisma.contract.update({
      where: { id: contract.id },
      data: { stripeCustomerId },
    });

    const propertyAddress = `${estimate.property.address}, ${estimate.property.city}`;
    const successUrl = `${BASE_URL}/view/${estimateId}/${token}/success?contractId=${contract.id}`;
    const cancelUrl = `${BASE_URL}/view/${estimateId}/${token}/contract?tier=${paymentTier}`;

    let session;
    if (paymentTier === 'UPFRONT_CARD') {
      session = await createUpfrontCardCheckout(
        stripeCustomerId,
        totalAmount,
        contract.id,
        propertyAddress,
        successUrl,
        cancelUrl
      );
    } else if (paymentTier === 'FINANCE') {
      session = await createFinanceCheckout(
        stripeCustomerId,
        totalAmount,
        contract.id,
        propertyAddress,
        successUrl,
        cancelUrl
      );
    } else if (paymentTier === 'PAYMENT_PLAN' && depositAmount != null) {
      session = await createPaymentPlanCheckout(
        stripeCustomerId,
        depositAmount,
        contract.id,
        propertyAddress,
        successUrl,
        cancelUrl
      );
    } else {
      return NextResponse.json({ error: 'Invalid tier for checkout' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      contractId: contract.id,
      checkoutUrl: session.url,
    });
  } catch (e) {
    console.error('Contract sign error:', e);
    return NextResponse.json({ error: 'Failed to process contract' }, { status: 500 });
  }
}
