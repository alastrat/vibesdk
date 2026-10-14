import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/hooks/use-typewriter-placeholder.ts'], { query: '?raw', import: 'default', eager: true });

describe('useTypewriterPlaceholder', () => {
	const hook = sources['/src/hooks/use-typewriter-placeholder.ts'];

	it('shows the first phrase in full and starts no timers for people who asked for reduced motion', () => {
		expect(hook).toBeDefined();
		expect(hook).toContain("typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches");
		expect(hook).toContain('if (!enabled || reduceMotion || phrases.length === 0) return;');
		expect(hook).toContain("if (reduceMotion) return phrases[0] ?? '';");
	});
});
