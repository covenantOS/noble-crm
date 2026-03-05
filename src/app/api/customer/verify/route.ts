import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createHmac } from 'crypto';

const SECRET = process.env.NEXTAUTH_SECRET || 'noble-customer-secret-change-in-production';
const COOKIE_NAME = 'noble_customer_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function signPayload(customerId: string): string {
  const sig = createHmac('sha256', SECRET).update(customerId).digest('hex');
  return `${customerId}.${sig}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone, code } = body as { email?: string; phone?: string; code?: string };

    const identifier = email?.trim() || phone?.trim();
    if (!identifier || !code?.trim()) {
      return NextResponse.json({ error: 'Email/phone and code required' }, { status: 400 });
    }

    const verification = await prisma.customerVerificationCode.findFirst({
      where: {
        sentTo: identifier,
        code: code.trim(),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
    }

    await prisma.customerVerificationCode.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    });

    const token = signPayload(verification.customerId);

    const res = NextResponse.json({ success: true });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });
    return res;
  } catch (e) {
    console.error('Verify code error:', e);
    return NextResponse.json({ error: 'Failed to verify' }, { status: 500 });
  }
}
