/**
 * Credits from a step's real cost: ceil(list-price cost × 1.5 ÷ $0.001). Prices are turned into whole units of $0.0001
 * per 1M tokens, so the arithmetic is exact: credits = ceil(Σ tokens × units × 15 ÷ 10^8).
 */
import type { LanguageModelUsage } from 'ai';
import type { TokenPrices } from '../../agents/think/model-config';

export const CREDIT_USD = 0.001;
export const CREDIT_MARGIN = 1.5;
/** Older paths charged a flat cost per call; Sonnet's 8 matches its typical 136 credits a step. */
export const LEGACY_CREDIT_FACTOR = 17;

const UNITS_PER_USD = 10_000;
/** units × tokens × 15 ÷ 10^8 = (units ÷ 10^4 $) × (tokens ÷ 10^6) × 1.5 ÷ $0.001. */
const CREDIT_DIVISOR = 100_000_000;
const MARGIN_NUMERATOR = 15;

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
	return Math.floor((total * MARGIN_NUMERATOR + CREDIT_DIVISOR - 1) / CREDIT_DIVISOR);
}

/** An older call's flat cost in today's unit. */
export function legacyCallCredits(creditCost: number): number {
	return Math.ceil(creditCost * LEGACY_CREDIT_FACTOR);
}
