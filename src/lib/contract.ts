/**
 * Noble Estimator — Contract text builder (17 sections per SPEC)
 * Used for customer-facing contract display and PDF.
 */

export type PaymentTierKey = 'UPFRONT_CASH' | 'UPFRONT_CARD' | 'FINANCE' | 'PAYMENT_PLAN';

export interface ContractData {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  customerName: string;
  customerAddress: string;
  propertyAddress: string;
  scopeOfWork: string;
  paymentTier: PaymentTierKey;
  totalAmount: number;
  depositAmount?: number;
  midpointAmount?: number;
  completionAmount?: number;
  timeline: string;
  warrantyYears: number;
  changeOrderMarkupPercent: number;
  contractDate: string;
}

const TIER_LABELS: Record<PaymentTierKey, string> = {
  UPFRONT_CASH: '100% Upfront by Check or Bank Transfer',
  UPFRONT_CARD: '100% Upfront by Card',
  FINANCE: 'Finance with Klarna or Afterpay',
  PAYMENT_PLAN: 'Payment Plan by Card (50/40/10)',
};

export function buildContractSections(data: ContractData): { title: string; body: string }[] {
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const tierLabel = TIER_LABELS[data.paymentTier];

  const paymentSchedule =
    data.paymentTier === 'PAYMENT_PLAN' && data.depositAmount != null && data.midpointAmount != null && data.completionAmount != null
      ? `Payment 1: ${fmt(data.depositAmount)} due upon execution of this contract. Payment 2: ${fmt(data.midpointAmount)} due upon contractor's notification that project has reached midpoint. Payment 3: ${fmt(data.completionAmount)} due upon completion and final walkthrough.`
      : `Total of ${fmt(data.totalAmount)} due upon execution of this contract.`;

  const sections: { title: string; body: string }[] = [
    {
      title: '1. Parties and Property',
      body: `Contractor: ${data.companyName}, ${data.companyAddress}. Customer: ${data.customerName}, ${data.customerAddress}. Property where work will be performed: ${data.propertyAddress}. Date of contract: ${data.contractDate}.`,
    },
    {
      title: '2. Scope of Work',
      body: `${data.scopeOfWork} Paint products: Sherwin-Williams Duration or equivalent, Satin finish. Two coats on all surfaces unless otherwise specified. Prep work included: pressure washing, scraping, sanding, caulking, patching, priming as needed. Color selections to be approved by homeowner prior to start. This contract does not include interior painting (unless listed), carpentry beyond minor wood rot repair, roof painting, or pool deck coating unless specifically listed above.`,
    },
    {
      title: '3. Price and Payment Terms',
      body: `Total contract price: ${fmt(data.totalAmount)}. Payment tier: ${tierLabel}. ${paymentSchedule} The total contract price includes all labor, materials, equipment, and cleanup. There are no hidden fees. Prices are valid for 30 days from the date of the estimate. After 30 days, pricing may be subject to revision based on material cost changes.`,
    },
    {
      title: '4. Payment Authorization and Auto-Charge Consent',
      body: `By signing this contract and providing your payment method, you authorize ${data.companyName} to automatically charge the payment method on file for each scheduled payment as described in Section 3. You will receive a notification via email and text message at least 48 hours before each scheduled auto-charge. If an auto-charge fails, you will be notified immediately and given 3 business days to provide an updated payment method or arrange alternative payment. You may update your payment method at any time by contacting us at ${data.companyPhone} or ${data.companyEmail}.`,
    },
    {
      title: '5. Project Timeline',
      body: `${data.timeline} All dates are estimates and subject to weather conditions. Exterior work cannot be performed during rain, within 24 hours of rain, or when temperatures are below 50°F or above 95°F. Weather delays extend the completion date by the number of days lost to weather. Work will be performed Monday through Saturday, 8:00 AM to 6:00 PM, unless otherwise agreed in writing.`,
    },
    {
      title: '6. Change Orders',
      body: `Any changes to the scope of work must be agreed to in writing by both parties before additional work begins. Change orders may result in additional charges. The contractor will provide a written estimate for any change order before work begins. Change orders may extend the project timeline. Additional work requested after contract execution may be priced at the contractor's then-current rates, which may include a ${data.changeOrderMarkupPercent}% markup. The contractor reserves the right to decline change order requests that fall outside the contractor's scope of expertise.`,
    },
    {
      title: '7. Notice of Pre-Existing Conditions',
      body: `During the course of work, the contractor may discover pre-existing conditions not visible during the initial inspection (e.g., hidden wood rot, structural damage, mold, lead-based paint, moisture intrusion). If such conditions are discovered, the contractor will stop work on the affected area, document with photographs, notify the customer promptly in writing, and provide a written estimate for any additional work required. The customer may authorize the additional work, decline and accept limited warranty for the affected area, or hire a separate specialist before painting resumes. The contractor is not responsible for deficiencies caused by pre-existing conditions that the customer declines to address.`,
    },
    {
      title: '8. Customer Responsibilities',
      body: `Customer shall: provide clear access to all work areas; for exterior work, move vehicles from driveway, relocate patio furniture and items at least 4 feet from walls, trim vegetation contacting surfaces; secure all pets during work hours; inform contractor of any security/sprinkler/lighting systems affected; select and approve all paint colors prior to scheduled start date; be available for questions and approvals; notify contractor of any known hazards (lead paint, asbestos, bees, loose railings, aggressive animals).`,
    },
    {
      title: '9. Warranty',
      body: `The contractor warrants all workmanship for ${data.warrantyYears} years from the date of project completion. During the warranty period, the contractor will repair at no additional cost any defects in workmanship (peeling, blistering, flaking, uneven coverage from improper application). This warranty does NOT cover: normal wear and tear; damage caused by the customer, third parties, or pressure washing within 30 days of completion; acts of God; color fading due to UV; paint failure on surfaces where the customer declined recommended prep or repairs; movement or cracking of the underlying structure; moisture intrusion from sources unrelated to the paint application. Manufacturer warranties are separate.`,
    },
    {
      title: '10. Insurance and Liability',
      body: `The contractor carries general liability insurance ($1,000,000 per occurrence, $2,000,000 aggregate) and a surety bond. Proof of insurance available upon request. The contractor's total liability under this contract shall not exceed the total contract price. The contractor is not liable for: pre-existing conditions; color variations between samples and final result; minor imperfections visible only under specific lighting; damage to landscaping or items not moved by the customer as requested.`,
    },
    {
      title: '11. Subcontractor Disclosure',
      body: `${data.companyName} may use independent subcontractors to perform some or all of the work. All subcontractors are vetted and carry required workers' compensation. The contractor remains fully responsible for the quality of all work performed.`,
    },
    {
      title: '12. Cancellation and Termination',
      body: `Customer may cancel within 3 business days of signing for a full refund of any deposit. After that: if materials have not been ordered and work has not begun, customer may cancel with refund of deposit minus a $250 administrative fee; if materials have been ordered or work has begun, the deposit is non-refundable and customer is responsible for cost of materials and labor performed. Contractor may terminate if customer fails to make scheduled payments within 5 business days of due date, materially breaches the contract, or unsafe conditions are discovered.`,
    },
    {
      title: '13. Dispute Resolution',
      body: `Parties will first attempt resolution through direct communication in good faith. If unsuccessful within 15 days, parties agree to mediation by a mutually agreed mediator in Hillsborough County, Florida; cost shared equally. If mediation is unsuccessful, parties agree to binding arbitration in Hillsborough County in accordance with AAA rules. Prevailing party may recover reasonable attorney's fees and costs.`,
    },
    {
      title: '14. Governing Law',
      body: `This contract shall be governed by the laws of the State of Florida. Venue for any legal proceedings shall be Hillsborough County, Florida.`,
    },
    {
      title: '15. Entire Agreement',
      body: `This contract constitutes the entire agreement between the parties and supersedes all prior discussions, negotiations, and agreements. No modification shall be valid unless in writing and signed by both parties. If any provision is found invalid or unenforceable, the remaining provisions shall continue in full force and effect.`,
    },
    {
      title: '16. Florida Construction Lien Law',
      body: `ACCORDING TO FLORIDA'S CONSTRUCTION LIEN LAW (SECTIONS 713.001-713.37, FLORIDA STATUTES), THOSE WHO WORK ON YOUR PROPERTY OR PROVIDE MATERIALS AND SERVICES AND ARE NOT PAID IN FULL HAVE A RIGHT TO ENFORCE THEIR CLAIM FOR PAYMENT AGAINST YOUR PROPERTY. THIS CLAIM IS KNOWN AS A CONSTRUCTION LIEN. THIS NOTICE IS REQUIRED BY FLORIDA LAW AND IS NOT AN INDICATION OF ANY PROBLEM WITH YOUR CONTRACT OR YOUR CONTRACTOR.`,
    },
    {
      title: '17. Signatures',
      body: `By signing below, the customer agrees to all terms above. Signer name, date, and IP address will be recorded. The contractor will countersign and provide a fully executed copy to the customer.`,
    },
  ];

  return sections;
}
