import { describe, expect, it } from 'vitest';
import magicCss from '../../styles/magicui.css?raw';
import indexCss from '../../index.css?raw';

const components = import.meta.glob<string>('/src/components/magicui/*.tsx', { query: '?raw', import: 'default', eager: true });
const licence = import.meta.glob<string>('/src/components/magicui/LICENSE.md', { query: '?raw', import: 'default', eager: true });

const NAMES = ['marquee', 'border-beam', 'typing-animation', 'animated-list', 'number-ticker', 'animated-beam', 'blur-fade', 'safari', 'iphone'];
const ANIMATED = ['marquee', 'border-beam', 'typing-animation', 'animated-list', 'number-ticker', 'animated-beam', 'blur-fade'];

function component(name: string): string {
	const text = components[`/src/components/magicui/${name}.tsx`];
	if (text === undefined) throw new Error(`Component not found: ${name}`);
	return text;
}

describe('Magic UI components', () => {
	it("ships the nine adapted components with Magic UI's MIT licence", () => {
		for (const name of NAMES) expect(component(name)).toBeTruthy();
		const text = licence['/src/components/magicui/LICENSE.md'];
		expect(text).toContain('MIT License');
		expect(text).toContain('Copyright (c) Magic UI');
	});

	it('credits Magic UI in each file', () => {
		for (const name of NAMES) expect(component(name)).toContain('Adapted from Magic UI (MIT, see ./LICENSE.md)');
	});

	it('uses the framer-motion the app already has, never motion/react', () => {
		for (const name of NAMES) {
			expect(component(name)).not.toMatch(/from ["']motion\/react["']/);
			expect(component(name)).not.toContain('"use client"');
		}
		for (const name of ANIMATED.filter((n) => n !== 'marquee')) {
			expect(component(name)).toMatch(/from ["']framer-motion["']/);
		}
	});

	it('stops moving for people who ask for reduced motion', () => {
		for (const name of ANIMATED) expect(component(name)).toMatch(/useReducedMotion\(\)|motion-reduce:/);
	});

	it('keeps marquee copies out of the accessibility tree and the tab order, pauses on hover and off screen, and stops on focus', () => {
		const marquee = component('marquee');
		expect(marquee).toContain('aria-hidden={i > 0 || undefined}');
		expect(marquee).toContain('inert={i > 0 || undefined}');
		expect(marquee).toContain('group-hover:[animation-play-state:paused]');
		// Stopped, the first copy returns to x = 0, so the browser can scroll a focused link into view.
		expect(marquee).toContain('group-focus-within:animate-none');
		expect(marquee).not.toContain('group-focus-within:[animation-play-state:paused]');
		// Chrome leaves a partly visible focused link where it is, so the marquee reveals it, clear of the edge for its ring.
		expect(marquee).toContain('if (pauseOnHover) event.target.scrollIntoView({ block: "nearest", inline: "nearest" })');
		expect(marquee).toContain('onFocus={revealFocused}');
		expect(marquee).toContain('scroll-px-1');
		expect(marquee).toContain('group-data-[offscreen]:[animation-play-state:paused]');
		expect(marquee).toContain('motion-reduce:overflow-x-auto');
	});

	it('leaves the border beam visible in its border strip (no clipping on its wrapper)', () => {
		expect(component('border-beam')).not.toMatch(/rounded-\[inherit\] overflow-hidden/);
	});

	it('ignores the app dark mode in the device frames and the ticker', () => {
		for (const name of ['safari', 'iphone', 'number-ticker']) expect(component(name)).not.toContain('dark:');
	});

	it('defines the marquee and cursor animations, loaded by the app stylesheet', () => {
		// Inline, so the animation resolves var(--duration) on the marquee element rather than on :root.
		expect(magicCss).toContain('@theme inline {');
		expect(magicCss).toContain('--animate-marquee: marquee var(--duration) infinite linear;');
		expect(magicCss).toContain('@keyframes marquee');
		expect(magicCss).toContain('--animate-blink-cursor: blink-cursor 1.2s step-end infinite;');
		expect(magicCss).toContain('@keyframes blink-cursor');
		expect(indexCss).toContain("@import './styles/magicui.css';");
	});
});
