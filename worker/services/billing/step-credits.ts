/**
 * Credits from a step's real cost: ceil(list-price cost × CREDIT_MARGIN ÷ CREDIT_USD). Prices are turned into whole units
 * of $0.0001 per 1M tokens and the margin into hundredths, so the arithmetic stays in integers:
 * credits = ceil(Σ tokens × units × CREDIT_NUMERATOR ÷ CREDIT_DIVISOR), both worked out from the two constants below.
 */
import type { LanguageModelUsage } from 'ai';
import { LEGACY_CREDIT_FACTOR } from '../../../shared/types/plans';
import type { TokenPrices } from '../../agents/think/model-config';

/** What one credit is worth in US dollars. */
export const CREDIT_USD = 0.001;
/** What a step costs in credits, as a multiple of the model's list-price cost. */
export const CREDIT_MARGIN = 1.5;

const UNITS_PER_USD = 10_000;
const TOKENS_PER_PRICE = 1_000_000;
const MARGIN_SCALE = 100;

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

/**
 * (units ÷ UNITS_PER_USD $) × (tokens ÷ TOKENS_PER_PRICE) × (CREDIT_MARGIN ÷ CREDIT_USD) as one fraction, reduced so the
 * products stay well inside Number's exact integer range.
 */
const FRACTION_NUMERATOR = Math.round(CREDIT_MARGIN * MARGIN_SCALE) * Math.round(1 / CREDIT_USD);
const FRACTION_DIVISOR = UNITS_PER_USD * TOKENS_PER_PRICE * MARGIN_SCALE;
const FRACTION_GCD = gcd(FRACTION_NUMERATOR, FRACTION_DIVISOR);
const CREDIT_NUMERATOR = FRACTION_NUMERATOR / FRACTION_GCD;
const CREDIT_DIVISOR = FRACTION_DIVISOR / FRACTION_GCD;

/** The token counts a provider reported for one step. Every field is optional because providers differ in what they send. */
export interface StepUsage {
	inputTokens?: number;
	noCacheInputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	outputTokens?: number;
	textTokens?: number;
	reasoningTokens?: number;
}

const units = (usd: number): number => Math.round(usd * UNITS_PER_USD);
const count = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The step's usage from the AI SDK, leaving out what the provider didn't report; null when it reported none. */
export function stepUsageFrom(usage: LanguageModelUsage | undefined): StepUsage | null {
	if (!usage) return null;
	const fields: StepUsage = {
		inputTokens: usage.inputTokens,
		noCacheInputTokens: usage.inputTokenDetails?.noCacheTokens,
		cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
		cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
		outputTokens: usage.outputTokens,
		textTokens: usage.outputTokenDetails?.textTokens,
		reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
	};
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** Credits for one step at `prices`; the model's `typical` step when the provider reported no tokens. */
export function stepCredits(prices: TokenPrices, usage: StepUsage | null, typical: number): number {
	if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.textTokens === undefined)) return typical;
	const cacheRead = count(usage.cacheReadTokens);
	const cacheWrite = count(usage.cacheWriteTokens);
	const fresh = usage.noCacheInputTokens !== undefined ? count(usage.noCacheInputTokens) : Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
	const output = usage.outputTokens !== undefined ? count(usage.outputTokens) : count(usage.textTokens) + count(usage.reasoningTokens);
	const total =
		fresh * units(prices.inputUsd) + cacheRead * units(prices.cacheReadUsd) + cacheWrite * units(prices.cacheWriteUsd) + output * units(prices.outputUsd);
	return Math.floor((total * CREDIT_NUMERATOR + CREDIT_DIVISOR - 1) / CREDIT_DIVISOR);
}

/** An older call's flat cost in today's unit. */
export function legacyCallCredits(creditCost: number): number {
	return Math.ceil(creditCost * LEGACY_CREDIT_FACTOR);
}
