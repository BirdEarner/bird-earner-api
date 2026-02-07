export interface FeeBracket {
    minBudget?: number;
    maxBudget?: number;
    feeType: 'FIXED' | 'PERCENTAGE';
    feeValue: number | string;
}

export interface BirdFeeConfig {
    minimumBudget?: number;
    maximumBudget?: number;
    feeStructure: FeeBracket[];
}

export function calculateBirdFee(budget: number, config: any): number {
    const birdFeeConfig = config as BirdFeeConfig | null;
    if (!birdFeeConfig) {
        return 0;
    }

    const { feeStructure } = birdFeeConfig;

    if (!Array.isArray(feeStructure) || feeStructure.length === 0) {
        return 0;
    }

    // Find the applicable fee bracket
    const applicableBracket = feeStructure.find((bracket) => {
        const min = bracket.minBudget || 0;
        const max = bracket.maxBudget || Infinity;
        return budget >= min && budget <= max;
    });

    if (!applicableBracket) {
        // If no bracket found, default to the last one
        const lastBracket = feeStructure[feeStructure.length - 1];
        return applyFee(budget, lastBracket);
    }

    return applyFee(budget, applicableBracket);
}

function applyFee(budget: number, bracket: FeeBracket): number {
    if (!bracket) return 0;

    const { feeType, feeValue } = bracket;
    const value = typeof feeValue === 'string' ? parseFloat(feeValue) : feeValue;

    if (feeType === 'FIXED') {
        return value;
    } else if (feeType === 'PERCENTAGE') {
        return (budget * value) / 100;
    }

    return 0;
}
