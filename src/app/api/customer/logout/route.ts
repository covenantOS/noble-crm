import { NextResponse } from 'next/server';

const COOKIE_NAME = 'noble_customer_session';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
