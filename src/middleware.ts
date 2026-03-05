import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const API_AUTH_PREFIX = '/api/auth';

function getSecret(): string | undefined {
  const s = process.env.NEXTAUTH_SECRET;
  return s ? String(s).trim() || undefined : undefined;
}

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith(API_AUTH_PREFIX)) return true;
  if (pathname === '/login') return true;
  if (pathname.startsWith('/view')) return true;
  if (pathname.startsWith('/customer')) return true;
  if (pathname.startsWith('/api/view') || pathname.startsWith('/api/customer') || pathname.startsWith('/api/contracts') || pathname.startsWith('/api/webhooks') || pathname === '/api/bootstrap' || pathname === '/api/estimates/send-reminders' || pathname.startsWith('/api/cron/')) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: getSecret(),
  });

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
