// ============================================
// NOBLE ESTIMATOR — BLOO.IO CLIENT (v2 API)
// ============================================
// iMessage (iOS) and RCS (Android) via https://docs.blooio.com/
// Base URL: https://backend.blooio.com/v2/api

const BLOO_API_BASE = 'https://backend.blooio.com/v2/api';

export interface BlooSendResult {
    message_id: string;
    message_ids?: string[];
    status: string;
    group_id?: string;
    group_created?: boolean;
    participants?: string[];
}

interface BlooMessageStatus {
    message_id: string;
    status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
    delivered_at?: number;
    read_at?: number;
}

function getApiKey(): string {
    const apiKey = process.env.BLOO_API_KEY;
    if (!apiKey) throw new Error('BLOO_API_KEY is not set');
    return apiKey;
}

function getFromNumber(): string | undefined {
    return process.env.BLOO_FROM_NUMBER?.trim() || undefined;
}

async function blooFetch(
    endpoint: string,
    options: RequestInit = {}
): Promise<Response> {
    return fetch(`${BLOO_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
}

// Normalize phone to E.164 (e.g. +14245145517)
export function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
}

/**
 * Send a message via iMessage/RCS.
 * Uses BLOO_FROM_NUMBER (+14245145517) when set.
 */
export async function sendMessage(
    to: string,
    content: string,
    metadata?: Record<string, string>
): Promise<BlooSendResult> {
    const chatId = encodeURIComponent(normalizePhone(to));
    const fromNumber = getFromNumber();

    const body: { text: string; from_number?: string; metadata?: Record<string, string> } = {
        text: content,
    };
    if (fromNumber) body.from_number = normalizePhone(fromNumber);
    if (metadata) body.metadata = metadata;

    const response = await blooFetch(`/chats/${chatId}/messages`, {
        method: 'POST',
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Bloo API error: ${response.status} — ${err}`);
    }

    const data = (await response.json()) as BlooSendResult;
    return data;
}

/**
 * Get message status (optional; webhooks are preferred).
 * chatId = recipient E.164 phone.
 */
export async function getMessageStatus(
    chatId: string,
    messageId: string
): Promise<BlooMessageStatus> {
    const encoded = encodeURIComponent(normalizePhone(chatId));
    const response = await blooFetch(
        `/chats/${encoded}/messages/${encodeURIComponent(messageId)}/status`
    );

    if (!response.ok) throw new Error(`Bloo API error: ${response.status}`);
    return response.json() as Promise<BlooMessageStatus>;
}

export function renderTemplate(
    template: string,
    variables: Record<string, string>
): string {
    let out = template;
    for (const [k, v] of Object.entries(variables)) {
        out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return out;
}

export const bloo = {
    sendMessage,
    getMessageStatus,
    renderTemplate,
    normalizePhone,
};

export default bloo;
