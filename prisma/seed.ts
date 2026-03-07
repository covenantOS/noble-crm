import { PrismaClient, PricingCategory, MessageChannel } from '@prisma/client';
import { scryptSync } from 'crypto';

const prisma = new PrismaClient();

const AUTH_SALT = process.env.AUTH_PASSWORD_SALT || 'noble-estimator-default-salt-change-in-production';
function hashPassword(password: string): string {
  return scryptSync(password, AUTH_SALT, 64).toString('hex');
}

async function main() {
  console.log('🌱 Seeding database...');

  // ========================
  // PRICING CONFIG
  // ========================
  const pricingConfigs = [
    // MATERIAL
    { key: 'paint_cost_per_gallon_premium', value: '55', category: PricingCategory.MATERIAL, label: 'Premium Paint Cost/Gallon', description: 'Sherwin-Williams Duration' },
    { key: 'paint_cost_per_gallon_standard', value: '42', category: PricingCategory.MATERIAL, label: 'Standard Paint Cost/Gallon', description: 'Sherwin-Williams SuperPaint' },
    { key: 'primer_cost_per_gallon', value: '35', category: PricingCategory.MATERIAL, label: 'Primer Cost/Gallon', description: null },
    { key: 'caulk_cost_per_tube', value: '6', category: PricingCategory.MATERIAL, label: 'Caulk Cost/Tube', description: null },
    { key: 'painters_tape_cost_per_roll', value: '7', category: PricingCategory.MATERIAL, label: 'Painters Tape Cost/Roll', description: null },
    { key: 'plastic_sheeting_cost_per_roll', value: '15', category: PricingCategory.MATERIAL, label: 'Plastic Sheeting Cost/Roll', description: null },
    { key: 'sandpaper_cost_per_pack', value: '12', category: PricingCategory.MATERIAL, label: 'Sandpaper Cost/Pack', description: null },
    { key: 'wood_filler_cost_per_quart', value: '14', category: PricingCategory.MATERIAL, label: 'Wood Filler Cost/Quart', description: null },
    
    // LABOR
    { key: 'labor_rate_exterior_stucco_per_sqft', value: '1.25', category: PricingCategory.LABOR, label: 'Exterior Stucco Labor/sqft', description: 'Includes prep, prime spots, 2 coats' },
    { key: 'labor_rate_exterior_wood_per_sqft', value: '1.50', category: PricingCategory.LABOR, label: 'Exterior Wood Labor/sqft', description: null },
    { key: 'labor_rate_interior_walls_per_sqft', value: '0.85', category: PricingCategory.LABOR, label: 'Interior Walls Labor/sqft', description: null },
    { key: 'labor_rate_interior_ceiling_per_sqft', value: '0.95', category: PricingCategory.LABOR, label: 'Interior Ceiling Labor/sqft', description: null },
    { key: 'labor_rate_trim_per_linear_ft', value: '2.50', category: PricingCategory.LABOR, label: 'Trim Labor/linear ft', description: null },
    { key: 'labor_rate_door_each', value: '85', category: PricingCategory.LABOR, label: 'Door Labor/each', description: null },
    { key: 'labor_rate_garage_door_each', value: '150', category: PricingCategory.LABOR, label: 'Garage Door Labor/each', description: null },
    { key: 'labor_rate_fascia_per_linear_ft', value: '3.00', category: PricingCategory.LABOR, label: 'Fascia Labor/linear ft', description: null },
    { key: 'labor_rate_soffit_per_linear_ft', value: '2.75', category: PricingCategory.LABOR, label: 'Soffit Labor/linear ft', description: null },
    { key: 'labor_rate_pressure_wash_per_sqft', value: '0.15', category: PricingCategory.LABOR, label: 'Pressure Wash Labor/sqft', description: null },
    { key: 'labor_rate_wood_rot_repair_per_hour', value: '65', category: PricingCategory.LABOR, label: 'Wood Rot Repair/hour', description: null },
    { key: 'labor_rate_caulking_per_linear_ft', value: '1.50', category: PricingCategory.LABOR, label: 'Caulking Labor/linear ft', description: null },
    { key: 'labor_rate_scraping_per_sqft', value: '0.75', category: PricingCategory.LABOR, label: 'Scraping Labor/sqft', description: null },
    { key: 'prep_multiplier_good_condition', value: '1.0', category: PricingCategory.LABOR, label: 'Prep Multiplier: Good', description: null },
    { key: 'prep_multiplier_fair_condition', value: '1.3', category: PricingCategory.LABOR, label: 'Prep Multiplier: Fair', description: null },
    { key: 'prep_multiplier_poor_condition', value: '1.7', category: PricingCategory.LABOR, label: 'Prep Multiplier: Poor', description: null },
    
    // MARKUP
    { key: 'target_gross_margin_percent', value: '50', category: PricingCategory.MARKUP, label: 'Target Gross Margin %', description: null },
    { key: 'minimum_job_price', value: '1500', category: PricingCategory.MARKUP, label: 'Minimum Job Price', description: null },
    { key: 'small_job_surcharge_under', value: '2000', category: PricingCategory.MARKUP, label: 'Small Job Surcharge Threshold', description: 'Jobs under this amount get a flat surcharge' },
    { key: 'small_job_surcharge_amount', value: '250', category: PricingCategory.MARKUP, label: 'Small Job Surcharge Amount', description: null },
    
    // PAYMENT
    { key: 'upfront_cash_discount_percent', value: '8', category: PricingCategory.PAYMENT, label: 'Upfront Cash Discount %', description: null },
    { key: 'upfront_card_discount_percent', value: '4', category: PricingCategory.PAYMENT, label: 'Upfront Card Discount %', description: null },
    { key: 'payment_plan_surcharge_percent', value: '3', category: PricingCategory.PAYMENT, label: 'Payment Plan Surcharge %', description: null },
    { key: 'change_order_markup_percent', value: '15', category: PricingCategory.PAYMENT, label: 'Change Order Markup %', description: null },
    { key: 'deposit_percent', value: '50', category: PricingCategory.PAYMENT, label: 'Deposit %', description: null },
    { key: 'midpoint_percent', value: '40', category: PricingCategory.PAYMENT, label: 'Midpoint Payment %', description: null },
    { key: 'completion_percent', value: '10', category: PricingCategory.PAYMENT, label: 'Completion Payment %', description: null },
    
    // COVERAGE
    { key: 'paint_coverage_smooth_sqft_per_gallon', value: '400', category: PricingCategory.COVERAGE, label: 'Smooth Surface Coverage/gal', description: null },
    { key: 'paint_coverage_textured_sqft_per_gallon', value: '300', category: PricingCategory.COVERAGE, label: 'Textured Surface Coverage/gal', description: null },
    { key: 'paint_coverage_rough_stucco_sqft_per_gallon', value: '250', category: PricingCategory.COVERAGE, label: 'Rough Stucco Coverage/gal', description: null },
    { key: 'primer_coverage_sqft_per_gallon', value: '350', category: PricingCategory.COVERAGE, label: 'Primer Coverage/gal', description: null },
    
    // OTHER
    { key: 'default_warranty_years', value: '2', category: PricingCategory.OTHER, label: 'Default Warranty Years', description: null },
    { key: 'default_coats', value: '2', category: PricingCategory.OTHER, label: 'Default Number of Coats', description: null },
    { key: 'sales_tax_rate', value: '0', category: PricingCategory.OTHER, label: 'Sales Tax Rate', description: 'No sales tax on labor in FL, materials tax included in cost' },
  ];

  for (const config of pricingConfigs) {
    await prisma.pricingConfig.upsert({
      where: { key: config.key },
      update: { value: config.value, category: config.category, label: config.label, description: config.description },
      create: config,
    });
  }

  console.log(`✅ Seeded ${pricingConfigs.length} pricing configurations`);

  // ========================
  // MESSAGE TEMPLATES
  // ========================
  const messageTemplates = [
    {
      key: 'estimate_sent_imessage',
      name: 'Estimate Sent (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, this is Will from Westchase Painting Company. I just sent over your estimate for {{propertyAddress}} to your email. Take a look when you get a chance and let me know if you have any questions. Talk soon!',
      variables: ['customerFirstName', 'propertyAddress'],
    },
    {
      key: 'estimate_sent_email',
      name: 'Estimate Sent (Email)',
      channel: MessageChannel.EMAIL,
      subject: 'Your Painting Estimate for {{propertyAddress}} — Westchase Painting Company',
      content: `Hi {{customerFirstName}},

Thank you for the opportunity to provide an estimate for your home at {{propertyAddress}}.

I've put together a detailed proposal covering everything we discussed during the walk-through. The total for the project comes to {{estimateTotal}}.

Click the button below to view your full estimate, including scope of work, payment options, and next steps.

{{estimateLink}}

If you have any questions, don't hesitate to call or text me at {{companyPhone}}.

Best,
Will Noble
Westchase Painting Company by Noble`,
      variables: ['customerFirstName', 'propertyAddress', 'estimateTotal', 'estimateLink', 'companyPhone'],
    },
    {
      key: 'estimate_reminder_imessage',
      name: 'Estimate Reminder (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, just checking in — did you get a chance to look at the estimate I sent over for {{propertyAddress}}? Happy to hop on a quick call if you have any questions. No rush.',
      variables: ['customerFirstName', 'propertyAddress'],
    },
    {
      key: 'estimate_reminder_email',
      name: 'Estimate Reminder (Email)',
      channel: MessageChannel.EMAIL,
      subject: 'Following up on your estimate — {{propertyAddress}}',
      content: `Hi {{customerFirstName}},

Just wanted to make sure you received your estimate for {{propertyAddress}} and see if you have any questions.

You can view it anytime here: {{estimateLink}}

I'm happy to walk through it with you over the phone or schedule a follow-up visit if you'd like to discuss any details.

Best,
Will Noble
Westchase Painting Company by Noble`,
      variables: ['customerFirstName', 'propertyAddress', 'estimateLink'],
    },
    {
      key: 'contract_signed_imessage',
      name: 'Contract Signed (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Awesome, {{customerFirstName}}! Got your signed contract and deposit for {{propertyAddress}}. We\'re getting you on the schedule now. I\'ll reach out a couple days before we start to confirm everything. Thanks for trusting us with your home!',
      variables: ['customerFirstName', 'propertyAddress'],
    },
    {
      key: 'contract_signed_email',
      name: 'Contract Signed (Email)',
      channel: MessageChannel.EMAIL,
      subject: 'You\'re all set! — Westchase Painting Company',
      content: `Hi {{customerFirstName}},

We've received your signed contract and deposit for {{propertyAddress}}. You're officially on our schedule!

Here's what happens next:
- We'll confirm your start date within the next few business days
- You'll receive a reminder the day before we begin
- Our crew will arrive ready to transform your home

If you have any questions in the meantime, don't hesitate to reach out.

Best,
Will Noble
Westchase Painting Company by Noble`,
      variables: ['customerFirstName', 'propertyAddress'],
    },
    {
      key: 'job_starting_imessage',
      name: 'Job Starting Reminder (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, quick heads up — our crew will be at {{propertyAddress}} tomorrow morning. If you can make sure cars are out of the driveway and any patio furniture is pulled back from the walls, that would be awesome. We\'ll take great care of everything.',
      variables: ['customerFirstName', 'propertyAddress'],
    },
    {
      key: 'auto_charge_notice_imessage',
      name: 'Auto-Charge 48hr Notice (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, heads up — your scheduled payment of ${{amount}} for {{propertyAddress}} will be charged to your card on file on {{date}}. If you need to update your payment method, just reply to this message or call us. Thanks!',
      variables: ['customerFirstName', 'amount', 'propertyAddress', 'date'],
    },
    {
      key: 'payment_receipt_imessage',
      name: 'Payment Receipt (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, payment of ${{amount}} received for {{propertyAddress}}. Thanks! {{remainingPayments}}',
      variables: ['customerFirstName', 'amount', 'propertyAddress', 'remainingPayments'],
    },
    {
      key: 'payment_failed_imessage',
      name: 'Payment Failed (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, we tried to process your scheduled payment of ${{amount}} for {{propertyAddress}} but it didn\'t go through. Could you give us a call at {{companyPhone}} or reply here so we can get it sorted? We\'ll try again in 3 days if we don\'t hear from you.',
      variables: ['customerFirstName', 'amount', 'propertyAddress', 'companyPhone'],
    },
    {
      key: 'review_request_imessage',
      name: 'Review Request (iMessage)',
      channel: MessageChannel.IMESSAGE,
      subject: null,
      content: 'Hey {{customerFirstName}}, your home looks amazing! We wrapped up at {{propertyAddress}} and everything turned out great. Would you mind leaving us a quick Google review? It helps us a ton: {{googleReviewLink}}. Thanks for choosing Westchase Painting Company!',
      variables: ['customerFirstName', 'propertyAddress', 'googleReviewLink'],
    },
  ];

  for (const template of messageTemplates) {
    await prisma.messageTemplate.upsert({
      where: { key: template.key },
      update: {
        name: template.name,
        channel: template.channel,
        subject: template.subject,
        content: template.content,
        variables: template.variables,
      },
      create: template,
    });
  }

  console.log(`✅ Seeded ${messageTemplates.length} message templates`);

  // ========================
  // COMPANY SETTINGS
  // ========================
  const companySettings = [
    { key: 'company_name', value: 'Westchase Painting Company by Noble' },
    { key: 'company_legal_name', value: 'Westchase Painting Company LLC' },
    { key: 'company_address', value: 'Tampa, FL' },
    { key: 'company_phone', value: '(813) 555-0123' },
    { key: 'company_email', value: 'will@servicelinepro.com' },
    { key: 'estimates_email', value: 'estimates@westchasepainting.com' },
    { key: 'company_website', value: 'https://westchasepainting.com' },
    { key: 'google_review_link', value: 'https://g.page/r/westchasepainting/review' },
    { key: 'credentials', value: 'Bonded & Insured | EPA Lead-Safe Certified Firm | OSHA Safety Trained | PCA Member | Sherwin-Williams PRO+ Partner' },
    { key: 'sub_payment_policy', value: 'Subcontractors are paid within 7 business days of job completion. Payment is 30-35% of the job contract price (configurable per sub). Payment is contingent on satisfactory completion of work and customer walkthrough approval. Subcontractors must submit photos of completed work before payment is released. Payment is via ACH bank transfer to the sub\'s LLC.' },
    { key: 'material_procurement_policy', value: 'All paint and primary materials purchased through Sherwin-Williams PRO+ account. Materials ordered after deposit is received, never before. Material costs are tracked per job for margin analysis. Unused full containers may be returned to SW within 30 days for credit.' },
    { key: 'quality_control_policy', value: 'Every job gets a midpoint inspection (photos + brief walkthrough). Every job gets a final walkthrough with the customer before final payment. Any touch-ups identified during walkthrough are completed before final payment is collected. Photo documentation of every job: before, during, and after (minimum 10 photos per job).' },
    { key: 'review_collection_policy', value: 'Review request sent via iMessage 24 hours after job completion. Follow-up review request sent 5 days later if no review posted. Goal: Google review on every completed job. Never offer payment or discounts for reviews (violates Google TOS).' },
  ];

  for (const setting of companySettings) {
    await prisma.companySettings.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log(`✅ Seeded ${companySettings.length} company settings`);

  // ========================
  // DEFAULT ADMIN USER
  // ========================
  // Default password: "password" — change in production
  const defaultPasswordHash = hashPassword('password');
  const adminExists = await prisma.user.findFirst({ where: { email: 'will@servicelinepro.com' } });
  if (!adminExists) {
    await prisma.user.create({
      data: {
        name: 'Will Noble',
        email: 'will@servicelinepro.com',
        phone: '(813) 555-0123',
        role: 'OWNER',
        passwordHash: defaultPasswordHash,
      },
    });
    console.log('✅ Created default admin user (email: will@servicelinepro.com, password: password)');
  } else {
    await prisma.user.update({
      where: { email: 'will@servicelinepro.com' },
      data: { passwordHash: defaultPasswordHash },
    });
    console.log('✅ Updated default admin user password (password: password)');
  }

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
