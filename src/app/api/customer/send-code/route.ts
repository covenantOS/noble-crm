import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';
import { randomInt } from 'crypto';

const CODE_EXPIRY_MINUTES = 15;
const CODE_LENGTH = 6;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone } = body as { email?: string; phone?: string };

    const identifier = email?.trim() || phone?.trim();
    if (!identifier) {
      return NextResponse.json({ error: 'Email or phone required' }, { status: 400 });
    }

    const isEmail = identifier.includes('@');
    const digits = identifier.replace(/\D/g, '');
    const phoneNorm = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : identifier;
    const customer = isEmail
      ? await prisma.customer.findFirst({ where: { email: identifier } })
      : await prisma.customer.findFirst({
          where: {
            OR: [{ phone: identifier }, { phone: phoneNorm }, { phone: { contains: digits.slice(-10) } }],
          },
        });

    if (!customer) {
      return NextResponse.json({ error: 'No account found with that email or phone' }, { status: 404 });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    await prisma.customerVerificationCode.create({
      data: {
        customerId: customer.id,
        code,
        channel: isEmail ? 'EMAIL' : 'IMESSAGE',
        sentTo: identifier,
        expiresAt,
      },
    });

    const message = `Your Noble Estimator login code is: ${code}. It expires in ${CODE_EXPIRY_MINUTES} minutes.`;
    if (isEmail) {
      await sendEmail({
        to: identifier,
        subject: 'Your login code — Westchase Painting Company',
        html: `<p>${message}</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } else {
      await sendBloo(identifier, message);
    }

    return NextResponse.json({
      success: true,
      channel: isEmail ? 'email' : 'sms',
      expiresIn: CODE_EXPIRY_MINUTES * 60,
    });
  } catch (e) {
    console.error('Send code error:', e);
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
  }
}
