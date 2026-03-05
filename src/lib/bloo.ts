// ============================================
// NOBLE ESTIMATOR — BLOO.IO CLIENT
// ============================================
// iMessage (iOS) and RCS (Android) delivery
// NOT SMS — arrives as blue bubble / RCS

const BLOO_API_BASE = 'https://api.bloo.io/v1';

interface BlooSendResult {
    messageId: string;
    status: string;
}

interface BlooMessageStatus {
    messageId: string;
    status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
    deliveredAt?: string;
    readAt?: string;
}

async function blooFetch(
    endpoint: string,
    options: RequestInit = {}
): Promise<Response> {
    const apiKey = process.env.BLOO_API_KEY;
    if (!apiKey) {
        throw new Error('BLOO_API_KEY is not set');
    }

    return fetch(`${BLOO_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
}

// Send a message via iMessage/RCS
export async function sendMessage(
    to: string,
    content: string,
    metadata?: Record<string, string>
): Promise<BlooSendResult> {
    const response = await blooFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
            to: normalizePhone(to),
            content,
            metadata,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Bloo API error: ${response.status} — ${error}`);
    }

    return response.json();
}

// Check message delivery status
export async function getMessageStatus(messageId: string): Promise<BlooMessageStatus> {
    const response = await blooFetch(`/messages/${messageId}`);

    if (!response.ok) {
        throw new Error(`Bloo API error: ${response.status}`);
    }

    return response.json();
}

// Template variable replacement
export function renderTemplate(
    template: string,
    variables: Record<string, string>
): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return rendered;
}

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }
    return `+${digits}`;
}

export const bloo = {
    sendMessage,
    getMessageStatus,
    renderTemplate,
};

export default bloo;
