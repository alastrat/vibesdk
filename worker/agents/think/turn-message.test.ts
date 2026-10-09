import { describe, expect, it } from 'vitest';
import { agentAssetUrl } from './agent-assets';
import type { ReferenceOutcome } from './references';
import { buildTurnMessage, isHiddenPart } from './turn-message';

const CAPTURED: ReferenceOutcome = {
	url: 'https://stripe.com',
	host: 'stripe.com',
	ok: true,
	captureId: 'c1',
	shots: [
		{ kind: 'desktop-top', r2Key: 'screenshots/app/ref-c1-desktop-top.jpg' },
		{ kind: 'mobile-top', r2Key: 'screenshots/app/ref-c1-mobile-top.jpg' },
	],
	design: {
		title: 'Stripe',
		palette: ['#635bff'],
		fonts: { body: 'Inter', headings: 'Inter', buttons: 'Inter' },
		headings: [],
		button: null,
		nav: [],
		sections: [],
		copy: '',
		images: [],
	},
};
const FAILED: ReferenceOutcome = { url: 'https://x.com', host: 'x.com', ok: false, reason: 'HTTP 403' };

describe('buildTurnMessage', () => {
	it('sends plain text unchanged when there is nothing to attach', () => {
		expect(buildTurnMessage({ id: 'm1', text: 'Build a store', images: [], references: [] })).toEqual({
			id: 'm1',
			role: 'user',
			parts: [{ type: 'text', text: 'Build a store' }],
		});
	});

	it('orders text, digests, attachments, then reference screenshots', () => {
		const message = buildTurnMessage({
			id: 'm1',
			text: 'Like https://stripe.com and https://x.com',
			images: [{ r2Key: 'uploads/img-1/mock.webp', mimeType: 'image/webp' }],
			references: [CAPTURED, FAILED],
		});
		const summary = message.parts.map((part) =>
			part.type === 'text' ? `text${isHiddenPart(part) ? ' (hidden)' : ''}: ${part.text.split('\n')[0]}` : `${part.type}: ${'url' in part ? part.url : ''}`,
		);
		expect(summary).toEqual([
			'text: Like https://stripe.com and https://x.com',
			'text (hidden): Reference 1: https://stripe.com ("Stripe")',
			"text (hidden): Reference 2: https://x.com could not be captured (HTTP 403); work from the user's description.",
			'text (hidden): Attachment 1',
			`file: ${agentAssetUrl('uploads/img-1/mock.webp')}`,
			'text (hidden): Reference stripe.com: desktop, top',
			`file: ${agentAssetUrl('screenshots/app/ref-c1-desktop-top.jpg')}`,
			'text (hidden): Reference stripe.com: phone, top',
			`file: ${agentAssetUrl('screenshots/app/ref-c1-mobile-top.jpg')}`,
		]);
	});

	it('types attachments and screenshots for the model', () => {
		const message = buildTurnMessage({
			id: 'm1',
			text: 'x',
			images: [{ r2Key: 'uploads/a.png', mimeType: 'image/png' }],
			references: [CAPTURED],
		});
		const files = message.parts.filter((part) => part.type === 'file');
		expect(files.map((part) => ('mediaType' in part ? part.mediaType : ''))).toEqual(['image/png', 'image/jpeg', 'image/jpeg']);
	});
});

describe('isHiddenPart', () => {
	it('is true only for parts marked hidden', () => {
		expect(isHiddenPart({ type: 'text', text: 'x', providerMetadata: { estori: { hidden: true } } })).toBe(true);
		expect(isHiddenPart({ type: 'text', text: 'x' })).toBe(false);
		expect(isHiddenPart({ type: 'file', url: 'https://x' })).toBe(false);
		expect(isHiddenPart(null)).toBe(false);
	});
});
