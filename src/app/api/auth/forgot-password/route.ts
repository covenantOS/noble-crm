// POST /api/auth/forgot-password — request password reset (sends email + iMessage via Resend/Bloo)
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { sendEmail, buildPasswordResetEmail } from '@/lib/resend';
import { sendMessage as sendBloo, normalizePhone } from '@/lib/bloo';

const TOKEN_EXPIRY_HOURS = 1;
const BASE_URL = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { email?: string };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether the email exists
      return NextResponse.json({ ok: true, message: 'If that email is on file, we sent a reset link.' });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    const resetLink = `${BASE_URL}/reset-password?token=${token}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password — Noble Estimator',
        html: buildPasswordResetEmail(user.name.split(/\s+/)[0] || 'there', resetLink),
      });
    } catch (e) {
      console.error('Forgot password email failed:', e);
      return NextResponse.json({ error: 'Failed to send email. Try again later.' }, { status: 500 });
    }

    if (user.phone) {
      try {
        await sendBloo(
          normalizePhone(user.phone),
          `Noble Estimator: Reset your password here (expires in 1 hour): ${resetLink}`
        );
      } catch {
        // Non-fatal; email was sent
      }
    }

    return NextResponse.json({ ok: true, message: 'If that email is on file, we sent a reset link.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
