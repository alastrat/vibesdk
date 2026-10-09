import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/think/ThinkAgent.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('ThinkAgent request body chain', () => {
	it('inlines conversation images, then adds Gemini thought signatures', () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		expect(agent).toContain(
			'injectThoughtSignatures(await inlineAgentAssets(body, this.env.TEMPLATES_BUCKET, this.assetCache), this.thoughtSignatures)',
		);
		expect(agent).toContain('private readonly assetCache = createAssetCache(ASSET_CACHE_BYTES);');
	});
});
