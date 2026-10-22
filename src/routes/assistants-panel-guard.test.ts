import { describe, expect, it } from 'vitest';
import { STORE_ASSISTANTS } from '@/content/positioning';

const sources = import.meta.glob<string>(
	[
		'/src/components/public-site/AssistantsPanel.tsx',
		'/src/components/public-site/assistant-mocks.tsx',
		'/src/hooks/use-reveal-once.ts',
		'/src/styles/public-site.css',
		'/src/routes/landing/LandingPage.tsx',
		'/src/routes/solutions/brands.tsx',
		'/src/content/positioning.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PANEL = '/src/components/public-site/AssistantsPanel.tsx';

describe('store assistants panel', () => {
	it('reveals once in view: the glow first, the header at 0.5s, card text at 1s, card pictures at 1.5s, each over 0.9s', () => {
		const panel = source(PANEL);
		expect(panel).toContain('useRevealOnce<HTMLDivElement>()');
		expect(panel).toContain('data-revealed={revealed || undefined}');
		for (const token of ['duration-[900ms]', 'ease-[cubic-bezier(0.22,1,0.36,1)]', 'delay-500', 'delay-1000', 'delay-[1500ms]', '-translate-y-[10%]']) {
			expect(panel, token).toContain(token);
		}
	});

	it('keeps everything visible and still for people who ask for reduced motion', () => {
		const panel = source(PANEL);
		for (const token of ['motion-reduce:opacity-100', 'motion-reduce:transition-none', 'motion-reduce:translate-y-0', 'motion-reduce:hover:translate-y-0']) {
			expect(panel, token).toContain(token);
		}
	});

	it('lifts a card and lights its border on hover', () => {
		const panel = source(PANEL);
		expect(panel).toContain('hover:-translate-y-[38px]');
		expect(panel).toContain('hover:border-white');
	});

	it('shows the three assistants from the copy, with the status from the registry', () => {
		const panel = source(PANEL);
		expect(panel).toContain('STORE_ASSISTANTS.map');
		expect(panel).toContain('<CapabilityTag id="operations-agents" tone="dark" />');
		expect(STORE_ASSISTANTS.map(assistant => assistant.name)).toEqual(['Inventory assistant', 'Customer service assistant', 'Marketing assistant']);
		// Each card's picture is a small product view drawn in code, decorative to screen readers.
		expect(source('/src/components/public-site/assistant-mocks.tsx')).toContain('export function AssistantMock(');
		expect(panel).toMatch(/aria-hidden[^>]*delay-\[1500ms\]|delay-\[1500ms\][^>]*aria-hidden/);
	});

	it('keeps the full assistants panel on the landing page while brands uses the compact audience layout', () => {
		expect(source('/src/routes/landing/LandingPage.tsx')).toContain('<AssistantsPanel />');
		const brands = source('/src/routes/solutions/brands.tsx');
		expect(brands).toContain('<SolutionLandingPage id="brands"');
		expect(brands).not.toContain('<AssistantsPanel');
		for (const page of [source('/src/routes/landing/LandingPage.tsx'), brands]) expect(page).not.toContain('OperationsSection');
	});

	it('starts the reveal when the top of the panel passes 80% of the viewport, once', () => {
		const hook = source('/src/hooks/use-reveal-once.ts');
		expect(hook).toContain('new IntersectionObserver(');
		expect(hook).toContain("rootMargin: '0px 0px -20% 0px'");
		expect(hook).toContain('observer.disconnect()');
	});

	it('draws the film grain from an inline noise tile, not a downloaded image', () => {
		const css = source('/src/styles/public-site.css');
		expect(css).toContain('.public-grain');
		expect(css).toContain('feTurbulence');
	});
});
