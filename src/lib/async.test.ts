import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOAD_TIMEOUT_MS, LoadTimeoutError, loadWithin, singleFlight } from './async';

describe('running a task one at a time', () => {
	it('gives a call made while the task runs the running call, so a double click starts one request', async () => {
		let runs = 0;
		const press = singleFlight(async () => {
			runs += 1;
			await Promise.resolve();
			await Promise.resolve();
			return runs;
		});
		const first = press();
		const second = press();
		expect(await Promise.all([first, second])).toEqual([1, 1]);
		expect(runs).toBe(1);
		// Once the result is in, the next press runs.
		expect(await press()).toBe(2);
	});

	it('lets the next press through after a run that threw', async () => {
		let runs = 0;
		const press = singleFlight(async () => {
			runs += 1;
			if (runs === 1) throw new Error('first run fails');
		});
		await expect(press()).rejects.toThrow('first run fails');
		await press();
		expect(runs).toBe(2);
	});

	it('hands the arguments of the call that started the run to the task', async () => {
		const seen: string[] = [];
		const press = singleFlight(async (name: string) => {
			seen.push(name);
		});
		await Promise.all([press('first'), press('second')]);
		expect(seen).toEqual(['first']);
	});
});

describe('waiting for a load', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('gives a load ten seconds, then gives up', async () => {
		expect(LOAD_TIMEOUT_MS).toBe(10_000);
		const never = new Promise<string>(() => {});
		const settled = vi.fn();
		const waiting = loadWithin(never).catch((error: unknown) => settled(error));
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		expect(settled).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await waiting;
		expect(settled).toHaveBeenCalledWith(expect.any(LoadTimeoutError));
	});

	it('returns what loaded in time and leaves no timer behind', async () => {
		await expect(loadWithin(Promise.resolve('stripe'))).resolves.toBe('stripe');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('passes on a load that failed, and leaves no timer behind', async () => {
		await expect(loadWithin(Promise.reject(new Error('Stripe could not load')))).rejects.toThrow('Stripe could not load');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores a load that finishes after the time is up', async () => {
		let finish: (value: string) => void = () => {};
		const slow = new Promise<string>((resolve) => {
			finish = resolve;
		});
		const waiting = loadWithin(slow, 1_000);
		const outcome = waiting.then(
			() => 'loaded',
			(error: unknown) => (error instanceof LoadTimeoutError ? 'timed out' : 'other'),
		);
		await vi.advanceTimersByTimeAsync(1_000);
		finish('late');
		expect(await outcome).toBe('timed out');
	});
});
