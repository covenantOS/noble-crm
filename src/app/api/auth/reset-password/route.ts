// GET /api/auth/reset-password?token=xxx — validate token (for page load)
// POST /api/auth/reset-password — set new password (body: { token, newPassword })
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token required', valid: false }, { status: 400 });
  }
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!record || record.usedAt || new Date() > record.expiresAt) {
    return NextResponse.json({ valid: false, error: 'Invalid or expired link' }, { status: 400 });
  }
  return NextResponse.json({ valid: true, email: record.user.email });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { token?: string; newPassword?: string };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword.trim() : '';
    if (!token || !newPassword) {
      return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!record || record.usedAt || new Date() > record.expiresAt) {
      return NextResponse.json({ error: 'Invalid or expired link. Request a new reset.' }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: hashPassword(newPassword) },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (e) {
    console.error('Reset password error:', e);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
