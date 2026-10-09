import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/hooks/use-image-upload.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
		'/src/routes/chat/components/messages.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('reference inputs: attachments', () => {
	it('downscales images before upload', () => {
		expect(source('/src/hooks/use-image-upload.ts')).toContain('await downscaleImageFile(file)');
	});
});

describe('reference inputs: chat', () => {
	it('adds reference cards and skipped-link notices to the turn', () => {
		const handler = source('/src/routes/chat/utils/handle-websocket-message.ts');
		expect(handler).toContain("case 'reference_captured':");
		expect(handler).toContain('appendReferencePart(prev, message.conversationId, message.reference)');
		expect(handler).toContain("case 'references_skipped':");
		expect(handler).toContain('skippedReferenceCard(url)');
	});

	it('renders reference parts as cards', () => {
		const messages = source('/src/routes/chat/components/messages.tsx');
		expect(messages).toContain("if (part.type === 'reference')");
		expect(messages).toContain('<ReferenceCard key={unit.key} reference={unit.reference} />');
	});
});
