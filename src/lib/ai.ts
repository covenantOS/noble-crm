// ============================================
// NOBLE ESTIMATOR — AI CLIENT (Claude API)
// ============================================
// Handles all Claude API interactions: estimate analysis,
// photo analysis, and content generation.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// ============================================
// ESTIMATE ANALYSIS PROMPT
// ============================================
const ESTIMATE_ANALYSIS_SYSTEM_PROMPT = `You are an expert residential painting estimator for Westchase Painting Company, a premium painting contractor serving Tampa Bay, Florida. You specialize in stucco homes built in the 1990s-2000s in the Westchase, Oldsmar, South Tampa, and Town 'N Country areas.

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

Respond with valid JSON only. No markdown, no backticks, no preamble.`;

const ESTIMATE_ANALYSIS_SCHEMA = `{
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
    "weatherNote": "string",
    "recommendedStartWindow": "string"
  }
}`;

export interface EstimateAnalysisInput {
    property: {
        address: string;
        city: string;
        state: string;
        squareFootageInterior?: number;
        stories?: number;
        constructionType: string;
        yearBuilt?: number;
    };
    scopeType: string;
    surfaces: Array<{
        surfaceType: string;
        description?: string;
        condition: string;
        notes?: string;
    }>;
    measurements: Array<{
        surface: string;
        description?: string;
        linearFeet?: number;
        height?: number;
        grossArea?: number;
        windowDeduction?: number;
        doorDeduction?: number;
        netPaintableArea?: number;
        coatsRequired: number;
        notes?: string;
    }>;
    notes: string;
    pricingConfig: { [key: string]: string };
    photos?: Array<{
        base64: string;
        mediaType: string;
        location?: string;
        notes?: string;
    }>;
}

export interface EstimateAnalysisResult {
    summary: {
        totalMaterialCost: number;
        totalLaborCost: number;
        subtotal: number;
        margin: number;
        totalPrice: number;
        estimatedDays: number;
        crewSize: number;
    };
    lineItems: Array<{
        category: string;
        description: string;
        quantity: number;
        unit: string;
        unitCost: number;
        totalCost: number;
    }>;
    materials: Array<{
        product: string;
        quantity: number;
        unit: string;
        costPer: number;
        totalCost: number;
    }>;
    photoAnalysis: Array<{
        photoIndex: number;
        findings: string;
        severity: string;
        affectsEstimate: boolean;
        recommendation: string;
    }>;
    scopeOfWork: string;
    flags: Array<{
        type: string;
        message: string;
        estimatedAdditionalCost: number | null;
    }>;
    timeline: {
        estimatedDays: number;
        weatherNote: string;
        recommendedStartWindow: string;
    };
}

export async function analyzeEstimate(input: EstimateAnalysisInput): Promise<EstimateAnalysisResult> {
    const userMessage = `Analyze this property and generate an estimate.

PROPERTY DATA:
${JSON.stringify(input.property, null, 2)}

SCOPE: ${input.scopeType}

SURFACES IN SCOPE:
${JSON.stringify(input.surfaces, null, 2)}

MEASUREMENTS:
${JSON.stringify(input.measurements, null, 2)}

NOTES FROM ESTIMATOR:
${input.notes || 'No additional notes.'}

CURRENT PRICING CONFIG (use these rates):
${JSON.stringify(input.pricingConfig, null, 2)}

Respond with JSON matching this schema:
${ESTIMATE_ANALYSIS_SCHEMA}`;

    // Build content array with text and optional photos
    const content: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: userMessage },
    ];

    // Add photos if provided
    if (input.photos && input.photos.length > 0) {
        for (let i = 0; i < input.photos.length; i++) {
            const photo = input.photos[i];
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: photo.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: photo.base64,
                },
            });
            if (photo.location || photo.notes) {
                content.push({
                    type: 'text',
                    text: `Photo ${i + 1}: Location: ${photo.location || 'unspecified'}. Notes: ${photo.notes || 'none'}`,
                });
            }
        }
    }

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        system: ESTIMATE_ANALYSIS_SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content,
            },
        ],
    });

    // Extract text response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from AI');
    }

    try {
        // Clean potential markdown wrapping
        let jsonText = textBlock.text.trim();
        if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        return JSON.parse(jsonText) as EstimateAnalysisResult;
    } catch {
        throw new Error(`Failed to parse AI response as JSON: ${textBlock.text.substring(0, 200)}`);
    }
}

// ============================================
// SCOPE OF WORK GENERATION
// ============================================
const SCOPE_GENERATION_PROMPT = `You are a professional copywriter for Westchase Painting Company by Noble. Generate polished, customer-facing content for a painting estimate document. Write in a warm, confident, professional tone. The homeowner should feel they're dealing with a premium, trustworthy company. Be specific about what's included. Use clear language, not jargon. Do not use em dashes. Do not use the word "merely" or "just" in a minimizing sense.

Given the estimate data, generate a JSON response with:
{
  "scopeOfWork": "2-3 paragraph professional scope of work description",
  "whatsIncluded": "A brief 'What's Included' section in paragraph form",
  "yourInvestment": "A section presenting the price clearly",
  "timelineDescription": "A timeline description paragraph",
  "warrantySummary": "Warranty summary paragraph"
}

Respond with valid JSON only.`;

export async function generateScopeContent(estimateData: Record<string, unknown>): Promise<{
    scopeOfWork: string;
    whatsIncluded: string;
    yourInvestment: string;
    timelineDescription: string;
    warrantySummary: string;
}> {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: SCOPE_GENERATION_PROMPT,
        messages: [
            {
                role: 'user',
                content: `Generate customer-facing content for this estimate:\n${JSON.stringify(estimateData, null, 2)}`,
            },
        ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from AI');
    }

    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    return JSON.parse(jsonText);
}

export default anthropic;
