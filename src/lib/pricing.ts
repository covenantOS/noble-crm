// ============================================
// NOBLE ESTIMATOR — PRICING ENGINE
// ============================================
// The financial brain of the app. All 4 tier calculations,
// payment schedules, change order pricing, and validation.

export interface PricingConfigMap {
    [key: string]: string;
}

export interface MaterialCalculation {
    product: string;
    quantity: number;
    unit: string;
    costPer: number;
    totalCost: number;
}

export interface LaborCalculation {
    description: string;
    area: number;
    rate: number;
    multiplier: number;
    totalCost: number;
}

export interface LineItem {
    category: 'PREP' | 'PAINT' | 'PRIMER' | 'TRIM' | 'DETAIL' | 'REPAIR' | 'MATERIAL' | 'OTHER';
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
    totalCost: number;
}

export interface TierPricing {
    upfrontCashPrice: number;
    upfrontCardPrice: number;
    financePrice: number;
    paymentPlanPrice: number;
    basePrice: number;
    cashSavings: number;
    cardSavings: number;
    planSurcharge: number;
}

export interface PaymentSchedule {
    depositAmount: number;
    midpointAmount: number;
    completionAmount: number;
    totalAmount: number;
}

export interface PricingSummary {
    totalMaterialCost: number;
    totalLaborCost: number;
    subtotal: number;
    targetMarginPercent: number;
    marginAmount: number;
    basePrice: number;
    tiers: TierPricing;
    paymentSchedule: PaymentSchedule;
    flags: PricingFlag[];
}

export interface PricingFlag {
    type: 'WARNING' | 'INFO' | 'ERROR';
    message: string;
}

export interface SurfaceMeasurement {
    surfaceType: string;
    description?: string;
    linearFeet?: number;
    height?: number;
    grossArea?: number;
    windowDeduction?: number;
    doorDeduction?: number;
    netPaintableArea?: number;
    coatsRequired?: number;
    condition?: 'GOOD' | 'FAIR' | 'POOR';
}

// Get a numeric value from the pricing config map
function getNum(config: PricingConfigMap, key: string, fallback: number = 0): number {
    const val = config[key];
    if (val === undefined) return fallback;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
}

// ============================================
// MATERIAL COST CALCULATION
// ============================================
export function calculateMaterialCosts(
    measurements: SurfaceMeasurement[],
    config: PricingConfigMap
): { materials: MaterialCalculation[]; totalMaterialCost: number } {
    const materials: MaterialCalculation[] = [];
    let totalPaintableArea = 0;
    let totalExteriorArea = 0;
    let totalInteriorArea = 0;
    let totalTrimLF = 0;
    let totalWindowsDoors = 0;

    for (const m of measurements) {
        const area = m.netPaintableArea || 0;
        totalPaintableArea += area;

        if (['EXTERIOR_WALL', 'FASCIA', 'SOFFIT'].includes(m.surfaceType)) {
            totalExteriorArea += area;
        } else if (['INTERIOR_WALL', 'CEILING', 'ACCENT_WALL'].includes(m.surfaceType)) {
            totalInteriorArea += area;
        }
        if (m.surfaceType === 'TRIM') {
            totalTrimLF += m.linearFeet || 0;
        }
        totalWindowsDoors += (m.windowDeduction || 0) / 15 + (m.doorDeduction || 0) / 21;
    }

    // Paint calculation
    const coverageRate = totalExteriorArea > 0
        ? getNum(config, 'paint_coverage_rough_stucco_sqft_per_gallon', 250)
        : getNum(config, 'paint_coverage_smooth_sqft_per_gallon', 400);

    const defaultCoats = getNum(config, 'default_coats', 2);
    const gallonsNeeded = Math.ceil(totalPaintableArea / coverageRate) * defaultCoats;
    const paintCostPerGallon = getNum(config, 'paint_cost_per_gallon_premium', 55);

    if (gallonsNeeded > 0) {
        materials.push({
            product: 'Sherwin-Williams Duration (Premium)',
            quantity: gallonsNeeded,
            unit: 'gallon',
            costPer: paintCostPerGallon,
            totalCost: gallonsNeeded * paintCostPerGallon,
        });
    }

    // Primer calculation (for surfaces in fair or poor condition)
    const surfacesNeedingPrimer = measurements.filter(
        m => m.condition === 'FAIR' || m.condition === 'POOR'
    );
    const primerArea = surfacesNeedingPrimer.reduce((sum, m) => sum + (m.netPaintableArea || 0), 0);
    const primerCoverage = getNum(config, 'primer_coverage_sqft_per_gallon', 350);
    const primerGallons = Math.ceil(primerArea / primerCoverage);
    const primerCost = getNum(config, 'primer_cost_per_gallon', 35);

    if (primerGallons > 0) {
        materials.push({
            product: 'Primer',
            quantity: primerGallons,
            unit: 'gallon',
            costPer: primerCost,
            totalCost: primerGallons * primerCost,
        });
    }

    // Caulk calculation (approx 30 linear feet per tube)
    const jointLF = totalTrimLF + totalWindowsDoors * 10;
    const caulkTubes = Math.ceil(jointLF / 30);
    const caulkCost = getNum(config, 'caulk_cost_per_tube', 6);

    if (caulkTubes > 0) {
        materials.push({
            product: 'Caulk',
            quantity: caulkTubes,
            unit: 'tube',
            costPer: caulkCost,
            totalCost: caulkTubes * caulkCost,
        });
    }

    // Tape
    const tapeRolls = Math.ceil(totalWindowsDoors * 0.5);
    const tapeCost = getNum(config, 'painters_tape_cost_per_roll', 7);

    if (tapeRolls > 0) {
        materials.push({
            product: "Painter's Tape",
            quantity: tapeRolls,
            unit: 'roll',
            costPer: tapeCost,
            totalCost: tapeRolls * tapeCost,
        });
    }

    // Misc supplies (flat rate per job)
    const miscCost = totalPaintableArea > 2000 ? 100 : 50;
    materials.push({
        product: 'Misc Supplies (drop cloths, sandpaper, plastic)',
        quantity: 1,
        unit: 'each',
        costPer: miscCost,
        totalCost: miscCost,
    });

    const totalMaterialCost = materials.reduce((sum, m) => sum + m.totalCost, 0);

    return { materials, totalMaterialCost };
}

