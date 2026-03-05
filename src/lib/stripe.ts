// ============================================
// NOBLE ESTIMATOR — STRIPE CLIENT
// ============================================
// Handles: Checkout Sessions, Saved Payment Methods,
// Auto-Charge, Klarna/Afterpay integration

import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
    typescript: true,
});

// Create or get a Stripe customer
export async function getOrCreateStripeCustomer(
    email: string,
    name: string,
    phone?: string | null
): Promise<string> {
    // Search for existing customer
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
        return existing.data[0].id;
    }

    const customer = await stripe.customers.create({
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

// Tier 2: Upfront Card — Checkout Session for full amount
export async function createUpfrontCardCheckout(
    stripeCustomerId: string,
    amount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services — ${propertyAddress}`,
                        description: 'Full payment for painting services',
                    },
                    unit_amount: Math.round(amount * 100), // cents
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
        },
    });
}

// Tier 3: Finance via Klarna/Afterpay — Checkout Session
export async function createFinanceCheckout(
    stripeCustomerId: string,
    amount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card', 'klarna', 'afterpay_clearpay'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services — ${propertyAddress}`,
                        description: 'Finance your painting project with Klarna or Afterpay',
                    },
                    unit_amount: Math.round(amount * 100),
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
        },
    });
}

// Tier 4: Payment Plan — Deposit Checkout + SetupIntent for auto-charges
export async function createPaymentPlanCheckout(
    stripeCustomerId: string,
    depositAmount: number,
    contractId: string,
    propertyAddress: string,
    successUrl: string,
    cancelUrl: string
): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Painting Services Deposit — ${propertyAddress}`,
                        description: 'Deposit payment (50% of total)',
                    },
                    unit_amount: Math.round(depositAmount * 100),
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        payment_intent_data: {
            setup_future_usage: 'off_session', // Save the card for future charges
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            contractId,
            paymentTier: 'PAYMENT_PLAN',
            type: 'DEPOSIT',
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
    return stripe.paymentIntents.create({
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
    const result = await stripe.paymentMethods.list({
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
    return stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
    );
}

export default stripe;
