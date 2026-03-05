import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';

type BlooEvent =
    | 'message.sent'
    | 'message.delivered'
    | 'message.failed'
    | 'message.read'
    | 'message.received'
    | 'message.reaction'
    | 'group.name_changed'
    | 'group.icon_changed';

function verifyBlooSignature(secret: string, signatureHeader: string, rawBody: string): boolean {
    if (!secret || !signatureHeader) return false;
    const parts = signatureHeader.split(',');
    const tPart = parts.find((p) => p.startsWith('t='));
    const vPart = parts.find((p) => p.startsWith('v1='));
    if (!tPart || !vPart) return false;
    const timestamp = tPart.split('=')[1];
    const signature = vPart.split('=')[1];
    const payload = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
        return false;
    }
}

const EVENT_TO_STATUS = {
    'message.sent': 'SENT',
    'message.delivered': 'DELIVERED',
    'message.read': 'READ',
    'message.failed': 'FAILED',
} as const;

export async function POST(request: NextRequest) {
    const secret = process.env.BLOO_WEBHOOK_SECRET;
    const rawBody = await request.text();
    const signature = request.headers.get('X-Blooio-Signature') ?? '';
    const eventType = request.headers.get('X-Blooio-Event') as BlooEvent | null;
    const messageId = request.headers.get('X-Blooio-Message-Id');

    if (secret && !verifyBlooSignature(secret, signature, rawBody)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: { event?: string; message_id?: string };
    try {
        payload = JSON.parse(rawBody) as { event?: string; message_id?: string };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const event = eventType ?? payload.event;
    const blooMessageId = messageId ?? payload.message_id;

    if (blooMessageId && event && event in EVENT_TO_STATUS) {
        const status = EVENT_TO_STATUS[event as keyof typeof EVENT_TO_STATUS];
        try {
            await prisma.message.updateMany({
                where: { blooMessageId },
                data: { status: status as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' },
            });
        } catch (e) {
            console.error('Bloo webhook: failed to update Message', e);
        }
    }

    return NextResponse.json({ received: true });
}