// ============================================
// LABOR COST CALCULATION
// ============================================
export function calculateLaborCosts(
    measurements: SurfaceMeasurement[],
    config: PricingConfigMap
): { laborItems: LaborCalculation[]; totalLaborCost: number } {
    const laborItems: LaborCalculation[] = [];

    const getConditionMultiplier = (condition?: string): number => {
        switch (condition) {
            case 'POOR': return getNum(config, 'prep_multiplier_poor_condition', 1.7);
            case 'FAIR': return getNum(config, 'prep_multiplier_fair_condition', 1.3);
            default: return getNum(config, 'prep_multiplier_good_condition', 1.0);
        }
    };

    const getLaborRate = (surfaceType: string): { rate: number; unit: string } => {
        switch (surfaceType) {
            case 'EXTERIOR_WALL': return { rate: getNum(config, 'labor_rate_exterior_stucco_per_sqft', 1.25), unit: 'sqft' };
            case 'INTERIOR_WALL': return { rate: getNum(config, 'labor_rate_interior_walls_per_sqft', 0.85), unit: 'sqft' };
            case 'CEILING': return { rate: getNum(config, 'labor_rate_interior_ceiling_per_sqft', 0.95), unit: 'sqft' };
            case 'TRIM': return { rate: getNum(config, 'labor_rate_trim_per_linear_ft', 2.50), unit: 'lf' };
            case 'FASCIA': return { rate: getNum(config, 'labor_rate_fascia_per_linear_ft', 3.00), unit: 'lf' };
            case 'SOFFIT': return { rate: getNum(config, 'labor_rate_soffit_per_linear_ft', 2.75), unit: 'lf' };
            case 'DOOR': return { rate: getNum(config, 'labor_rate_door_each', 85), unit: 'each' };
            case 'GARAGE_DOOR': return { rate: getNum(config, 'labor_rate_garage_door_each', 150), unit: 'each' };
            case 'ACCENT_WALL': return { rate: getNum(config, 'labor_rate_interior_walls_per_sqft', 0.85), unit: 'sqft' };
            case 'CABINET': return { rate: getNum(config, 'labor_rate_interior_walls_per_sqft', 0.85) * 2, unit: 'sqft' }; // Cabinets take ~2x
            case 'FENCE': return { rate: getNum(config, 'labor_rate_exterior_wood_per_sqft', 1.50), unit: 'sqft' };
            case 'DECK': return { rate: getNum(config, 'labor_rate_exterior_wood_per_sqft', 1.50), unit: 'sqft' };
            case 'SHUTTERS': return { rate: getNum(config, 'labor_rate_door_each', 85) * 0.5, unit: 'each' };
            default: return { rate: getNum(config, 'labor_rate_exterior_stucco_per_sqft', 1.25), unit: 'sqft' };
        }
    };

    let totalExteriorSqFt = 0;

    for (const m of measurements) {
        const { rate, unit } = getLaborRate(m.surfaceType);
        const multiplier = getConditionMultiplier(m.condition);
        let area: number;

        if (unit === 'each') {
            area = m.linearFeet || 1; // For doors, use count
        } else if (unit === 'lf') {
            area = m.linearFeet || 0;
        } else {
            area = m.netPaintableArea || 0;
        }

        if (['EXTERIOR_WALL'].includes(m.surfaceType)) {
            totalExteriorSqFt += area;
        }

        const baseCost = area * rate;
        const adjustedCost = baseCost * multiplier;

        if (adjustedCost > 0) {
            laborItems.push({
                description: `${m.surfaceType.replace(/_/g, ' ')}${m.description ? ` — ${m.description}` : ''}`,
                area,
                rate,
                multiplier,
                totalCost: Math.round(adjustedCost * 100) / 100,
            });
        }
    }

    // Pressure washing (exterior only)
    if (totalExteriorSqFt > 0) {
        const pwRate = getNum(config, 'labor_rate_pressure_wash_per_sqft', 0.15);
        laborItems.push({
            description: 'Pressure Washing',
            area: totalExteriorSqFt,
            rate: pwRate,
            multiplier: 1.0,
            totalCost: Math.round(totalExteriorSqFt * pwRate * 100) / 100,
        });
    }

    const totalLaborCost = laborItems.reduce((sum, l) => sum + l.totalCost, 0);

    return { laborItems, totalLaborCost };
}

