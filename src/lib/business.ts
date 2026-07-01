// Server-side business constants used by the Worker (the customer-facing HTML
// page, PDF letterhead footer, and notification emails). The client has its
// own copy of ACORN_FINANCE_URL in src/client/constants.ts -- the two can't
// share a module across the Vite/Workers build boundary in this repo's setup,
// so this is the Worker-side source of truth (kept identical on purpose).

// Acorn Finance pre-qualification link, shown as the customer-facing financing
// CTA on the public estimate page and in PDFs.
export const ACORN_FINANCE_URL = "https://www.acornfinance.com/pre-qualify/?d=BLYXZ";

// Umbrella business identity for the customer-facing page footer / email
// from-name fallback when an estimate has no brand attached.
export const DEFAULT_BUSINESS_NAME = "Noble Tampa";
export const BUSINESS_LOCATION = "Tampa, FL";
