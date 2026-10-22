import { act, createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import { useMarketRotation } from './use-market-rotation';

beforeAll(silenceTestRendererDeprecation);
afterEach(async () => {
	await unmountAll();
	vi.useRealTimers();
});

let story: ReturnType<typeof useMarketRotation>;
function Probe({ enabled }: { enabled: boolean }) {
	story = useMarketRotation(3, enabled);
	return null;
}
const tick = () =>
	act(async () => {
		vi.advanceTimersByTime(6500);
	});

describe('market rotation', () => {
	it('cycles through markets and wraps, but does not advance off screen', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		const renderer = await mountElement(createElement(Probe, { enabled: false }));
		await tick();
		expect(story.active).toBe(0);
		await act(async () => renderer.update(createElement(Probe, { enabled: true })));
		await tick();
		expect(story.active).toBe(1);
		await tick();
		expect(story.active).toBe(2);
		await tick();
		expect(story.active).toBe(0);
		await act(async () => renderer.update(createElement(Probe, { enabled: false })));
		await tick();
		expect(story.active).toBe(0);
	});
	it('holds a manually selected market until the visitor resumes playback', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		await mountElement(createElement(Probe, { enabled: true }));
		await act(async () => story.select(2));
		await tick();
		expect(story.active).toBe(2);
		expect(story.paused).toBe(true);
		await act(async () => story.toggle());
		await tick();
		expect(story.active).toBe(0);
		await act(async () => story.toggle());
		await tick();
		expect(story.active).toBe(0);
	});
	it('allows manual market selection when automatic motion is disabled', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		await mountElement(createElement(Probe, { enabled: false }));
		await act(async () => story.select(1));
		await tick();
		expect(story.active).toBe(1);
		await act(async () => story.toggle());
		await tick();
		expect(story.active).toBe(1);
	});
});
