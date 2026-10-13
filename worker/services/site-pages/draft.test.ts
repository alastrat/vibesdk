import { describe, expect, it } from 'vitest';
import { RateLimitExceededError } from 'shared/types/errors';
import { RateLimitType } from '../rate-limit/config';
import { PageCopyDraftError, draftPageCopy, type PageCopyCompleter } from './draft';

const REQUEST = { title: 'North Ridge', category: null, description: null, files: [] };
const GOOD = {
	tagline: 'A small online coffee store',
	about: ['Six coffees with tasting notes.'],
	features: ['Product grid', 'Cart drawer', 'Tasting notes'],
	includes: [{ name: 'Home', detail: 'Hero and product grid' }],
	madeFor: ['Roasters', 'Cafes'],
};

function completer(answers: unknown[]): { complete: PageCopyCompleter; calls: number[] } {
	const calls: number[] = [];
	return {
		calls,
		complete: async (messages) => {
			calls.push(messages.length);
			const answer = answers.shift();
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
}

describe('draftPageCopy', () => {
	it('returns valid text from the first answer', async () => {
		const { complete, calls } = completer([GOOD]);
		expect(await draftPageCopy(complete, REQUEST)).toEqual(GOOD);
		expect(calls).toEqual([2]);
	});

	it('asks once more, naming the broken rule, when the first answer breaks a limit', async () => {
		const { complete, calls } = completer([{ ...GOOD, features: ['one'] }, GOOD]);
		expect(await draftPageCopy(complete, REQUEST)).toEqual(GOOD);
		expect(calls).toEqual([2, 3]);
	});

	it('fails after two answers that break a limit', async () => {
		const { complete } = completer([{ ...GOOD, tagline: '' }, { ...GOOD, tagline: '' }]);
		await expect(draftPageCopy(complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
	});

	it('fails when the model call fails or returns nothing', async () => {
		await expect(draftPageCopy(completer([new Error('gateway down')]).complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
		await expect(draftPageCopy(completer([null, null]).complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
	});

	it('lets an out-of-credits error through unchanged, on the first call and on the corrective retry', async () => {
		const limit = new RateLimitExceededError('Daily credit limit reached', RateLimitType.LLM_CALLS);
		await expect(draftPageCopy(completer([limit]).complete, REQUEST)).rejects.toBe(limit);
		const retryLimit = new RateLimitExceededError('Daily credit limit reached', RateLimitType.LLM_CALLS);
		await expect(draftPageCopy(completer([{ ...GOOD, features: ['one'] }, retryLimit]).complete, REQUEST)).rejects.toBe(retryLimit);
	});
});
