import { describe, expect, it, vi } from 'vitest';
import { runCapture } from './capture-core';
import type { CapturePage, CapturePayload } from './types';

const STOP = 'Stopped by the user';

/**
 * A page whose navigation stays in flight until `finishNavigation()`. Like
 * puppeteer, closing the page fails a navigation still in flight.
 */
class FakePage {
	navigations = 0;
	closed = false;
	private navigation: { resolve: () => void; reject: (error: Error) => void } | null = null;

	on(): void {}

	async setViewport(): Promise<void> {}

	goto(): Promise<void> {
		this.navigations++;
		return new Promise<void>((resolve, reject) => {
			this.navigation = { resolve, reject };
		});
	}

	async evaluate(): Promise<void> {}

	async close(): Promise<void> {
		this.closed = true;
		this.navigation?.reject(new Error('Navigating frame was detached'));
	}

	finishNavigation(): void {
		this.navigation?.resolve();
	}
}

function payload(waitSeconds: number): CapturePayload {
	return { url: 'https://estori.app/preview', waitSeconds, viewport: { width: 1280, height: 800 } };
}

/** Records how a capture settled, so a test can wait for it without hanging. */
function outcomeOf(work: Promise<unknown>): { value: unknown } {
	const outcome: { value: unknown } = { value: 'running' };
	work.then(
		() => {
			outcome.value = 'finished';
		},
		(reason: unknown) => {
			outcome.value = reason;
		},
	);
	return outcome;
}

describe('runCapture', () => {
	it('closes the page when stopped mid-navigation', async () => {
		const page = new FakePage();
		const controller = new AbortController();
		const capture = runCapture(page as unknown as CapturePage, payload(0), controller.signal);
		await vi.waitFor(() => expect(page.navigations).toBe(1));

		controller.abort(STOP);
		page.finishNavigation();

		await expect(capture).rejects.toBe(STOP);
		expect(page.closed).toBe(true);
	});

	it('stops waiting for late output when stopped', async () => {
		const page = new FakePage();
		const controller = new AbortController();
		const outcome = outcomeOf(runCapture(page as unknown as CapturePage, payload(25), controller.signal));
		await vi.waitFor(() => expect(page.navigations).toBe(1));
		page.finishNavigation();

		controller.abort(STOP);

		await vi.waitFor(() => expect(outcome.value).toBe(STOP));
		expect(page.closed).toBe(true);
	});

	it('does not navigate once already stopped', async () => {
		const page = new FakePage();
		const controller = new AbortController();
		controller.abort(STOP);

		const outcome = outcomeOf(runCapture(page as unknown as CapturePage, payload(0), controller.signal));

		await vi.waitFor(() => expect(outcome.value).not.toBe('running'));
		expect(outcome.value).toBe(STOP);
		expect(page.navigations).toBe(0);
		expect(page.closed).toBe(true);
	});
});