// ============================================
// FULL PRICING CALCULATION
// ============================================
export function calculateFullPricing(
    measurements: SurfaceMeasurement[],
    config: PricingConfigMap,
    aiOverrides?: { totalMaterialCost?: number; totalLaborCost?: number; lineItems?: LineItem[] }
): PricingSummary {
    const flags: PricingFlag[] = [];

    // Step 1 & 2: Calculate costs
    const { totalMaterialCost: calcMaterialCost } = calculateMaterialCosts(measurements, config);
    const { totalLaborCost: calcLaborCost } = calculateLaborCosts(measurements, config);

    const totalMaterialCost = aiOverrides?.totalMaterialCost ?? calcMaterialCost;
    const totalLaborCost = aiOverrides?.totalLaborCost ?? calcLaborCost;

    // Step 3: Base price with margin
    const subtotal = totalMaterialCost + totalLaborCost;
    const targetMarginPercent = getNum(config, 'target_gross_margin_percent', 50);
    const targetMargin = targetMarginPercent / 100;
    let basePrice = Math.round(subtotal / (1 - targetMargin));

    // Apply minimum job price
    const minimumJobPrice = getNum(config, 'minimum_job_price', 1500);
    if (basePrice < minimumJobPrice) {
        basePrice = minimumJobPrice;
        flags.push({
            type: 'INFO',
            message: `Price adjusted to minimum job price of $${minimumJobPrice.toLocaleString()}`,
        });
    }

    // Apply small job surcharge
    const smallJobThreshold = getNum(config, 'small_job_surcharge_under', 2000);
    const smallJobSurcharge = getNum(config, 'small_job_surcharge_amount', 250);
    if (basePrice < smallJobThreshold) {
        basePrice += smallJobSurcharge;
        flags.push({
            type: 'INFO',
            message: `Small job surcharge of $${smallJobSurcharge} applied (job under $${smallJobThreshold.toLocaleString()})`,
        });
    }

    // Step 4: Tier calculations
    const cashDiscountPct = getNum(config, 'upfront_cash_discount_percent', 8);
    const cardDiscountPct = getNum(config, 'upfront_card_discount_percent', 4);
    const planSurchargePct = getNum(config, 'payment_plan_surcharge_percent', 3);

    const upfrontCashPrice = Math.round(basePrice * (1 - cashDiscountPct / 100));
    const upfrontCardPrice = Math.round(basePrice * (1 - cardDiscountPct / 100));
    const financePrice = basePrice;
    const paymentPlanPrice = Math.round(basePrice * (1 + planSurchargePct / 100));

    const tiers: TierPricing = {
        basePrice,
        upfrontCashPrice,
        upfrontCardPrice,
        financePrice,
        paymentPlanPrice,
        cashSavings: basePrice - upfrontCashPrice,
        cardSavings: basePrice - upfrontCardPrice,
        planSurcharge: paymentPlanPrice - basePrice,
    };

    // Step 5: Payment schedule (for Tier 4)
    const depositPct = getNum(config, 'deposit_percent', 50);
    const midpointPct = getNum(config, 'midpoint_percent', 40);

    const depositAmount = Math.round(paymentPlanPrice * depositPct / 100);
    const midpointAmount = Math.round(paymentPlanPrice * midpointPct / 100);
    const completionAmount = paymentPlanPrice - depositAmount - midpointAmount;

    const paymentSchedule: PaymentSchedule = {
        depositAmount,
        midpointAmount,
        completionAmount,
        totalAmount: paymentPlanPrice,
    };

    // Validation flags
    const materialRatio = totalMaterialCost / basePrice;
    if (materialRatio < 0.15 || materialRatio > 0.25) {
        flags.push({
            type: 'WARNING',
            message: `Material cost is ${(materialRatio * 100).toFixed(1)}% of price (expected 15-25%). Review for accuracy.`,
        });
    }

    const laborRatio = totalLaborCost / basePrice;
    if (laborRatio < 0.25 || laborRatio > 0.40) {
        flags.push({
            type: 'WARNING',
            message: `Labor cost is ${(laborRatio * 100).toFixed(1)}% of price (expected 25-40%). Review for accuracy.`,
        });
    }

    const actualMargin = (basePrice - subtotal) / basePrice;
    if (actualMargin < 0.40 || actualMargin > 0.55) {
        flags.push({
            type: 'WARNING',
            message: `Gross margin is ${(actualMargin * 100).toFixed(1)}% (target 40-55%). Review pricing.`,
        });
    }

    return {
        totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        targetMarginPercent,
        marginAmount: Math.round((basePrice - subtotal) * 100) / 100,
        basePrice,
        tiers,
        paymentSchedule,
        flags,
    };
}

