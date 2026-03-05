# Noble Estimator — Full Build Prompt for Claude Code

## What This Is

Build a production-ready Progressive Web App (PWA) called **Noble Estimator** for **Westchase Painting Company by Noble**, a residential painting company serving Tampa Bay, Florida. This is a field estimating tool that lets the business owner walk a property, capture measurements and photos, run them through an AI pipeline, and produce a professional estimate that flows into contract signing, payment collection, and automated customer communication.

This app is the foundation of a full CRM system called **Noble CRM** that will eventually replace GoHighLevel entirely. Every architectural decision must account for future expansion into full pipeline management, job scheduling, crew management, customer relationship tracking, invoicing, reporting, and multi-location support. Design the database schema, API structure, and component architecture for growth.

---

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Backend:** Next.js API routes + Prisma ORM
- **Database:** PostgreSQL via Supabase (hosted Postgres + Supabase Storage for photos + Supabase Auth if needed)
- **Auth:** NextAuth.js or Clerk (admin login only for now, but architect for multi-user roles later: owner, sales rep, estimator, crew lead)
- **AI:** Anthropic Claude API (claude-sonnet-4-5-20250929) for all AI stages — text analysis, photo analysis (multimodal), and document generation
- **Payments:** Stripe (with Klarna and Afterpay enabled via Stripe's BNPL integration). Stripe must support saved payment methods for auto-draw on scheduled payments.
- **Email:** Resend (domain: westchasepainting.com)
- **iMessage/RCS:** Bloo.io API (https://bloo.io) for iMessage and RCS delivery. This is NOT SMS. Messages arrive as iMessage (blue bubble) on iOS and RCS on Android. Use Bloo.io exclusively. Fetch and follow Bloo.io API documentation at https://docs.bloo.io or equivalent. All customer-facing messages go through Bloo.
- **PDF Generation:** @react-pdf/renderer or Puppeteer for server-side PDF generation
- **File Storage:** Supabase Storage for all photos and generated documents
- **Hosting:** Vercel for deployment. GitHub for source control.
- **PWA:** next-pwa for service worker, manifest, and installability

---

## Brand & Design Direction

**Company:** Westchase Painting Company by Noble
**Colors:** Navy (#1a2744) primary, Gold (#c9a84c) accent, White (#ffffff) backgrounds, Light gray (#f5f5f5) surfaces
**Typography:** Montserrat Bold for headings, Montserrat Regular for body
**Feel:** Premium, trustworthy, established. This is a high-end residential painting company, not a budget outfit. The app should feel like a professional tool built for a company that takes its work seriously. Think: clean, confident, no clutter.

**Credentials displayed in estimate/contract headers:**
- Bonded & Insured
- EPA Lead-Safe Certified Firm
- OSHA Safety Trained
- PCA Member
- Sherwin-Williams PRO+ Partner

---

## Database Schema (Prisma)

Design these core models. Include all fields, relations, and indexes. This schema must support future CRM expansion.

### Core Models:

**User** — Admin users (Will for now, expandable to sales reps, crew leads later)
- id, name, email, phone, role (enum: OWNER, SALES, ESTIMATOR, CREW_LEAD), passwordHash, createdAt, updatedAt

**Customer** — Homeowners
- id, firstName, lastName, email, phone, address, city, state, zip, source (enum: GBP, REFERRAL, ANGI, DOOR_HANGER, WEBSITE, OTHER), notes, createdAt, updatedAt

**Property** — Physical properties (a customer can have multiple)
- id, customerId (relation), address, city, state, zip, squareFootageInterior, stories, constructionType (enum: STUCCO, WOOD, HARDIE_BOARD, BRICK, VINYL, ALUMINUM, MIXED), yearBuilt, notes, createdAt

**Estimate** — The core estimate object
- id, propertyId (relation), customerId (relation), createdById (relation to User), status (enum: DRAFT, AI_PROCESSING, REVIEW, SENT, VIEWED, APPROVED, DECLINED, EXPIRED), scopeType (enum: EXTERIOR, INTERIOR, BOTH), basePrice, upfrontCashPrice, upfrontCardPrice, financePrice (same as basePrice), paymentPlanPrice, aiAnalysis (JSON — stores full AI output), humanNotes, scopeOfWork (text — customer-facing description), timeline, warrantyTerms, createdAt, updatedAt, sentAt, viewedAt, approvedAt

**EstimateLineItem** — Individual line items on an estimate
- id, estimateId (relation), category (enum: PREP, PAINT, PRIMER, TRIM, DETAIL, REPAIR, MATERIAL, OTHER), description, quantity, unit (sqft, hours, each, gallon, etc.), unitCost, totalCost, sortOrder

**EstimatePhoto** — Photos taken during property inspection
- id, estimateId (relation), url, caption, aiAnalysis (text — what the AI detected in this photo), location (text — e.g., "north wall", "front door frame"), flaggedIssues (JSON array), showToCustomer (boolean — controls which photos appear in the customer-facing estimate), sortOrder, createdAt

**EstimateMeasurement** — Structured measurements
- id, estimateId (relation), surface (enum: EXTERIOR_WALL, INTERIOR_WALL, CEILING, TRIM, FASCIA, SOFFIT, DOOR, GARAGE_DOOR, FENCE, DECK, CABINET, OTHER), description (e.g., "north wall"), linearFeet, height, grossArea, windowDeduction, doorDeduction, netPaintableArea, coatsRequired, notes

**Contract** — Generated from approved estimate
- id, estimateId (relation), customerId (relation), status (enum: GENERATED, SENT, VIEWED, SIGNED, ACTIVE, COMPLETED, CANCELLED), documentUrl (PDF), contractSnapshot (JSON — complete immutable copy of all terms at time of signing), signedAt, signatureData (base64 image of signature), signerIpAddress, signerName, paymentTier (enum: UPFRONT_CASH, UPFRONT_CARD, FINANCE, PAYMENT_PLAN), stripeCustomerId (for saved payment methods), stripePaymentMethodId (for auto-draw), depositAmount, midpointAmount, completionAmount, totalAmount, termsAccepted (boolean), autoChargeAuthorized (boolean), createdAt

**Payment** — Individual payment transactions
- id, contractId (relation), type (enum: DEPOSIT, MIDPOINT, COMPLETION, FULL_UPFRONT), method (enum: CASH, CHECK, ACH_STRIPE, CARD_STRIPE, KLARNA, AFTERPAY), amount, status (enum: SCHEDULED, PENDING, PROCESSING, COMPLETED, FAILED, RETRYING, REFUNDED), stripePaymentIntentId, scheduledDate, dueDate, paidAt, failedAt, retryCount, createdAt

**PaymentReminder** — Tracks notifications sent for upcoming/failed payments  
- id, paymentId (relation), type (enum: UPCOMING, DUE, OVERDUE, FAILED, RETRY), channel (enum: EMAIL, IMESSAGE), sentAt, createdAt

**Message** — All customer communications
- id, customerId (relation), estimateId (optional relation), contractId (optional relation), direction (enum: OUTBOUND, INBOUND), channel (enum: IMESSAGE, RCS, EMAIL), content, status (enum: QUEUED, SENT, DELIVERED, READ, FAILED), blooMessageId (for tracking delivery status), sentAt, createdAt

**PricingConfig** — Admin-adjustable pricing variables
- id, key (unique string), value (string — parse as needed), category (enum: MATERIAL, LABOR, MARKUP, PAYMENT, OTHER), label (human-readable name), description, updatedAt

### Default PricingConfig Seed Data:

```
MATERIAL category:
- paint_cost_per_gallon_premium: "55" (Sherwin-Williams Duration)
- paint_cost_per_gallon_standard: "42" (Sherwin-Williams SuperPaint)
- primer_cost_per_gallon: "35"
- caulk_cost_per_tube: "6"
- painters_tape_cost_per_roll: "7"
- plastic_sheeting_cost_per_roll: "15"
- sandpaper_cost_per_pack: "12"
- wood_filler_cost_per_quart: "14"

LABOR category:
- labor_rate_exterior_stucco_per_sqft: "1.25" (includes prep, prime spots, 2 coats)
- labor_rate_exterior_wood_per_sqft: "1.50"
- labor_rate_interior_walls_per_sqft: "0.85"
- labor_rate_interior_ceiling_per_sqft: "0.95"
- labor_rate_trim_per_linear_ft: "2.50"
- labor_rate_door_each: "85"
- labor_rate_garage_door_each: "150"
- labor_rate_fascia_per_linear_ft: "3.00"
- labor_rate_soffit_per_linear_ft: "2.75"
- labor_rate_pressure_wash_per_sqft: "0.15"
- labor_rate_wood_rot_repair_per_hour: "65"
- labor_rate_caulking_per_linear_ft: "1.50"
- labor_rate_scraping_per_sqft: "0.75"
- prep_multiplier_good_condition: "1.0"
- prep_multiplier_fair_condition: "1.3"
- prep_multiplier_poor_condition: "1.7"

MARKUP category:
- target_gross_margin_percent: "50"
- minimum_job_price: "1500"
- small_job_surcharge_under: "2000" (jobs under this get a flat surcharge)
- small_job_surcharge_amount: "250"

PAYMENT category:
- upfront_cash_discount_percent: "8"
- upfront_card_discount_percent: "4"
- payment_plan_surcharge_percent: "3"
- change_order_markup_percent: "15"
- deposit_percent: "50"
- midpoint_percent: "40"
- completion_percent: "10"

COVERAGE category:
- paint_coverage_smooth_sqft_per_gallon: "400"
- paint_coverage_textured_sqft_per_gallon: "300"
- paint_coverage_rough_stucco_sqft_per_gallon: "250"
- primer_coverage_sqft_per_gallon: "350"

OTHER category:
- default_warranty_years: "2"
- default_coats: "2"
- sales_tax_rate: "0" (no sales tax on labor in FL, materials tax included in cost)
```

---

## App Pages & User Flows

### 1. Dashboard (/)

The home screen after login. Shows:
- Active estimates (in progress, sent, awaiting approval)
- Recent activity feed
- Quick stats: estimates this month, close rate, revenue this month, average job size
- Quick-action buttons: "New Estimate", "View All Estimates", "Settings"

### 2. New Estimate Flow (/estimates/new)

**Step 1: Customer & Property Info**

Form to capture or select existing customer. Fields:
- Customer: first name, last name, phone, email (autocomplete from existing customers)
- Property: address (Google Places autocomplete), city, state, zip
- Square footage (interior), number of stories, construction type (dropdown), year built
- How they heard about us (source dropdown)

**Step 2: Scope Selection**

- Scope type: Exterior / Interior / Both (toggle)
- Surface checklist (checkboxes, show relevant ones based on scope):
  - Exterior: Body walls, Trim, Fascia, Soffit, Front door, Garage door, Shutters, Fence, Deck/patio
  - Interior: Walls (select rooms), Ceilings, Trim/baseboards, Doors, Cabinets, Accent walls
- For each selected surface, capture:
  - Condition: Good / Fair / Poor (affects prep multiplier)
  - Notes field

**Step 3: Measurements**

For each surface in scope, capture measurements:
- Exterior walls: linear feet per wall section + height. App auto-calculates gross area.
- Window deductions: count x average size (app uses 15 sqft default per window, adjustable)
- Door deductions: count x average size (app uses 21 sqft default per door)
- App calculates net paintable area per surface and total
- Interior rooms: length x width x height per room. App calculates wall area (perimeter x height - openings)
- Trim: linear feet
- Doors: count

Include a "quick estimate" mode where the user can just enter total exterior sqft or total interior sqft if they don't want to measure every wall individually. The AI will work with whatever level of detail is provided.

**Step 4: Photos & Notes**

- Camera integration: take photos directly in the app (use device camera API)
- Photo upload from gallery
- For each photo: tag it with a location (dropdown matching the surfaces from Step 2) and add optional notes
- General notes field for anything the AI should know: "homeowner wants to keep current trim color", "large oak tree on south side limits ladder access", "HOA requires pre-approval of exterior colors"

**Step 5: AI Analysis (processing screen)**

When the user hits "Generate Estimate," the app:

1. Packages all structured data (measurements, scope, conditions, notes) into a comprehensive prompt
2. Sends photos to Claude's multimodal API along with the structured data
3. The AI prompt should instruct Claude to:
   - Analyze all photos for surface conditions, paint failures, prep requirements, and anything the user may have missed
   - Cross-reference photo analysis with the user's notes and condition assessments
   - Calculate material quantities (gallons of paint, primer, caulk, etc.) based on net paintable area and coverage rates from PricingConfig
   - Calculate labor costs using the rates and prep multipliers from PricingConfig
   - Apply the target gross margin
   - Generate a customer-facing scope of work description in professional, clear language
   - Generate line items with quantities and costs
   - Estimate job duration in days
   - Flag any concerns or recommendations (e.g., "wood rot detected on front door frame, recommend carpentry repair before painting — adds approximately $XXX")
   - Return everything as structured JSON

Show a loading screen with progress indicators while the AI processes. Show the Westchase Painting Company logo and a message like "Analyzing your property..."

**Step 6: Review & Adjust**

Display the AI-generated estimate for the user to review:
- Summary: total price (card price), cash/check price, finance price
- Line items table (editable — user can adjust quantities, costs, or add/remove items)
- AI photo analysis notes (what the AI found in each photo)
- AI flags/recommendations
- Scope of work text (editable)
- Timeline estimate
- "Approve & Generate PDF" button
- "Back to Edit" button to return to any previous step

### 3. Estimate Detail (/estimates/[id])

After approval, shows the full estimate with:
- Status badge (Draft, Sent, Viewed, Approved, Declined)
- Customer info
- Property info
- Full scope and pricing
- Photos
- Actions: Send to Customer, Generate Contract, View PDF, Edit, Duplicate, Delete

### 4. Customer-Facing Estimate Page (/view/[estimateId]/[token])

Public page (no auth required, accessed via unique token link). This is what the homeowner sees when they click the link in their email or text.

**Layout:**
- Westchase Painting Company branded header with logo, credentials badges
- Property address
- Scope of work (the professional description)
- Selected photos showing current condition (only ones marked showToCustomer)
- Total price displayed prominently

**Payment Options Section:**

This is the core revenue optimization feature. The principle: the less risk and cost the customer puts on the company, the better price they get. But critically, financing (Klarna/Afterpay) is BETTER for us than a payment plan because we get 100% of our money upfront with zero collection risk. Klarna assumes the risk, not us.

The app dynamically calculates ALL prices and payment schedules in real-time based on the option selected. The customer sees the total they will pay, every payment amount, and every payment date BEFORE they commit. Total transparency.

**ECONOMIC LOGIC (internal, not shown to customer):**

From the company's perspective, ranked best to worst:
1. 100% upfront cash/check — $0 in fees, $0 risk, immediate cash
2. 100% upfront card — ~2.9% Stripe fee, $0 risk, cash in 1-2 days
3. Financing (Klarna/Afterpay) — ~5% Klarna merchant fee, $0 risk, cash in 1-2 days
4. Payment plan (50/40/10) — ~2.9% x 3 charges, collection risk, cash spread over weeks

Therefore: financing is CHEAPER for the customer than a payment plan, because financing is BETTER for us than a payment plan. We pass our savings/costs through to the customer honestly.

**PAYMENT TIER STRUCTURE (4 tiers, displayed as cards):**

**Tier 1 (BEST VALUE — highlighted, recommended):**
"Pay in Full by Check or Bank Transfer"
Price: $[basePrice * (1 - upfrontCashDiscountPercent/100)]
Example on a $5,000 job at 8% discount: **$4,600**
Display: "You save $400! Best price available."
How it works: Customer pays the full discounted amount before work begins. One payment. Done.
Why it's cheapest: Zero processing fees for us, zero collection risk, we have full funds before buying materials. We pass the maximum savings to the customer.

**Tier 2:**
"Pay in Full by Card"
Price: $[basePrice * (1 - upfrontCardDiscountPercent/100)]
Example on a $5,000 job at 4% discount: **$4,800**
Display: "You save $200!"
How it works: Customer pays the full discounted amount via credit/debit card through Stripe before work begins. One payment.
Why: We pay ~2.9% to Stripe but have zero collection risk and immediate cash. The net discount to us after Stripe fees is small (~1%), but rewarding upfront commitment builds goodwill and eliminates all future payment management.

**Tier 3:**
"Finance Your Project (Klarna/Afterpay)"
Price: $[basePrice] (this IS the base price — no discount, no surcharge)
Example on a $5,000 job: **$5,000**
Display: "Standard price. Pay over time with Klarna or Afterpay. As low as $[monthlyEstimate]/mo."
How it works: Customer selects Klarna or Afterpay at checkout through Stripe. They get approved instantly, split into installments (Klarna typically offers 4 payments or monthly plans). They pay Klarna over time. WE get paid 100% upfront by Stripe within 1-2 business days. Klarna assumes all collection risk.
Why this is base price (not surcharged): We get paid in full, upfront, with zero collection risk. Yes, Klarna's merchant fee (~5%) is higher than a single card charge (~2.9%), but we have NO payment management, NO auto-draw infrastructure needed, NO failed charge handling, and NO risk of non-payment. The operational simplicity and eliminated risk justifies absorbing the higher fee into our margin. The customer gets a great deal: standard price with the flexibility to pay over time. This makes financing MORE attractive than the payment plan, which is exactly what we want.

**Tier 4:**
"Payment Plan (50/40/10)"
Price: $[basePrice * (1 + paymentPlanSurchargePercent/100)]
Example on a $5,000 job at 3% surcharge: **$5,150**
Display: "Split into 3 payments. $[deposit] at signing, $[midpoint] at midpoint, $[completion] at completion."
How it works:
- Payment 1: 50% ($2,575) due at contract signing — charged immediately to card on file
- Payment 2: 40% ($2,060) due at project midpoint — auto-charged to card on file
- Payment 3: 10% ($515) due at job completion/final walkthrough — auto-charged to card on file
Why it costs more: This is the most expensive option for us to manage. We pay Stripe fees on 3 separate charges (~2.9% x 3). We carry collection risk if the card fails. We manage auto-draw infrastructure, payment reminders, retry logic, and potential disputes. Our cash is delayed and spread across the job lifecycle. The surcharge compensates for this real cost and risk.
CRITICAL: When the customer enters their card for the first payment, the system saves their payment method via Stripe (using Stripe Customer + SetupIntent). Payments 2 and 3 are auto-charged when the admin triggers midpoint and completion milestones. The customer authorizes this in the contract.

**WHY ONLY 4 TIERS (not 5):**

The old Tier 4 "Payment Plan by Check" is eliminated. Here's why: a payment plan by check means chasing physical checks on a schedule. There's no way to auto-draw. The customer has to remember, write a check, and get it to us. The risk of late/missed payments is highest, and the administrative cost of tracking and collecting is real. If a customer wants to pay by check, they should pay upfront (Tier 1) and get the best discount. If they want to spread payments out, they either finance (Tier 3, standard price) or go on a card payment plan (Tier 4, surcharge). No check-based payment plans.

**DISPLAY REQUIREMENTS:**

Each tier card must show:
- Tier name and description
- Total price (large, bold, unmistakable)
- Savings vs. base price (Tiers 1-2) or surcharge vs. base price (Tier 4)
- For Tier 3: monthly payment estimate from Klarna
- For Tier 4: complete 3-payment schedule with exact dollar amounts
- "Select This Option" button

The cheapest option (Tier 1) should be visually highlighted with a "Best Value" badge or border treatment. Tier 3 (financing) should be visually positioned as the "most popular" or "recommended for flexibility" option since it's the best balance of customer convenience and company economics.

When selected, the payment schedule summary must appear again in the contract before signing. The customer sees EXACTLY what they will be charged, when they will be charged, and confirms they authorize auto-charges where applicable.

**AUTO-DRAW PAYMENT SYSTEM (Tier 4 only):**

- At contract signing, save the customer's payment method using Stripe's SetupIntent API
- Create a Stripe Customer object linked to our Customer model
- Store the Stripe PaymentMethod ID on the Contract model
- When Payment 2 (midpoint) is due: the admin marks the job as "midpoint reached" in the app, which triggers an automatic charge to the saved payment method. Send a receipt via email and iMessage.
- When Payment 3 (completion) is due: the admin marks the job as "complete," which triggers the final charge. Send a receipt.
- If an auto-charge fails: send the customer a notification via email and iMessage with a link to update their payment method and manually pay. Retry once after 3 days. If still failed, flag for manual collection.
- The customer MUST explicitly authorize auto-charges in the contract language (see Contract section below).
- Send a 48-hour advance notice via iMessage before EVERY auto-charge. This is non-negotiable for customer trust and legal compliance.

**PricingConfig values for payments:**

```
upfront_cash_discount_percent: "8"
upfront_card_discount_percent: "4"
payment_plan_surcharge_percent: "3"
deposit_percent: "50"
midpoint_percent: "40"
completion_percent: "10"
```

**Contract Section (after payment selection):**

Display the full contract inline. This contract is the most important document in the business. It must be crystal clear, comprehensive, and protect the company while being fair and transparent to the homeowner. The customer must feel like they're dealing with the most professional, above-board company they've ever hired.

**THE CONTRACT MUST INCLUDE ALL OF THE FOLLOWING SECTIONS:**

**Section 1: Parties and Property**
- Full legal name and address of Westchase Painting Company LLC (contractor)
- Full name and address of customer (property owner)
- Property address where work will be performed
- Date of contract

**Section 2: Scope of Work**
- Complete description of all work to be performed (pulled from the approved estimate)
- Specific surfaces to be painted with approximate square footage
- Paint products to be used (brand, product line, sheen — e.g., "Sherwin-Williams Duration, Satin finish")
- Number of coats (default: 2 coats on all surfaces)
- All prep work included (pressure washing, scraping, sanding, caulking, patching, priming)
- Color selections (specific color names/numbers, or "to be selected by homeowner prior to start")
- What is explicitly NOT included in scope (e.g., "This contract does not include interior painting, carpentry work beyond minor wood rot repair, roof painting, or pool deck coating unless specifically listed above.")

**Section 3: Price and Payment Terms**
- Total contract price (specific to the payment tier they selected)
- The payment tier name they selected (e.g., "100% Upfront by Card" or "Payment Plan by Card 50/40/10")
- Complete payment schedule with exact dollar amounts and due dates:
  - For upfront tiers: "Total of $X,XXX due upon execution of this contract."
  - For payment plan tiers: "Payment 1: $X,XXX due upon execution of this contract. Payment 2: $X,XXX due upon contractor's notification that project has reached midpoint. Payment 3: $XXX due upon completion and final walkthrough."
- Statement: "The total contract price includes all labor, materials, equipment, and cleanup. There are no hidden fees."
- Statement: "Prices are valid for 30 days from the date of the estimate. After 30 days, pricing may be subject to revision based on material cost changes."

**Section 4: Payment Authorization and Auto-Charge Consent**
(For Tier 3 and Tier 4 only — auto-draw tiers)
- "By signing this contract and providing your payment method, you authorize Westchase Painting Company LLC to automatically charge the payment method on file for each scheduled payment as described in Section 3."
- "You will receive a notification via email and text message at least 48 hours before each scheduled auto-charge."
- "If an auto-charge fails, you will be notified immediately and given 3 business days to provide an updated payment method or arrange alternative payment."
- "You may update your payment method at any time by contacting us at [phone] or [email]."

**Section 5: Project Timeline**
- Estimated start date (or "within X business days of contract execution and deposit receipt")
- Estimated completion date (or "approximately X working days from start date")
- "All dates are estimates and subject to weather conditions. Exterior work cannot be performed during rain, within 24 hours of rain, or when temperatures are below 50°F or above 95°F."
- "Weather delays extend the completion date by the number of days lost to weather. The contractor will communicate any weather delays promptly."
- "Work will be performed Monday through Saturday, between the hours of 8:00 AM and 6:00 PM, unless otherwise agreed in writing."

**Section 6: Change Orders**
- "Any changes to the scope of work described in Section 2 must be agreed to in writing by both parties before the additional work begins."
- "Change orders may result in additional charges. The contractor will provide a written estimate for any change order before work begins. The customer must approve the estimate in writing (email, text, or signature) before the additional work is performed."
- "Change orders may extend the project timeline."
- "MARKUP ON CHANGE ORDERS: Additional work requested after contract execution will be priced at the contractor's then-current rates, which may include a [changeOrderMarkupPercent]% markup over original contract rates to account for schedule disruption, material re-ordering, and crew reallocation."
- "The contractor reserves the right to decline change order requests that fall outside the contractor's scope of expertise or that would require permits or licenses not held by the contractor."

**Section 7: Notice of Pre-Existing Conditions and Deficiencies**
- "During the course of work, the contractor may discover pre-existing conditions not visible during the initial inspection. These may include but are not limited to: hidden wood rot, structural damage, mold or mildew behind surfaces, previous improper repairs, lead-based paint (on homes built before 1978), moisture intrusion, stucco delamination, or insect damage."
- "If pre-existing conditions are discovered that affect the quality or durability of the paint job, the contractor will: (1) Stop work on the affected area, (2) Document the condition with photographs, (3) Notify the customer promptly in writing (email or text), (4) Provide a written estimate for any additional work required to address the condition."
- "The customer may choose to: (a) Authorize the additional work at the quoted price, (b) Decline the additional work and accept that the contractor's warranty may be limited or voided for the affected area, or (c) Hire a separate specialist to address the condition before painting resumes."
- "The contractor is not responsible for deficiencies or failures caused by pre-existing conditions that the customer declines to address."

**Section 8: Customer Responsibilities**
- "Provide clear access to all work areas. For exterior work, this includes moving vehicles from the driveway, relocating patio furniture, grills, and decorative items at least 4 feet from exterior walls, and trimming vegetation that contacts or overhangs surfaces to be painted."
- "Secure all pets during work hours."
- "Inform the contractor of any security systems, sprinkler systems, or outdoor lighting that may be affected by the work."
- "Select and approve all paint colors prior to the scheduled start date. Color selection delays may push the start date."
- "Be available (in person, by phone, or by email) for questions and approvals during the project."
- "Notify the contractor of any known hazards, including but not limited to: lead paint, asbestos, bee/wasp nests, loose railings, unstable surfaces, or aggressive animals."

**Section 9: Warranty**
- "The contractor warrants all workmanship for a period of [warrantyYears] years from the date of project completion."
- "During the warranty period, the contractor will repair, at no additional cost to the customer, any defects in workmanship including but not limited to: peeling, blistering, flaking, or uneven coverage that results from improper application by the contractor's crew."
- "This warranty does NOT cover: (a) Normal wear and tear, (b) Damage caused by the customer, third parties, pressure washing within 30 days of completion, impact, or vandalism, (c) Damage caused by acts of God including hurricanes, tropical storms, hail, flooding, or lightning, (d) Color fading due to UV exposure (this is a property of the paint, not the application), (e) Paint failure on surfaces where the customer declined recommended prep work or repairs, (f) Movement, settling, or cracking of the underlying structure, (g) Moisture intrusion from sources unrelated to the paint application."
- "Paint manufacturer warranties are separate from this workmanship warranty and are governed by the manufacturer's terms."

**Section 10: Insurance and Liability**
- "The contractor carries general liability insurance with limits of $1,000,000 per occurrence and $2,000,000 aggregate."
- "The contractor carries a surety bond for the protection of the customer."
- "The contractor is bonded and insured. Proof of insurance is available upon request."
- "The contractor's total liability under this contract shall not exceed the total contract price."
- "The contractor is not liable for: (a) Pre-existing conditions of the property, (b) Color variations between paint samples, swatches, digital color tools, and the final applied result (colors may appear different depending on lighting, surface texture, and surrounding colors), (c) Minor imperfections visible only under specific lighting conditions at close range, (d) Damage to landscaping, outdoor furniture, or other items not moved by the customer as requested in Section 8."

**Section 11: Subcontractor Disclosure**
- "Westchase Painting Company LLC may use independent subcontractors to perform some or all of the work described in this contract."
- "All subcontractors are vetted by the contractor and carry their own workers' compensation exemption or policy as required by Florida law."
- "The contractor remains fully responsible for the quality of all work performed, regardless of whether it is performed by the contractor's own personnel or by subcontractors."

**Section 12: Cancellation and Termination**
- "The customer may cancel this contract within 3 business days of signing for a full refund of any deposit paid."
- "After the 3-business-day cancellation period: If materials have not been ordered and work has not begun, the customer may cancel with a refund of the deposit minus a $250 administrative fee. If materials have been ordered or work has begun, the deposit is non-refundable. The customer will be responsible for the cost of any materials already purchased and labor already performed."
- "The contractor may terminate this contract if: (a) The customer fails to make scheduled payments within 5 business days of the due date, (b) The customer materially breaches any term of this contract, (c) Unsafe conditions are discovered that cannot be remedied."

**Section 13: Dispute Resolution**
- "In the event of a dispute arising under this contract, the parties agree to first attempt resolution through direct communication in good faith."
- "If direct resolution is unsuccessful within 15 days, the parties agree to mediation conducted by a mutually agreed-upon mediator in Hillsborough County, Florida. The cost of mediation shall be shared equally."
- "If mediation is unsuccessful, the parties agree to binding arbitration in Hillsborough County, Florida, in accordance with the rules of the American Arbitration Association. The prevailing party shall be entitled to recover reasonable attorney's fees and costs."

**Section 14: Governing Law**
- "This contract shall be governed by and construed in accordance with the laws of the State of Florida."
- "Venue for any legal proceedings shall be Hillsborough County, Florida."

**Section 15: Entire Agreement**
- "This contract constitutes the entire agreement between the parties and supersedes all prior discussions, negotiations, and agreements, whether written or oral."
- "No modification of this contract shall be valid unless made in writing and signed by both parties."
- "If any provision of this contract is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect."

**Section 16: Florida-Specific Notices**
- Florida Construction Lien Law notice (Florida Statutes 713.015): "ACCORDING TO FLORIDA'S CONSTRUCTION LIEN LAW (SECTIONS 713.001-713.37, FLORIDA STATUTES), THOSE WHO WORK ON YOUR PROPERTY OR PROVIDE MATERIALS AND SERVICES AND ARE NOT PAID IN FULL HAVE A RIGHT TO ENFORCE THEIR CLAIM FOR PAYMENT AGAINST YOUR PROPERTY. THIS CLAIM IS KNOWN AS A CONSTRUCTION LIEN."
- "THIS NOTICE IS REQUIRED BY FLORIDA LAW AND IS NOT AN INDICATION OF ANY PROBLEM WITH YOUR CONTRACT OR YOUR CONTRACTOR."

**Section 17: Signatures**
- E-signature fields for both customer and contractor
- Printed name fields
- Date (auto-filled)
- IP address capture (stored immutably for legal verification)
- Timestamp of signing

The signed contract, including all terms, the selected payment tier, the complete scope of work, and the customer's signature, must be stored immutably. Once signed, the contract terms CANNOT be edited. Store a complete snapshot at time of signing. Any changes require a written amendment (change order) signed by both parties.

### 5. Admin Settings (/settings)

**Pricing Configuration:**
- Display all PricingConfig values in categorized sections
- Editable fields for each value
- Save button per section
- Show "last updated" timestamp

**Company Info:**
- Company name, address, phone, email
- Logo upload
- Credentials/badges text
- Warranty terms
- Default contract terms (editable rich text)

**Integrations:**
- Stripe: API keys, webhook URL
- Resend: API key, from domain, from email
- Bloo.io: API key, phone number
- Claude API: API key

**Message Templates:**
- Estimate sent (email + SMS)
- Estimate reminder (email + SMS)
- Contract signed confirmation (email + SMS)
- Payment received (email + SMS)
- Job starting reminder (email + SMS)
- Job midpoint update (email + SMS)
- Job complete + review request (email + SMS)
- Each template has variables: {{customerFirstName}}, {{propertyAddress}}, {{estimateTotal}}, {{companyName}}, {{companyPhone}}, etc.

### 6. All Estimates (/estimates)

Table/list view of all estimates with:
- Search and filter (by status, date range, customer name, price range)
- Sort by date, price, status
- Quick actions: view, send, duplicate, delete
- Status chips with color coding

### 7. All Customers (/customers)

Customer list with:
- Search
- Each customer shows: name, phone, email, number of estimates, total revenue, last activity
- Click to view customer detail with all their properties, estimates, contracts, payments, and message history

---

## AI Prompt Engineering

### Estimate Analysis Prompt

The prompt sent to Claude for estimate generation must include:

```
System prompt:
You are an expert residential painting estimator for Westchase Painting Company, a premium painting contractor serving Tampa Bay, Florida. You specialize in stucco homes built in the 1990s-2000s in the Westchase, Oldsmar, South Tampa, and Town 'N Country areas.

Your job is to analyze property data and photos to generate accurate, professional painting estimates. You understand:
- Florida stucco exterior conditions (chalking, mildew, efflorescence, hairline cracks)
- Prep requirements for different surface conditions
- Material coverage rates for smooth, textured, and rough stucco
- Labor time for pressure washing, prep, priming, painting, and detail work
- Premium product specifications (Sherwin-Williams Duration, Emerald, SuperPaint lines)
- Tampa Bay pricing for residential painting services

When analyzing photos, look for:
- Paint failure types: peeling, flaking, chalking, alligatoring, blistering, fading
- Surface damage: cracks, holes, wood rot, water damage, stucco delamination
- Mildew or mold growth patterns
- Caulk failures around windows, doors, and joints
- Trim, fascia, and soffit condition
- Any conditions that affect product selection or prep requirements
- Safety concerns: height, access issues, obstacles

Always err on the side of thoroughness in prep assessment. Underbidding prep is the #1 margin killer in residential painting.

Respond with valid JSON only. No markdown, no backticks, no preamble.

The JSON schema for your response:
{
  "summary": {
    "totalMaterialCost": number,
    "totalLaborCost": number,
    "subtotal": number,
    "margin": number,
    "totalPrice": number,
    "estimatedDays": number,
    "crewSize": number
  },
  "lineItems": [
    {
      "category": "PREP|PAINT|PRIMER|TRIM|DETAIL|REPAIR|MATERIAL|OTHER",
      "description": "string",
      "quantity": number,
      "unit": "sqft|lf|hours|each|gallon|tube|roll",
      "unitCost": number,
      "totalCost": number
    }
  ],
  "materials": [
    {
      "product": "string",
      "quantity": number,
      "unit": "gallon|tube|roll|pack|each",
      "costPer": number,
      "totalCost": number
    }
  ],
  "photoAnalysis": [
    {
      "photoIndex": number,
      "findings": "string",
      "severity": "INFO|WARNING|CRITICAL",
      "affectsEstimate": boolean,
      "recommendation": "string"
    }
  ],
  "scopeOfWork": "string (customer-facing professional description, 2-3 paragraphs)",
  "flags": [
    {
      "type": "WARNING|RECOMMENDATION|UPSELL",
      "message": "string",
      "estimatedAdditionalCost": number | null
    }
  ],
  "timeline": {
    "estimatedDays": number,
    "weatherNote": "string (e.g., 'Weather permitting; Florida afternoon rain may extend timeline by 1 day')",
    "recommendedStartWindow": "string"
  }
}
```

The user message should include:
- All structured property and measurement data as JSON
- All notes and condition assessments
- The current PricingConfig values (so the AI uses correct rates)
- Photos attached as base64 images with their location tags and user notes

### PDF Generation Prompt

After the user approves the estimate, a second AI call generates the customer-facing content:

```
System prompt:
You are a professional copywriter for Westchase Painting Company by Noble. Generate polished, customer-facing content for a painting estimate document. Write in a warm, confident, professional tone. The homeowner should feel they're dealing with a premium, trustworthy company. Be specific about what's included. Use clear language, not jargon. Do not use em dashes. Do not use the word "merely" or "just" in a minimizing sense.

Given the estimate data, generate:
1. A professional scope of work description (2-3 paragraphs)
2. A brief "What's Included" section in paragraph form
3. A "Your Investment" section presenting the price clearly
4. A timeline description
5. Warranty summary
```

---

## Email Templates (Resend)

All emails from: estimates@westchasepainting.com (or will@westchasepainting.com)

**Estimate Delivery Email:**
Subject: "Your Painting Estimate for [address] — Westchase Painting Company"
Body: Clean, branded HTML email. Brief personal message from Will, a summary of the scope and price, and a prominent "View Your Estimate" button linking to the customer-facing page. Include company logo, phone number, and credentials in the footer.

**Estimate Reminder (3 days after sent, if not approved):**
Subject: "Following up on your estimate — [address]"
Body: Friendly check-in. "Just wanted to make sure you received your estimate and see if you have any questions." Include the view link again.

**Contract Signed Confirmation:**
Subject: "You're all set! — Westchase Painting Company"
Body: Confirmation of signed contract, payment received, and what happens next (scheduling).

---

## iMessage/RCS Templates (via Bloo.io)

All messages delivered as iMessage on iOS, RCS on Android. They should feel conversational and human. NOT robotic. NOT corporate. They should read like a real person texting.

**After estimate is sent:**
"Hey {{firstName}}, this is Will from Westchase Painting Company. I just sent over your estimate for {{address}} to your email. Take a look when you get a chance and let me know if you have any questions. Talk soon!"

**Estimate reminder (3 days, if not viewed):**
"Hey {{firstName}}, just checking in — did you get a chance to look at the estimate I sent over for {{address}}? Happy to hop on a quick call if you have any questions. No rush."

**After contract is signed:**
"Awesome, {{firstName}}! Got your signed contract and deposit for {{address}}. We're getting you on the schedule now. I'll reach out a couple days before we start to confirm everything. Thanks for trusting us with your home!"

**Day before job starts:**
"Hey {{firstName}}, quick heads up — our crew will be at {{address}} tomorrow morning. If you can make sure cars are out of the driveway and any patio furniture is pulled back from the walls, that would be awesome. We'll take great care of everything."

**Auto-charge 48-hour advance notice:**
"Hey {{firstName}}, heads up — your scheduled payment of ${{amount}} for {{address}} will be charged to your card on file on {{date}}. If you need to update your payment method, just reply to this message or call us. Thanks!"

**Payment receipt (auto-charge successful):**
"Hey {{firstName}}, payment of ${{amount}} received for {{address}}. Thanks! {{remainingPayments}} remaining."

**Payment failed notification:**
"Hey {{firstName}}, we tried to process your scheduled payment of ${{amount}} for {{address}} but it didn't go through. Could you give us a call at {{companyPhone}} or reply here so we can get it sorted? We'll try again in 3 days if we don't hear from you."

**Review request (job complete):**
"Hey {{firstName}}, your home looks amazing! We wrapped up at {{address}} and everything turned out great. Would you mind leaving us a quick Google review? It helps us a ton: {{googleReviewLink}}. Thanks for choosing Westchase Painting Company!"

---

## Additional Database Model: ChangeOrder

**ChangeOrder** — Tracks scope changes after contract signing
- id, contractId (relation), description, reason, additionalSurfaces (JSON), additionalMaterialCost, additionalLaborCost, markupPercent, additionalPrice (total with markup), status (enum: PROPOSED, CUSTOMER_NOTIFIED, APPROVED, DECLINED, COMPLETED), customerApprovalMethod (enum: EMAIL, TEXT, IN_APP_SIGNATURE), customerApprovalEvidence (text — screenshot, email copy, or signature data), proposedAt, approvedAt, completedAt, createdAt

Change orders are addenda to the original contract. They never modify the original contract. They create additional Payment records. The admin panel shows the original contract total plus all approved change order totals as the "adjusted contract value."

---

## Pricing Logic Deep Dive

The pricing engine is the financial brain of the app. It must be precise, auditable, and fully configurable from the admin panel. Here is the complete calculation logic:

### Step 1: Material Cost Calculation

For each surface in scope:
```
netPaintableArea = grossArea - windowDeductions - doorDeductions
gallonsNeeded = ceil(netPaintableArea / coverageRatePerGallon) * numberOfCoats
paintCost = gallonsNeeded * costPerGallon

primerNeeded = ceil(netPaintableArea / primerCoveragePerGallon) (only if priming is needed based on condition)
primerCost = primerNeeded * primerCostPerGallon

caulkTubes = ceil(totalLinearFeetOfJoints / 30) (approximately 30 linear feet per tube)
caulkCost = caulkTubes * caulkCostPerTube

tapeCost = ceil(numberOfWindows + numberOfDoors) * 0.5 * tapeCostPerRoll
miscSupplies = flatRate (sandpaper, plastic, drop cloths — estimate $50-$100 per job)
```

totalMaterialCost = sum of all material costs above

### Step 2: Labor Cost Calculation

For each surface in scope:
```
baseLaborCost = netPaintableArea * laborRatePerSqFt (rate varies by surface type)
adjustedLaborCost = baseLaborCost * prepConditionMultiplier (1.0 for good, 1.3 for fair, 1.7 for poor)
```

Additional labor items:
```
pressureWashLabor = totalExteriorSqFt * pressureWashRatePerSqFt
trimLabor = totalTrimLinearFeet * trimRatePerLinearFt
doorLabor = numberOfDoors * doorRateEach
garageDoorLabor = numberOfGarageDoors * garageDoorRateEach
fasciaLabor = fasciaLinearFeet * fasciaRatePerLinearFt
soffitLabor = soffitLinearFeet * soffitRatePerLinearFt
```

totalLaborCost = sum of all labor costs above

### Step 3: Base Price Calculation

```
subtotal = totalMaterialCost + totalLaborCost
targetMargin = targetGrossMarginPercent / 100
basePrice = subtotal / (1 - targetMargin)

// Apply minimum job price
if (basePrice < minimumJobPrice) basePrice = minimumJobPrice

// Apply small job surcharge
if (basePrice < smallJobSurchargeUnder) basePrice = basePrice + smallJobSurchargeAmount
```

The basePrice is the Tier 3 price (financing). All other tiers derive from it.

### Step 4: Tier Price Calculations

```
upfrontCashPrice = round(basePrice * (1 - upfrontCashDiscountPercent/100))
upfrontCardPrice = round(basePrice * (1 - upfrontCardDiscountPercent/100))
financePrice = basePrice (no adjustment — Klarna merchant fee absorbed into margin)
paymentPlanPrice = round(basePrice * (1 + paymentPlanSurchargePercent/100))
```

### Step 5: Payment Schedule Calculations

For Tier 4 (payment plan):
```
depositAmount = round(paymentPlanPrice * depositPercent/100)
midpointAmount = round(paymentPlanPrice * midpointPercent/100)
completionAmount = paymentPlanPrice - depositAmount - midpointAmount (remainder, prevents rounding issues)
```

For upfront tiers (Tier 1 and Tier 2): single payment = full tier price
For finance tier (Tier 3): single payment = full basePrice (Stripe/Klarna/Afterpay handles installments on their side)
For payment plan tier (Tier 4): three payments as calculated above

### Step 6: Change Order Pricing

```
changeOrderSubtotal = additionalMaterialCost + additionalLaborCost
changeOrderPrice = changeOrderSubtotal * (1 + changeOrderMarkupPercent/100)
```

### Pricing Validation Rules

- No estimate below $1,500 (minimumJobPrice)
- Material cost should be 15-25% of base price for a healthy margin. If outside this range, flag for review.
- Labor cost should be 25-40% of base price. If outside this range, flag for review.
- Gross margin should be 40-55%. If outside this range, flag for review.
- The AI estimates quantities; the pricing engine applies costs. Never let the AI set dollar amounts directly.

### Westchase Market Pricing Reality Check

These are reference ranges for Tampa Bay residential painting in 2026. The pricing engine should flag estimates that fall outside these ranges as potentially under- or over-bid:

Exterior repaint (single story, 1,500-2,500 sq ft stucco): $3,000-$5,500
Exterior repaint (two story, 2,500-3,500 sq ft stucco): $5,000-$8,500
Interior whole-home repaint (1,500-2,500 sq ft): $3,000-$6,000
Interior single room: $400-$800
Cabinet refinishing (kitchen): $3,000-$6,000
Deck/fence staining: $500-$2,500

---

## Internal Operations Policies (Admin Panel Reference)

These policies govern how the company operates. Store them in the database as editable text so the admin can modify them. Display relevant policies in the admin panel for reference.

**Sub-Contractor Payment Policy:**
- Subcontractors are paid within 7 business days of job completion
- Payment is 30-35% of the job contract price (configurable per sub)
- Payment is contingent on satisfactory completion of work and customer walkthrough approval
- Subcontractors must submit photos of completed work before payment is released
- Payment is via ACH bank transfer to the sub's LLC

**Material Procurement Policy:**
- All paint and primary materials purchased through Sherwin-Williams PRO+ account
- Materials ordered after deposit is received, never before
- Material costs are tracked per job for margin analysis
- Unused full containers may be returned to SW within 30 days for credit

**Quality Control Policy:**
- Every job gets a midpoint inspection (photos + brief walkthrough)
- Every job gets a final walkthrough with the customer before final payment
- Any touch-ups identified during walkthrough are completed before final payment is collected
- Photo documentation of every job: before, during, and after (minimum 10 photos per job)

**Review Collection Policy:**
- Review request sent via iMessage 24 hours after job completion
- Follow-up review request sent 5 days later if no review posted
- Goal: Google review on every completed job
- Never offer payment or discounts for reviews (violates Google TOS)

---

## Stripe Integration

- Use Stripe Checkout Sessions for initial payment collection (deposit or full upfront)
- Use Stripe Customer + SetupIntent to save payment methods for auto-draw on Tier 4 (payment plan)
- Enable Klarna and Afterpay as payment methods in Stripe Dashboard for Tier 3 (finance)
- For Tier 1 (upfront cash/check): no Stripe needed; contract signing triggers manual payment instructions
- For Tier 2 (upfront card): create Checkout Session for full upfrontCardPrice
- For Tier 3 (finance via Klarna/Afterpay): create Checkout Session for full basePrice with Klarna/Afterpay enabled as payment methods. We receive 100% from Stripe within 1-2 days.
- For Tier 4 (payment plan by card): create Checkout Session for deposit amount + SetupIntent to save card for future auto-charges on midpoint and completion payments
- Webhook handler for: checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, setup_intent.succeeded
- On successful payment: update Payment record, update Contract status, trigger confirmation email + iMessage
- Auto-charge flow: when admin triggers midpoint or completion payment, create a PaymentIntent using the saved PaymentMethod on the Stripe Customer. Handle failures with retry logic and customer notifications.

---

## PWA Requirements

- Manifest with app name "Noble Estimator", Westchase Painting Company icon, navy (#1a2744) theme color
- Service worker for offline capability (data entry and photo capture should work offline; sync when back online)
- "Add to Home Screen" prompt on first visit
- Camera access for photo capture
- GPS for auto-filling address (optional, nice-to-have)
- Works on iPad (primary device) and iPhone

---

## File Structure

```
/app
  /layout.tsx (root layout with auth check)
  /page.tsx (dashboard)
  /login/page.tsx
  /estimates
    /page.tsx (all estimates list)
    /new
      /page.tsx (multi-step new estimate wizard)
    /[id]
      /page.tsx (estimate detail)
      /edit/page.tsx
  /customers
    /page.tsx (all customers)
    /[id]/page.tsx (customer detail)
  /settings
    /page.tsx (admin settings — pricing, templates, integrations, policies)
  /view
    /[estimateId]
      /[token]/page.tsx (public customer-facing estimate + payment tiers + contract + signature + payment)
  /api
    /estimates (CRUD)
    /customers (CRUD)
    /change-orders (CRUD + approval)
    /ai
      /analyze (POST — runs the AI pipeline)
      /generate-pdf (POST — generates estimate PDF)
    /payments
      /create-checkout (POST — creates Stripe session)
      /charge-saved (POST — auto-charges saved payment method)
      /webhook (POST — Stripe webhook handler)
    /messages
      /send (POST — sends email via Resend or iMessage via Bloo)
    /settings (GET/PUT pricing config and policies)
/components
  /ui (reusable UI components)
  /estimates (estimate-specific components)
  /payments (payment tier selector, payment schedule display, auto-charge status)
  /contracts (contract renderer, signature pad, terms display)
  /layout (nav, sidebar, header)
  /forms (form components)
/lib
  /prisma.ts (Prisma client)
  /stripe.ts (Stripe client — checkout, saved methods, auto-charge)
  /resend.ts (Resend client)
  /bloo.ts (Bloo.io API client for iMessage/RCS)
  /ai.ts (Claude API client and prompt builders)
  /pricing.ts (pricing engine — calculates all 4 tiers, payment schedules, change order pricing)
  /pdf.ts (PDF generation)
  /auth.ts (auth config)
  /utils.ts
/prisma
  /schema.prisma
  /seed.ts (seeds PricingConfig defaults + default message templates + default policy text)
```

---

## What To Build First (Priority Order)

1. Database schema + Prisma setup + seed data (PricingConfig, message templates, policies)
2. Auth + basic layout with nav
3. Settings page (PricingConfig CRUD + policy editor + message template editor) — validates the data model
4. Pricing engine (lib/pricing.ts — all 4 tier calculations, payment schedules, change order pricing)
5. New Estimate wizard (Steps 1-4: data capture, measurements, photo upload)
6. AI integration (Step 5: analysis) wired to pricing engine
7. Estimate review page (Step 6: review, adjust, approve)
8. PDF generation
9. Customer-facing estimate page with 4 payment tier selector
10. Contract generation with all 17 sections + e-signature + IP capture
11. Stripe integration (checkout, saved methods, auto-charge, webhooks)
12. Auto-charge system (scheduled payments, advance notices, retry logic)
13. Email sending via Resend
14. iMessage/RCS via Bloo.io
15. Change order flow
16. Dashboard with stats
17. Customer list + detail pages
18. PWA configuration

---

## Summary

This app lets Will walk up to a house in Westchase, capture everything about the property in 15-20 minutes, hit a button, and have a professional AI-analyzed estimate ready to send to the homeowner within minutes. The homeowner receives a branded email and iMessage, views a polished estimate page, selects their payment option (with 100% upfront being the most incentivized), signs a comprehensive contract that protects both parties, and pays — all without Will touching a spreadsheet, writing a proposal in Word, or manually calculating anything.

The payment system automatically collects scheduled payments, sends advance notices, handles failures gracefully, and gives the customer total transparency on what they owe and when. The contract is the most thorough, fair, and protective document any painting customer in Tampa has ever signed. Every policy, every clause, every number is clear and agreed to before work begins.

It should feel seamless, premium, and trustworthy to the homeowner. And it should feel fast, accurate, and empowering to Will.

This is the foundation of the Noble CRM. Build it to last.

