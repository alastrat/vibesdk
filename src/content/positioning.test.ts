import { describe, expect, it } from 'vitest';
import { pricingFaq } from './positioning';

const RATES = [16, 16, 136, 445];

function answer(billing: boolean, question: string, rates: readonly number[] = RATES) {
	return pricingFaq(billing, rates).find((item) => item.question === question)?.answer;
}

describe('the pricing questions', () => {
	it('answers from the plans, the extra-credits table and the model rates once billing is on', () => {
		expect(pricingFaq(true, RATES).map((item) => item.question)).toEqual([
			'What are AI credits?',
			'What happens when I run out of credits?',
			'Can I buy more credits?',
			'Can I change or cancel my plan?',
			'Do unused credits roll over?',
		]);
		expect(answer(true, 'What are AI credits?')).toBe(
			"Credits pay for the AI's work. Each step is charged from the work it really does, at the price of the model you pick, so lighter models go further. A typical step takes about 16 to 445 credits.",
		);
		expect(answer(true, 'Can I buy more credits?')).toBe("On Premium, yes: $1.50 per 1,000, from 5,000 at a time. They're used after your monthly credits and last 12 months.");
		expect(answer(true, 'Do unused credits roll over?')).toBe("Monthly credits don't; extra credits you buy do, for 12 months.");
	});

	it('leaves the step range out until the platform publishes its models', () => {
		expect(answer(true, 'What are AI credits?', [])).toBe("Credits pay for the AI's work. Each step is charged from the work it really does, at the price of the model you pick, so lighter models go further.");
	});

	it("keeps today's answers, and says Pro and Premium are coming, while billing is off", () => {
		expect(pricingFaq(false, RATES).map((item) => item.question)).toEqual(['What are AI credits?', 'What happens when I run out of credits?', 'Are Pro and Premium available now?', 'Do unused credits roll over?']);
		expect(answer(false, 'Are Pro and Premium available now?')).toBe("Not yet, they're coming soon. Tell us what you need and we'll set you up as they open.");
		expect(answer(false, 'Do unused credits roll over?')).toBe("No. Basic's allowance refills every day.");
	});
});
