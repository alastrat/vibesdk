import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/ui/sonner.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

describe('toaster', () => {
	it('renders into the body, so toasts stay above dialogs portaled outside #root', () => {
		const toaster = sources['/src/components/ui/sonner.tsx'];
		expect(toaster).toBeDefined();
		expect(toaster).toMatch(/import \{ createPortal \} from ["']react-dom["']/);
		expect(toaster).toMatch(/createPortal\(\s*<Sonner[\s\S]*\/>,\s*document\.body,?\s*\)/);
		expect(toaster).toContain('typeof document === "undefined"');
	});
});
