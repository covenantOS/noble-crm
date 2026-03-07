// One-time bootstrap: create default admin if no users exist.
// Call with POST and body { "secret": "<NEXTAUTH_SECRET or BOOTSTRAP_SECRET>" }.
// To reset admin password: POST with { "secret": "...", "resetPassword": true } or { "resetPassword": "newpassword" }.
// After this, log in at /login with will@servicelinepro.com / password

import { NextRequest, NextResponse } from 'next/server';
import { scryptSync } from 'crypto';
import prisma from '@/lib/prisma';

const AUTH_SALT = process.env.AUTH_PASSWORD_SALT || 'noble-estimator-default-salt-change-in-production';

function hashPassword(password: string): string {
  return scryptSync(password, AUTH_SALT, 64).toString('hex');
}

export async function GET() {
  const userCount = await prisma.user.count();
  return NextResponse.json({
    hasAdmin: userCount > 0,
    hint: 'To create or reset admin: POST to /api/bootstrap with body { "secret": "your NEXTAUTH_SECRET" }. Optional: "resetPassword": true to set password to "password", or "resetPassword": "yournewpass" to set a new one.',
    loginEmail: 'will@servicelinepro.com',
    defaultPassword: 'password',
    loginUrl: '/login',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { secret?: string; resetPassword?: boolean | string };
    const secret = String(body.secret ?? request.headers.get('x-bootstrap-secret') ?? '').trim();
    const expected = (process.env.BOOTSTRAP_SECRET || process.env.NEXTAUTH_SECRET || '').trim();
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resetPassword = body.resetPassword;
    const newPassword =
      resetPassword === true ? 'password' : typeof resetPassword === 'string' && resetPassword.length > 0 ? resetPassword : null;

    if (newPassword) {
      const admin = await prisma.user.findFirst({ where: { email: 'will@servicelinepro.com' } });
      if (!admin) {
        return NextResponse.json({ error: 'No admin user found. Run bootstrap without resetPassword first to create one.' }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: admin.id },
        data: { passwordHash: hashPassword(newPassword) },
      });
      return NextResponse.json({
        ok: true,
        message: 'Admin password reset. You can log in now.',
        email: 'will@servicelinepro.com',
        password: newPassword,
        loginUrl: '/login',
      });
    }

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({
        ok: true,
        message: 'Admin user already exists. Use existing credentials to log in. To reset password, send { "secret": "...", "resetPassword": true }.',
        login: 'will@servicelinepro.com',
      });
    }

    const defaultPasswordHash = hashPassword('password');
    await prisma.user.create({
      data: {
        name: 'Will Noble',
        email: 'will@servicelinepro.com',
        phone: '(813) 555-0123',
        role: 'OWNER',
        passwordHash: defaultPasswordHash,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Default admin created. You can log in now.',
      email: 'will@servicelinepro.com',
      password: 'password',
      loginUrl: '/login',
    });
  } catch (e) {
    console.error('Bootstrap error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap failed' },
      { status: 500 }
    );
  }
}
