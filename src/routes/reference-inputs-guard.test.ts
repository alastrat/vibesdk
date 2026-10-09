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
