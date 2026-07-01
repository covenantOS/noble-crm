// Acorn Finance pre-qualification link, shown as a customer-facing CTA on
// estimate and invoice detail views. Static marketing link -- no
// server-side logic involved, just a clickable external URL.
export const ACORN_FINANCE_URL = "https://www.acornfinance.com/pre-qualify/?d=BLYXZ";

// Payment tier percentages -- MUST stay in sync with PAYMENT_TIERS in
// src/server/index.ts. The server and client can't literally share a TS
// module across the Workers/Vite build boundary in this repo's setup, so
// this is a manually-kept-in-sync copy used only to render a client-side
// preview of what the customer would owe under each method before they
// commit to recording a payment; the server is always the source of truth
// for the actual amount charged (see computePaymentAmount there).
// Sign convention (matches the server): negative = discount off the
// invoice total (cash/check), positive = surcharge added to it (card/
// financing).
export const PAYMENT_TIERS: Record<"cash" | "check" | "card" | "financing", number> = {
  cash: -0.08,
  check: -0.08,
  card: 0.04,
  financing: 0.06,
};

export function computePaymentAmount(invoiceTotal: number, method: "cash" | "check" | "card" | "financing"): { amount: number; surchargeAmount: number } {
  const rate = PAYMENT_TIERS[method];
  const surchargeAmount = invoiceTotal * rate;
  const amount = invoiceTotal + surchargeAmount;
  return { amount, surchargeAmount };
}
