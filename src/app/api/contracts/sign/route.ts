import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  getOrCreateStripeCustomer,
  createUpfrontCardCheckout,
  createFinanceCheckout,
  createPaymentPlanCheckout,
} from '@/lib/stripe';

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

    const basePrice = estimate.basePrice ?? 0;
    const upfrontCash = estimate.upfrontCashPrice ?? basePrice;
    const upfrontCard = estimate.upfrontCardPrice ?? basePrice;
    const finance = estimate.financePrice ?? basePrice;
    const planPrice = estimate.paymentPlanPrice ?? basePrice;

    const configs = await prisma.pricingConfig.findMany({
      where: { key: { in: ['deposit_percent', 'midpoint_percent', 'completion_percent'] } },
    });
    const map: Record<string, number> = {};
    configs.forEach((c: { key: string; value: string }) => { map[c.key] = parseFloat(c.value) || 0; });
    const depPct = map.deposit_percent || 50;
    const midPct = map.midpoint_percent || 40;
    const compPct = map.completion_percent || 10;

    let totalAmount = basePrice;
    let depositAmount: number | null = null;
    let midpointAmount: number | null = null;
    let completionAmount: number | null = null;

    switch (paymentTier) {
      case 'UPFRONT_CASH':
        totalAmount = upfrontCash;
        break;
      case 'UPFRONT_CARD':
        totalAmount = upfrontCard;
        break;
      case 'FINANCE':
        totalAmount = finance;
        break;
      case 'PAYMENT_PLAN':
        totalAmount = planPrice;
        depositAmount = Math.round(planPrice * (depPct / 100));
        midpointAmount = Math.round(planPrice * (midPct / 100));
        completionAmount = totalAmount - depositAmount - midpointAmount;
        break;
      default:
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
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'SIGNED' },
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
