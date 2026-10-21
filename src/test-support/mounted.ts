/**
 * Mounts React for real in the Workers test pool, which has no DOM, so a test can check what a component shows after a
 * language change. `react-test-renderer` runs components with their state, effects and subscriptions; importing this
 * file gives React the `MessageChannel` its `await act(...)` queues work on, which Workers don't have.
 *
 *   beforeAll(silenceTestRendererDeprecation);
 *   afterEach(async () => { await unmountAll(); await applyAccountLocale('en'); });
 *   const renderer = await mountElement(createElement(Component));
 *   expect(textOf(renderer)).toContain('Hola');
 */
import { act, type ReactElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { vi } from 'vitest';

class Channel {
	port1: { onmessage: ((event: unknown) => void) | null } = { onmessage: null };
	port2 = { postMessage: () => void setTimeout(() => this.port1.onmessage?.({}), 0) };
}

Object.assign(globalThis, { MessageChannel: Channel, IS_REACT_ACT_ENVIRONMENT: true });

const mounted: TestRenderer.ReactTestRenderer[] = [];

/** The test renderer announces its own deprecation on every mount; this keeps it out of the test output. */
export function silenceTestRendererDeprecation(): void {
	const error = console.error.bind(console);
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		if (!String(args[0]).includes('react-test-renderer is deprecated')) error(...args);
	});
}

/** Mounts the element and waits for its first effects. `unmountAll` takes it down again. */
export async function mountElement(element: ReactElement): Promise<TestRenderer.ReactTestRenderer> {
	let renderer!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		renderer = TestRenderer.create(element);
	});
	mounted.push(renderer);
	return renderer;
}

/** Unmounts everything mounted so far, so a later language change is not an update to a page still on screen. */
export async function unmountAll(): Promise<void> {
	for (const renderer of mounted.splice(0)) await act(async () => renderer.unmount());
}

type RenderedNode = TestRenderer.ReactTestRendererJSON | string;

function collectText(node: RenderedNode | RenderedNode[] | null, into: string[]): void {
	if (node === null) return;
	if (typeof node === 'string') into.push(node);
	else if (Array.isArray(node)) for (const child of node) collectText(child, into);
	else for (const child of node.children ?? []) collectText(child, into);
}

/** Every piece of text on screen, in order, joined with spaces. */
export function textOf(renderer: TestRenderer.ReactTestRenderer): string {
	const text: string[] = [];
	collectText(renderer.toJSON(), text);
	return text.join(' ');
}
