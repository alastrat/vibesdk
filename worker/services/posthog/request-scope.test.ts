import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepAlive, runInRequestScope } from './request-scope';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the request scope', () => {
	it("hands work to the request's waitUntil, across awaits", async () => {
		const kept: Promise<unknown>[] = [];
		await runInRequestScope({ waitUntil: (work: Promise<unknown>) => kept.push(work) }, async () => {
			await Promise.resolve();
			keepAlive(Promise.resolve('sent'));
		});
		expect(kept).toHaveLength(1);
	});

	it('runs without a waitUntil, as controller tests pass {} and Durable Objects have no request', async () => {
		expect(runInRequestScope({} as ExecutionContext, () => 7)).toBe(7);
		expect(runInRequestScope(undefined, () => 8)).toBe(8);
		expect(() => keepAlive(Promise.reject(new Error('PostHog down')))).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it('never hands a rejecting promise to waitUntil', async () => {
		const kept: Promise<unknown>[] = [];
		runInRequestScope({ waitUntil: (work: Promise<unknown>) => kept.push(work) }, () => keepAlive(Promise.reject(new Error('boom'))));
		await expect(kept[0]).resolves.toBeUndefined();
	});

	it('never throws when waitUntil refuses the work, as after the response or outside a live request', () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const refuse = () => {
			throw new Error('waitUntil after the response');
		};
		runInRequestScope({ waitUntil: refuse }, () => {
			expect(() => keepAlive(Promise.resolve('sent'))).not.toThrow();
		});
		expect(warned).toHaveBeenCalledTimes(1);
	});
});