// ============================================
// CHANGE ORDER PRICING
// ============================================
export function calculateChangeOrderPrice(
    additionalMaterialCost: number,
    additionalLaborCost: number,
    config: PricingConfigMap
): { subtotal: number; markupPercent: number; totalPrice: number } {
    const markupPercent = getNum(config, 'change_order_markup_percent', 15);
    const subtotal = additionalMaterialCost + additionalLaborCost;
    const totalPrice = Math.round(subtotal * (1 + markupPercent / 100));

    return { subtotal, markupPercent, totalPrice };
}

// ============================================
// MARKET PRICE VALIDATION
// ============================================
export function validateMarketPricing(
    scopeType: string,
    totalSqFt: number,
    stories: number,
    basePrice: number
): PricingFlag[] {
    const flags: PricingFlag[] = [];

    if (scopeType === 'EXTERIOR' || scopeType === 'BOTH') {
        let minRange: number, maxRange: number;
        if (stories <= 1 && totalSqFt <= 2500) {
            minRange = 3000; maxRange = 5500;
        } else {
            minRange = 5000; maxRange = 8500;
        }

        if (basePrice < minRange * 0.8) {
            flags.push({
                type: 'WARNING',
                message: `Exterior price of $${basePrice.toLocaleString()} is below typical Tampa Bay range ($${minRange.toLocaleString()}-$${maxRange.toLocaleString()}). May be underbid.`,
            });
        } else if (basePrice > maxRange * 1.2) {
            flags.push({
                type: 'WARNING',
                message: `Exterior price of $${basePrice.toLocaleString()} is above typical Tampa Bay range ($${minRange.toLocaleString()}-$${maxRange.toLocaleString()}). May be overbid.`,
            });
        }
    }

    if (scopeType === 'INTERIOR' || scopeType === 'BOTH') {
        const minRange = 3000;
        const maxRange = 6000;

        if (basePrice < minRange * 0.8) {
            flags.push({
                type: 'WARNING',
                message: `Interior price of $${basePrice.toLocaleString()} is below typical range. Review for accuracy.`,
            });
        }
    }

    return flags;
}

// ============================================
// FORMAT HELPERS
// ============================================
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatCurrencyDetailed(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}
