import { describe, expect, it } from 'vitest';
import { EDITOR_PREVIEW_IFRAME_SANDBOX, PREVIEW_IFRAME_SANDBOX } from './preview-sandbox';

const sources = import.meta.glob<string>('/src/routes/chat/components/preview-iframe.tsx', { query: '?raw', import: 'default', eager: true });

describe('preview sandboxes', () => {
	it("lets the owner's editor preview open Stripe Checkout in a tab of its own", () => {
		expect(EDITOR_PREVIEW_IFRAME_SANDBOX.split(' ')).toEqual([...PREVIEW_IFRAME_SANDBOX.split(' '), 'allow-popups-to-escape-sandbox']);
		expect(PREVIEW_IFRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox');
		const editor = Object.values(sources)[0] ?? '';
		expect(editor.match(/sandbox=\{EDITOR_PREVIEW_IFRAME_SANDBOX\}/g)).toHaveLength(2);
	});
});
