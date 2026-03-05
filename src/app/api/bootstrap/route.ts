// One-time bootstrap: create default admin if no users exist.
// Call with POST and body { "secret": "<NEXTAUTH_SECRET or BOOTSTRAP_SECRET>" }.
// After this, log in at /login with will@westchasepainting.com / password

import { NextRequest, NextResponse } from 'next/server';
import { scryptSync } from 'crypto';
import prisma from '@/lib/prisma';

const AUTH_SALT = process.env.AUTH_PASSWORD_SALT || 'noble-estimator-default-salt-change-in-production';

function hashPassword(password: string): string {
  return scryptSync(password, AUTH_SALT, 64).toString('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { secret?: string };
    const secret = body.secret ?? request.headers.get('x-bootstrap-secret') ?? '';
    const expected = process.env.BOOTSTRAP_SECRET || process.env.NEXTAUTH_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({
        ok: true,
        message: 'Admin user already exists. Use existing credentials to log in.',
        login: 'will@westchasepainting.com',
      });
    }

    const defaultPasswordHash = hashPassword('password');
    await prisma.user.create({
      data: {
        name: 'Will Noble',
        email: 'will@westchasepainting.com',
        phone: '(813) 555-0123',
        role: 'OWNER',
        passwordHash: defaultPasswordHash,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Default admin created. You can log in now.',
      email: 'will@westchasepainting.com',
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
