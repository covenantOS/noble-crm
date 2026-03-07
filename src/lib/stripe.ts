// ============================================
// NOBLE ESTIMATOR — STRIPE CLIENT
// ============================================
// Handles: Checkout Sessions, Saved Payment Methods,
// Auto-Charge, Klarna/Afterpay integration

import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;
export function getStripe(): Stripe {
    if (!stripeInstance) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
        stripeInstance = new Stripe(key, {
            apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
            typescript: true,
        });
    }
    return stripeInstance;
}

// Create or get a Stripe customer
export async function getOrCreateStripeCustomer(
    email: string,
    name: string,
    phone?: string | null
): Promise<string> {
    // Search for existing customer
    const existing = await getStripe().customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
        return existing.data[0].id;
    }

    const customer = await getStripe().customers.create({
        email,
        name,
        phone: phone || undefined,
        metadata: { source: 'noble_estimator' },
    });

    return customer.id;
}

// Tier 1: Upfront Cash — No Stripe needed, return instructions
export function getUpfrontCashInstructions(amount: number): string {
    return `Please make payment of $${amount.toLocaleString()} by check or bank transfer before work begins. Make checks payable to "Westchase Painting Company LLC".`;
}

// Tier 2: Upfront Card — Checkout Session for full tier amount (dynamically calculated)
export async function createUpfrontCardCheckout(
    stripeCustomerId: string,
    amount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    const amountCents = Math.round(amount * 100);
    const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
    return getStripe().checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services — ${propertyAddress}`,
                        description: `Full payment (Pay in Full by Card) — ${amountFormatted}`,
                    },
                    unit_amount: amountCents,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            contractId,
            paymentTier: 'UPFRONT_CARD',
            type: 'FULL_UPFRONT',
            expectedAmountCents: String(amountCents),
        },
    });
}

// Tier 3: Finance via Klarna/Afterpay — Checkout Session for full base price (we get 100% upfront)
export async function createFinanceCheckout(
    stripeCustomerId: string,
    amount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    const amountCents = Math.round(amount * 100);
    const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
    return getStripe().checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card', 'klarna', 'afterpay_clearpay'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services — ${propertyAddress}`,
                        description: `Finance with Klarna or Afterpay — ${amountFormatted} (standard price)`,
                    },
                    unit_amount: amountCents,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            contractId,
            paymentTier: 'FINANCE',
            type: 'FULL_UPFRONT',
            expectedAmountCents: String(amountCents),
        },
    });
}

// Tier 4: Payment Plan — Deposit only at checkout; midpoint/completion auto-charged later
export async function createPaymentPlanCheckout(
    stripeCustomerId: string,
    depositAmount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    const amountCents = Math.round(depositAmount * 100);
    const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(depositAmount);
    return getStripe().checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services — ${propertyAddress}`,
                        description: `Deposit (Payment Plan 50/40/10) — ${amountFormatted}. Midpoint and completion will be charged automatically.`,
                    },
                    unit_amount: amountCents,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        payment_intent_data: {
            setup_future_usage: 'off_session', // Save card for midpoint/completion auto-charge
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            contractId,
            paymentTier: 'PAYMENT_PLAN',
            type: 'DEPOSIT',
            expectedAmountCents: String(amountCents),
        },
    });
}

// Auto-charge a saved payment method
export async function chargePaymentMethod(
    stripeCustomerId: string,
    paymentMethodId: string,
    amount: number,
    contractId: string,
    paymentType: 'MIDPOINT' | 'COMPLETION',
    propertyAddress: string
): Promise<Stripe.PaymentIntent> {
    return getStripe().paymentIntents.create({
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        amount: Math.round(amount * 100),
        currency: 'usd',
        confirm: true,
        off_session: true,
        description: `${paymentType === 'MIDPOINT' ? 'Midpoint' : 'Completion'} payment — ${propertyAddress}`,
        metadata: {
            contractId,
            paymentTier: 'PAYMENT_PLAN',
            type: paymentType,
        },
    });
}

// Get saved payment methods for a customer
export async function getSavedPaymentMethods(
    stripeCustomerId: string
): Promise<Stripe.PaymentMethod[]> {
    const result = await getStripe().paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
    });
    return result.data;
}

// Construct webhook event
export function constructWebhookEvent(
    payload: string | Buffer,
    signature: string
): Stripe.Event {
    return getStripe().webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
    );
}

export default getStripe;
