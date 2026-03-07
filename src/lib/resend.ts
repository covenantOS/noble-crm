// ============================================
// NOBLE ESTIMATOR — RESEND EMAIL CLIENT
// ============================================

import { Resend } from 'resend';

let resendInstance: Resend | null = null;
function getResend(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    resendInstance = new Resend(key);
  }
  return resendInstance;
}

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'estimates@mail.nobletampa.com';

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
}

export async function sendEmail(options: EmailOptions) {
    const { data, error } = await getResend().emails.send({
        from: options.from || `Westchase Painting Company <${DEFAULT_FROM}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        replyTo: options.replyTo || 'will@westchasepainting.com',
    });

    if (error) {
        throw new Error(`Email send failed: ${error.message}`);
    }

    return data;
}

// ============================================
// BRANDED EMAIL TEMPLATES
// ============================================

function wrapInBrandedTemplate(content: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Montserrat', Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #1a2744; padding: 32px; text-align: center; }
    .header img { height: 48px; }
    .header h1 { color: #c9a84c; font-size: 22px; margin: 12px 0 0; letter-spacing: 1px; }
    .header p { color: rgba(255,255,255,0.7); font-size: 12px; margin: 8px 0 0; letter-spacing: 0.5px; }
    .body { padding: 32px; color: #333; line-height: 1.6; font-size: 15px; }
    .body h2 { color: #1a2744; font-size: 20px; margin-top: 0; }
    .cta-button { display: inline-block; background: #c9a84c; color: #1a2744 !important; padding: 14px 32px; text-decoration: none; font-weight: bold; border-radius: 6px; margin: 16px 0; font-size: 16px; }
    .footer { background: #1a2744; padding: 24px 32px; text-align: center; color: rgba(255,255,255,0.6); font-size: 12px; }
    .footer a { color: #c9a84c; text-decoration: none; }
    .credentials { color: rgba(255,255,255,0.5); font-size: 11px; margin-top: 12px; line-height: 1.5; }
    .divider { border-top: 2px solid #c9a84c; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>WESTCHASE PAINTING COMPANY</h1>
      <p>BY NOBLE</p>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p><a href="tel:+18135550123">(813) 555-0123</a> &bull; <a href="mailto:will@westchasepainting.com">will@westchasepainting.com</a></p>
      <p><a href="https://westchasepainting.com">westchasepainting.com</a></p>
      <div class="credentials">
        Bonded &amp; Insured &bull; EPA Lead-Safe Certified Firm &bull; OSHA Safety Trained<br>
        PCA Member &bull; Sherwin-Williams PRO+ Partner
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function buildEstimateSentEmail(
    customerFirstName: string,
    propertyAddress: string,
    estimateTotal: string,
    estimateLink: string
): string {
    return wrapInBrandedTemplate(`
    <h2>Your Painting Estimate</h2>
    <p>Hi ${customerFirstName},</p>
    <p>Thank you for the opportunity to provide an estimate for your home at <strong>${propertyAddress}</strong>.</p>
    <p>I've put together a detailed proposal covering everything we discussed during the walk-through. The total for the project comes to <strong>${estimateTotal}</strong>.</p>
    <p>Click the button below to view your full estimate, including scope of work, payment options, and next steps.</p>
    <p style="text-align: center;">
      <a href="${estimateLink}" class="cta-button">View Your Estimate</a>
    </p>
    <p>If you have any questions, don't hesitate to call or text me at <a href="tel:+18135550123">(813) 555-0123</a>.</p>
    <div class="divider"></div>
    <p>Best,<br><strong>Will Noble</strong><br>Westchase Painting Company by Noble</p>
  `);
}

export function buildEstimateReminderEmail(
    customerFirstName: string,
    propertyAddress: string,
    estimateLink: string
): string {
    return wrapInBrandedTemplate(`
    <h2>Following Up on Your Estimate</h2>
    <p>Hi ${customerFirstName},</p>
    <p>I wanted to make sure you received your estimate for <strong>${propertyAddress}</strong> and see if you have any questions.</p>
    <p>You can view it anytime here:</p>
    <p style="text-align: center;">
      <a href="${estimateLink}" class="cta-button">View Your Estimate</a>
    </p>
    <p>I'm happy to walk through it with you over the phone or schedule a follow-up visit if you'd like to discuss any details.</p>
    <div class="divider"></div>
    <p>Best,<br><strong>Will Noble</strong><br>Westchase Painting Company by Noble</p>
  `);
}

export function buildContractSignedEmail(
    customerFirstName: string,
    propertyAddress: string
): string {
    return wrapInBrandedTemplate(`
    <h2>You're All Set!</h2>
    <p>Hi ${customerFirstName},</p>
    <p>We've received your signed contract and deposit for <strong>${propertyAddress}</strong>. You're officially on our schedule!</p>
    <p><strong>Here's what happens next:</strong></p>
    <ul>
      <li>We'll confirm your start date within the next few business days</li>
      <li>You'll receive a reminder the day before we begin</li>
      <li>Our crew will arrive ready to transform your home</li>
    </ul>
    <p>If you have any questions in the meantime, don't hesitate to reach out.</p>
    <div class="divider"></div>
    <p>Best,<br><strong>Will Noble</strong><br>Westchase Painting Company by Noble</p>
  `);
}

export function buildPaymentReceiptEmail(
    customerFirstName: string,
    propertyAddress: string,
    amount: string,
    paymentType: string
): string {
    return wrapInBrandedTemplate(`
    <h2>Payment Received</h2>
    <p>Hi ${customerFirstName},</p>
    <p>We've received your <strong>${paymentType}</strong> payment of <strong>${amount}</strong> for <strong>${propertyAddress}</strong>.</p>
    <p>Thank you!</p>
    <div class="divider"></div>
    <p>Best,<br><strong>Will Noble</strong><br>Westchase Painting Company by Noble</p>
  `);
}

export function buildPasswordResetEmail(userName: string, resetLink: string): string {
    return wrapInBrandedTemplate(`
    <h2>Reset Your Password</h2>
    <p>Hi ${userName},</p>
    <p>We received a request to reset your password for Noble Estimator.</p>
    <p style="text-align: center;">
      <a href="${resetLink}" class="cta-button">Reset Password</a>
    </p>
    <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    <div class="divider"></div>
    <p>Best,<br><strong>Westchase Painting Company by Noble</strong></p>
  `);
}

const resend = new Proxy({} as Resend, {
  get(_, prop) {
    return (getResend() as unknown as Record<string, unknown>)[prop as string];
  },
});
export { resend };
export default resend;
