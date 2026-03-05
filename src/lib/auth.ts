// ============================================
// NOBLE ESTIMATOR — AUTH (NextAuth.js)
// ============================================
// Credentials provider + Prisma. Architect for multi-user roles later.

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { scryptSync, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';

// Trim so Vercel env (often stored with trailing newline) doesn't break JWT signing
export function getNextAuthSecret(): string | undefined {
  const s = process.env.NEXTAUTH_SECRET;
  return s ? String(s).trim() || undefined : undefined;
}

const SALT = process.env.AUTH_PASSWORD_SALT || 'noble-estimator-default-salt-change-in-production';

function hashPassword(password: string): string {
  return scryptSync(password, SALT, 64).toString('hex');
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const h = scryptSync(password, SALT, 64);
  const stored = Buffer.from(storedHash, 'hex');
  return h.length === stored.length && timingSafeEqual(h, stored);
}

export function hashPasswordForSeed(password: string): string {
  return hashPassword(password);
}

export const authOptions: NextAuthOptions = {
  secret: getNextAuthSecret(),
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
