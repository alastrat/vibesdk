import { createOpenAI } from '@ai-sdk/openai';
import { convertToModelMessages, generateText, type UIMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
	AGENT_ASSET_HOST,
	MAX_INLINE_IMAGE_BYTES,
	agentAssetKey,
	agentAssetUrl,
	createAssetCache,
	inlineAgentAssets,
	type AssetBucket,
} from './agent-assets';

interface StoredObject {
	bytes: Uint8Array;
	contentType: string;
	size?: number;
}

function fakeBucket(objects: Record<string, StoredObject>) {
	const reads: string[] = [];
	const bucket: AssetBucket = {
		async get(key) {
			reads.push(key);
			const object = objects[key];
			if (!object) return null;
			return {
				size: object.size ?? object.bytes.byteLength,
				httpMetadata: { contentType: object.contentType },
				arrayBuffer: async () => object.bytes.slice().buffer,
			};
		},
	};
	return { bucket, reads };
}

function chatBody(...urls: string[]): string {
	return JSON.stringify({
		model: 'anthropic/claude-sonnet-5-5',
		messages: [
			{ role: 'system', content: 'You build apps.' },
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Match this.' },
					...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
				],
			},
		],
	});
}

const KEY = 'screenshots/app-1/ref-abc-desktop-top.jpg';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

describe('agent asset URLs', () => {
	it('round-trips an R2 key through the reserved host', () => {
		const url = agentAssetUrl(KEY);
		expect(url).toBe(`https://${AGENT_ASSET_HOST}/${KEY}`);
		expect(agentAssetKey(url)).toBe(KEY);
	});

	it('encodes path segments but keeps the slashes', () => {
		const url = agentAssetUrl('uploads/img 1/photo (2).png');
		expect(url).toBe(`https://${AGENT_ASSET_HOST}/uploads/img%201/photo%20(2).png`);
		expect(agentAssetKey(url)).toBe('uploads/img 1/photo (2).png');
	});

	it('ignores URLs on other hosts', () => {
		expect(agentAssetKey('https://example.com/a.png')).toBeNull();
	});
});

describe('inlineAgentAssets', () => {
	it('replaces a reserved-host image with an inline data URL', async () => {
		const { bucket } = fakeBucket({ [KEY]: { bytes: PNG_BYTES, contentType: 'image/png' } });
		const out = JSON.parse(await inlineAgentAssets(chatBody(agentAssetUrl(KEY)), bucket, createAssetCache(1_000_000)));
		expect(out.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } });
	});

	it('turns a missing image into a text part', async () => {
		const { bucket } = fakeBucket({});
		const out = JSON.parse(await inlineAgentAssets(chatBody(agentAssetUrl(KEY)), bucket, createAssetCache(1_000_000)));
		expect(out.messages[1].content[1]).toEqual({ type: 'text', text: '[image unavailable]' });
	});

	it('turns an oversized image into a text part without reading it', async () => {
		const { bucket } = fakeBucket({
			[KEY]: { bytes: PNG_BYTES, contentType: 'image/png', size: MAX_INLINE_IMAGE_BYTES + 1 },
		});
		const out = JSON.parse(await inlineAgentAssets(chatBody(agentAssetUrl(KEY)), bucket, createAssetCache(1_000_000)));
		expect(out.messages[1].content[1]).toEqual({ type: 'text', text: '[image too large]' });
	});

	it('reads each image from R2 once across requests', async () => {
		const { bucket, reads } = fakeBucket({ [KEY]: { bytes: PNG_BYTES, contentType: 'image/png' } });
		const cache = createAssetCache(1_000_000);
		await inlineAgentAssets(chatBody(agentAssetUrl(KEY), agentAssetUrl(KEY)), bucket, cache);
		await inlineAgentAssets(chatBody(agentAssetUrl(KEY)), bucket, cache);
		expect(reads).toEqual([KEY]);
	});

	it('returns bodies without reserved-host images unchanged', async () => {
		const { bucket, reads } = fakeBucket({});
		const body = chatBody('https://example.com/photo.png');
		expect(await inlineAgentAssets(body, bucket, createAssetCache(1_000_000))).toBe(body);
		expect(await inlineAgentAssets('not json', bucket, createAssetCache(1_000_000))).toBe('not json');
		expect(reads).toEqual([]);
	});
});

describe('createAssetCache', () => {
	it('evicts the oldest entries beyond its byte budget', () => {
		const cache = createAssetCache(10);
		cache.set('a', '12345');
		cache.set('b', '12345');
		cache.set('c', '123');
		expect(cache.get('a')).toBeUndefined();
		expect(cache.get('b')).toBe('12345');
		expect(cache.get('c')).toBe('123');
	});

	it('skips values larger than the whole budget', () => {
		const cache = createAssetCache(4);
		cache.set('big', '12345');
		expect(cache.get('big')).toBeUndefined();
	});
});

describe('AI SDK pass-through of reserved-host images', () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('sends the reserved URL in the request body without downloading it', async () => {
		const downloads: string[] = [];
		globalThis.fetch = async (input) => {
			downloads.push(String(input));
			return new Response('unexpected download', { status: 500 });
		};
		let sentBody = '';
		const provider = createOpenAI({
			baseURL: 'https://gateway.test/compat',
			apiKey: 'test',
			fetch: async (_input, init) => {
				sentBody = String(init?.body);
				return Response.json({
					id: 'chatcmpl-1',
					object: 'chat.completion',
					created: 0,
					model: 'anthropic/claude-sonnet-5-5',
					choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				});
			},
		});
		const message: UIMessage = {
			id: 'm1',
			role: 'user',
			parts: [
				{ type: 'text', text: 'Match this.' },
				{ type: 'file', mediaType: 'image/jpeg', url: agentAssetUrl(KEY) },
			],
		};
		await generateText({
			model: provider.chat('anthropic/claude-sonnet-5-5'),
			messages: await convertToModelMessages([message]),
		});
		expect(downloads).toEqual([]);
		const content = JSON.parse(sentBody).messages[0].content;
		expect(content).toContainEqual(expect.objectContaining({ type: 'image_url', image_url: expect.objectContaining({ url: agentAssetUrl(KEY) }) }));
	});
});
