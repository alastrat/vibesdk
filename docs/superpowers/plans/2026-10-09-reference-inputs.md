# Reference Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Think builds follow references: images the user attaches, and sites whose URLs they paste, captured as screenshots plus design data.

**Architecture:**
- **Capture:** the Think host captures pasted URLs with the Worker's `BROWSER` binding before each turn. Each page yields four JPEG screenshots and design data extracted from the rendered page.
- **Storage:** screenshots and attachments live in R2. The turn's user message references them on a reserved host (`assets.estori.internal`), so stored messages stay small.
- **Sending:** the model transport's `prepareBody` hook inlines them as `data:` images on every request.
- **Chat:** shows a reference card per URL and a `Capturing <host>` progress state.

**Tech Stack:** Cloudflare Workers and Durable Objects, `@cloudflare/think` 0.8.8, AI SDK 6 (`ai`, `@ai-sdk/openai`), `@cloudflare/puppeteer` (production) and `puppeteer` 24 (dev sidecar), R2, React 19, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-09-reference-inputs-design.md`

## Global Constraints

- **Limits and capture values:**
  - The first 3 URLs per message are captured (`MAX_REFERENCE_URLS = 3`); the rest stay as text.
  - Per URL: desktop 1280×800 screenshots at the top and scrolled to 40% and 80% of the page, plus a phone 390×844 screenshot of the top (`isMobile`, `hasTouch`). All are JPEG at quality 70, viewport only.
  - Timing: navigation timeout 20,000 ms, settle 1,500 ms, overall budget per URL 45,000 ms.
  - Screenshot storage key: `screenshots/<appId>/ref-<captureId>-<kind>.jpg`, with kinds `desktop-top`, `desktop-middle`, `desktop-lower`, `mobile-top`.
- **Images in requests:**
  - Reserved image host: `assets.estori.internal`; URLs are `https://assets.estori.internal/<r2Key>`.
  - Images over 5 MB become the text `[image too large]`. Missing images become `[image unavailable]`.
  - The asset cache is capped at 20 MB.
  - Attachments are downscaled in the browser to at most 1600 px on the long edge, as WebP, with JPEG as the fallback.
- **Messages:**
  - Digest and label parts carry `providerMetadata: { estori: { hidden: true } }`. Reloaded chats skip them.
  - Copy and image URLs from a reference are reused only when the user says the site is theirs.
- **URL rules:**
  - Never capture `localhost`, private, loopback, link-local, CGNAT or metadata IP literals (IPv4 and IPv6), any `estori.app` host, or anything other than `http(s)`.
  - Never try to get past bot protection or logins.
- **Types, comments and indentation:**
  - Never use `any`. The frontend imports shared types from `@/api-types`.
  - Comments explain purpose, concisely. No emojis.
  - Match each file's indentation: tabs in new files, `think.ts`, `ThinkAgent.ts`, `build-progress.ts`, `use-chat.ts`, `messages.tsx` and `message-helpers.ts`; 4 spaces in `base.ts`, `constants.ts`, `state.ts` and `handle-websocket-message.ts`; mixed in `websocketTypes.ts` (match the neighbouring lines).
- **Tests and checks:**
  - Run only the test files a step names: `npx vitest run <files>`. On macOS the full suite exhausts ports. If the rtk hook mangles vitest output, use `rtk proxy npx vitest run <files> --reporter=verbose`.
  - Typecheck is `npm run typecheck`. The baseline is exactly 4 errors, all in `packages/artifacts-viewer`.
- **Commits:**
  - Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Stage only the files a task names. Never use `git stash`.
  - Subjects are lowercase conventional commits; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - No new dependencies, no pushes, no deploys.

## Review Focus

1. **Messy URLs:** URLs wrapped in punctuation, angle brackets or markdown, or pasted twice, must be captured once with clean URLs. A Wikipedia-style URL ending in `(…)` must keep its parenthesis. *Task 5 tests.*
2. **References that aren't web pages:** a PDF, an image, a 404 or a login wall must end as a failure card, never a broken turn. *Task 4 tests for HTTP 400 and above and for non-HTML; Task 6 tests for failure mapping and storage failures.*
3. **Images sent mid-build:** images attached to a message sent while a build runs must go with that message into the next turn, not be lost or replace earlier queued images. *Task 9 guard: append, not replace.*
4. **Progress after capture:** after capture the progress bar must return to the build activity, not stay on "Capturing…". *Task 7 tracker test.*
5. **Reloaded chats:** a reloaded chat must show the user's words without digests or image labels. *Task 8 test for `isHiddenPart` and the `MessageLoader` guard.*

---

### Task 1: Agent asset URLs and request-time inlining

**Files:**
- Create: `worker/agents/think/agent-assets.ts`
- Test: `worker/agents/think/agent-assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `worker/agents/think/agent-assets.ts`:
  - `AGENT_ASSET_HOST = 'assets.estori.internal'`;
  - `MAX_INLINE_IMAGE_BYTES`;
  - `agentAssetUrl(r2Key: string): string`;
  - `agentAssetKey(url: string): string | null`;
  - `interface AssetBucket`;
  - `interface AssetCache`;
  - `createAssetCache(maxBytes: number): AssetCache`;
  - `inlineAgentAssets(body: string, bucket: AssetBucket, cache: AssetCache): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/agents/think/agent-assets.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/agents/think/agent-assets.test.ts`
Expected: FAIL. The module `./agent-assets` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `worker/agents/think/agent-assets.ts`:

```ts
/**
 * Images in a Think conversation are stored in R2 and referenced on a reserved
 * host, so stored messages stay small. Each model request inlines them as data
 * URLs, because providers cannot reach Estori's storage.
 */

export const AGENT_ASSET_HOST = 'assets.estori.internal';
const AGENT_ASSET_PREFIX = `https://${AGENT_ASSET_HOST}/`;

/** Larger images are left out of the request; Claude rejects images over 5 MB. */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AssetBucket {
	get(key: string): Promise<{
		size: number;
		httpMetadata?: { contentType?: string };
		arrayBuffer(): Promise<ArrayBuffer>;
	} | null>;
}

export interface AssetCache {
	get(key: string): string | undefined;
	set(key: string, dataUrl: string): void;
}

export function agentAssetUrl(r2Key: string): string {
	return AGENT_ASSET_PREFIX + r2Key.split('/').map(encodeURIComponent).join('/');
}

export function agentAssetKey(url: string): string | null {
	if (!url.startsWith(AGENT_ASSET_PREFIX)) return null;
	return url.slice(AGENT_ASSET_PREFIX.length).split('/').map(decodeURIComponent).join('/');
}

/** Data URLs by R2 key, evicting the oldest entries beyond `maxBytes`. */
export function createAssetCache(maxBytes: number): AssetCache {
	const entries = new Map<string, string>();
	let total = 0;
	return {
		get: (key) => entries.get(key),
		set: (key, dataUrl) => {
			if (dataUrl.length > maxBytes) return;
			const previous = entries.get(key);
			if (previous !== undefined) {
				total -= previous.length;
				entries.delete(key);
			}
			entries.set(key, dataUrl);
			total += dataUrl.length;
			for (const [oldKey, oldValue] of entries) {
				if (total <= maxBytes) break;
				entries.delete(oldKey);
				total -= oldValue.length;
			}
		},
	};
}

type Inlined = { kind: 'data'; dataUrl: string } | { kind: 'text'; text: string };

interface ImageUrlPart {
	type: 'image_url';
	image_url: { url: string; [key: string]: unknown };
}

function assetImageKey(part: unknown): string | null {
	const p = part as { type?: unknown; image_url?: { url?: unknown } };
	if (p?.type !== 'image_url' || typeof p.image_url?.url !== 'string') return null;
	return agentAssetKey(p.image_url.url);
}

async function loadAsset(key: string, bucket: AssetBucket, cache: AssetCache): Promise<Inlined> {
	const cached = cache.get(key);
	if (cached) return { kind: 'data', dataUrl: cached };
	const object = await bucket.get(key);
	if (!object) return { kind: 'text', text: '[image unavailable]' };
	if (object.size > MAX_INLINE_IMAGE_BYTES) return { kind: 'text', text: '[image too large]' };
	const mediaType = object.httpMetadata?.contentType ?? 'image/jpeg';
	const dataUrl = `data:${mediaType};base64,${Buffer.from(await object.arrayBuffer()).toString('base64')}`;
	cache.set(key, dataUrl);
	return { kind: 'data', dataUrl };
}

/**
 * Replaces every reserved-host image in a chat-completions body with an inline
 * data URL read from R2. Bodies without such images are returned unchanged.
 */
export async function inlineAgentAssets(body: string, bucket: AssetBucket, cache: AssetCache): Promise<string> {
	if (!body.includes(AGENT_ASSET_HOST)) return body;
	let json: { messages?: unknown };
	try {
		json = JSON.parse(body);
	} catch {
		return body;
	}
	if (!Array.isArray(json.messages)) return body;

	const keys = new Set<string>();
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const key = assetImageKey(part);
			if (key) keys.add(key);
		}
	}
	if (keys.size === 0) return body;

	const loaded = new Map(
		await Promise.all([...keys].map(async (key) => [key, await loadAsset(key, bucket, cache)] as const)),
	);
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (let i = 0; i < content.length; i++) {
			const key = assetImageKey(content[i]);
			const inlined = key ? loaded.get(key) : undefined;
			if (!inlined) continue;
			const part = content[i] as ImageUrlPart;
			content[i] =
				inlined.kind === 'data'
					? { ...part, image_url: { ...part.image_url, url: inlined.dataUrl } }
					: { type: 'text', text: inlined.text };
		}
	}
	return JSON.stringify(json);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/agent-assets.test.ts`
Expected: PASS, 11 tests. The pass-through test is the spec's safety net. If it fails because the AI SDK downloads the URL, stop and report NEEDS_CONTEXT with its output; the design depends on it.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/agent-assets.ts worker/agents/think/agent-assets.test.ts
git commit -m "feat(think): reference conversation images by URL and inline them per request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Async body hook and the ThinkAgent request chain

**Files:**
- Modify: `worker/agents/think/model-transport.ts` (`prepareBody` type at line 22, its use at line 44)
- Modify: `worker/agents/think/ThinkAgent.ts` (imports near line 31; a field near line 172; the transport at lines 205-207)
- Test: `worker/agents/think/model-transport.test.ts`
- Test: `worker/agents/think/reference-transport-wiring.test.ts` (new)

**Interfaces:**
- Consumes: `inlineAgentAssets`, `createAssetCache` and `AssetBucket` from Task 1.
- Produces:
  - `ModelTransportOptions.prepareBody?: (body: string) => Promise<string> | string`, now awaited;
  - ThinkAgent request bodies with inlined images and then Gemini thought signatures.

- [ ] **Step 1: Write the failing tests**

In `worker/agents/think/model-transport.test.ts`, add after the test `'runs the body hook on the outgoing body'`:

```ts
	it('awaits an async body hook before sending', async () => {
		let sent = '';
		const transport = createModelTransport({
			timeoutMs: 1000,
			prepareBody: async (body) => {
				await Promise.resolve();
				return body.replace('"hi"', '"inlined"');
			},
			fetchImpl: async (_input, request) => {
				sent = String(request?.body);
				return new Response('ok');
			},
		});
		await transport(URL, init());
		expect(JSON.parse(sent).messages[0].content).toBe('inlined');
	});
```

Create `worker/agents/think/reference-transport-wiring.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/agents/think/model-transport.test.ts worker/agents/think/reference-transport-wiring.test.ts`
Expected: FAIL.
- The async-hook test fails because the transport sends the body as a promise, which serializes to `[object Promise]` and makes `JSON.parse` throw.
- The wiring guard fails on the missing strings.
- Other transport tests pass.

- [ ] **Step 3: Make the hook async-capable**

In `worker/agents/think/model-transport.ts`, change the option:

```ts
	/** Rewrites each outgoing body for its target model; may read storage, so it can be async. */
	prepareBody?: (body: string) => Promise<string> | string;
```

and the prepared body:

```ts
			body: typeof body === 'string' && prepareBody ? await prepareBody(body) : body,
```

- [ ] **Step 4: Chain inlining before thought signatures in ThinkAgent**

In `worker/agents/think/ThinkAgent.ts`:

1. After the `thought-signatures` import, add:

```ts
import { createAssetCache, inlineAgentAssets } from './agent-assets';
```

2. Near the other constants at the top of the file (next to `MODEL_RESPONSE_TIMEOUT_MS`), add:

```ts
/** Memory for conversation images already read from R2, so later steps skip the read. */
const ASSET_CACHE_BYTES = 20 * 1024 * 1024;
```

3. Directly after `private readonly thoughtSignatures = new Map<string, string>();`, add:

```ts
	private readonly assetCache = createAssetCache(ASSET_CACHE_BYTES);
```

4. Replace the `prepareBody` line in `createModelTransport({ … })` with:

```ts
			prepareBody: async (body) =>
				injectThoughtSignatures(await inlineAgentAssets(body, this.env.TEMPLATES_BUCKET, this.assetCache), this.thoughtSignatures),
```

Keep the call on one line, as the guard expects. Also extend the `getModel` comment list with a step 5: "(5) inline conversation images stored in R2, since providers can't reach them".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/model-transport.test.ts worker/agents/think/reference-transport-wiring.test.ts worker/agents/think/thought-signatures.test.ts worker/agents/think/agent-assets.test.ts`
Expected: PASS, including every existing transport and thought-signature test.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors in `packages/artifacts-viewer`.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/think/model-transport.ts worker/agents/think/model-transport.test.ts worker/agents/think/ThinkAgent.ts worker/agents/think/reference-transport-wiring.test.ts
git commit -m "feat(think): inline stored conversation images in every model request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reference capture types, extraction script and design normalizer

**Files:**
- Modify: `worker/services/browser-capture/types.ts` (append after `ScreenshotPayload`)
- Create: `worker/services/browser-capture/reference-extract.ts`
- Test: `worker/services/browser-capture/reference-extract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, in `worker/services/browser-capture/types.ts`:
  - `ReferencePayload { url; timeoutMs; settleMs }`;
  - `ReferenceShotKind`;
  - `ReferenceShot { kind; jpegBase64; width; height }`;
  - `ReferenceDesign`;
  - `ReferenceCaptureResult { finalUrl; shots; design }`.

  And in `reference-extract.ts`:
  - `REFERENCE_EXTRACT_SCRIPT: string`;
  - `normalizeReferenceDesign(raw: unknown): ReferenceDesign`.

- [ ] **Step 1: Write the failing test**

Create `worker/services/browser-capture/reference-extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REFERENCE_EXTRACT_SCRIPT, normalizeReferenceDesign } from './reference-extract';

const VALID = {
	title: 'Stripe | Financial infrastructure',
	palette: ['#0a2540', '#635bff', '#FFFFFF', 'rgb(1,2,3)', '#abc'],
	fonts: { body: 'Sohne', headings: 'Sohne', buttons: 'Sohne' },
	headings: [{ tag: 'h1', size: '56px', weight: '700' }],
	button: { background: '#635bff', color: '#ffffff', radius: '4px' },
	nav: ['Products', 'Pricing'],
	sections: [{ heading: 'Grow your revenue', columns: 2, hasImage: true }],
	copy: 'Financial infrastructure to grow your revenue.',
	images: ['https://images.example.com/hero.png', 'data:image/png;base64,AAAA'],
};

describe('normalizeReferenceDesign', () => {
	it('keeps valid fields and drops invalid colors and non-http images', () => {
		const design = normalizeReferenceDesign(VALID);
		expect(design.title).toBe('Stripe | Financial infrastructure');
		expect(design.palette).toEqual(['#0a2540', '#635bff', '#ffffff']);
		expect(design.fonts).toEqual({ body: 'Sohne', headings: 'Sohne', buttons: 'Sohne' });
		expect(design.headings).toEqual([{ tag: 'h1', size: '56px', weight: '700' }]);
		expect(design.button).toEqual({ background: '#635bff', color: '#ffffff', radius: '4px' });
		expect(design.nav).toEqual(['Products', 'Pricing']);
		expect(design.sections).toEqual([{ heading: 'Grow your revenue', columns: 2, hasImage: true }]);
		expect(design.images).toEqual(['https://images.example.com/hero.png']);
	});

	it('returns an empty design for garbage', () => {
		expect(normalizeReferenceDesign(null)).toEqual({
			title: '',
			palette: [],
			fonts: { body: '', headings: '', buttons: '' },
			headings: [],
			button: null,
			nav: [],
			sections: [],
			copy: '',
			images: [],
		});
	});

	it('caps lists, text and column counts', () => {
		const design = normalizeReferenceDesign({
			...VALID,
			palette: Array.from({ length: 20 }, (_, i) => `#0000${String(i).padStart(2, '0')}`),
			nav: Array.from({ length: 20 }, (_, i) => `Item ${i}`),
			sections: Array.from({ length: 20 }, () => ({ heading: 'x'.repeat(300), columns: 40, hasImage: false })),
			copy: 'y'.repeat(10_000),
			images: Array.from({ length: 20 }, (_, i) => `https://img.example.com/${i}.png`),
		});
		expect(design.palette).toHaveLength(8);
		expect(design.nav).toHaveLength(12);
		expect(design.sections).toHaveLength(15);
		expect(design.sections[0].heading).toHaveLength(120);
		expect(design.sections[0].columns).toBe(6);
		expect(design.copy).toHaveLength(6000);
		expect(design.images).toHaveLength(12);
	});

	it('is an expression a page can evaluate', () => {
		expect(REFERENCE_EXTRACT_SCRIPT.trim().startsWith('(() => {')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT.trim().endsWith('})()')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT).toContain('getComputedStyle');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/services/browser-capture/reference-extract.test.ts`
Expected: FAIL. The module `./reference-extract` cannot be resolved.

- [ ] **Step 3: Add the types**

Append to `worker/services/browser-capture/types.ts`, after the `ScreenshotPayload` interface:

```ts

export interface ReferencePayload {
	url: string;
	/** Navigation timeout in milliseconds. */
	timeoutMs: number;
	/** Milliseconds to wait after each load or scroll before capturing. */
	settleMs: number;
}

export type ReferenceShotKind = 'desktop-top' | 'desktop-middle' | 'desktop-lower' | 'mobile-top';

export interface ReferenceShot {
	kind: ReferenceShotKind;
	/** JPEG, base64 without a data URL prefix. */
	jpegBase64: string;
	width: number;
	height: number;
}

/** Design data read from a reference page's rendered styles. */
export interface ReferenceDesign {
	title: string;
	/** Hex colors, most used first, up to 8. */
	palette: string[];
	fonts: { body: string; headings: string; buttons: string };
	headings: { tag: string; size: string; weight: string }[];
	button: { background: string; color: string; radius: string } | null;
	/** Up to 12 navigation labels. */
	nav: string[];
	/** Top-level sections, top to bottom, up to 15. */
	sections: { heading: string; columns: number; hasImage: boolean }[];
	/** Visible text, up to 6,000 characters. */
	copy: string;
	/** Absolute image URLs, up to 12. */
	images: string[];
}

export interface ReferenceCaptureResult {
	finalUrl: string;
	shots: ReferenceShot[];
	design: ReferenceDesign;
}
```

- [ ] **Step 4: Write the extraction script and normalizer**

Create `worker/services/browser-capture/reference-extract.ts`:

```ts
/**
 * Design extraction for reference pages. The script runs inside the page and
 * reads computed styles, so colors and fonts from external stylesheets and
 * utility-class sites are seen. Its output is untrusted page data, so
 * `normalizeReferenceDesign` validates and caps every field.
 */

import type { ReferenceDesign } from './types';

export const REFERENCE_EXTRACT_SCRIPT = `(() => {
	const isVisible = (el) => {
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;
		const style = getComputedStyle(el);
		return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
	};
	const toHex = (value) => {
		const match = /rgba?\\(([^)]+)\\)/.exec(value || '');
		if (!match) return null;
		const parts = match[1].split(',').map((part) => part.trim());
		if (parts.length === 4 && Number(parts[3]) === 0) return null;
		return '#' + parts.slice(0, 3).map((part) => Math.round(Number(part)).toString(16).padStart(2, '0')).join('');
	};
	const firstFamily = (el) => (el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : '');
	const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();

	const elements = Array.from(document.body ? document.body.querySelectorAll('*') : []).slice(0, 4000).filter(isVisible);
	const counts = new Map();
	for (const el of elements) {
		const style = getComputedStyle(el);
		for (const value of [style.color, style.backgroundColor]) {
			const hex = toHex(value);
			if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
		}
	}
	const palette = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((entry) => entry[0]);

	const heading = document.querySelector('h1') || document.querySelector('h2');
	const buttonEl = Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"]')).find(isVisible) || null;
	const headings = ['h1', 'h2', 'h3'].map((tag) => {
		const el = document.querySelector(tag);
		if (!el) return null;
		const style = getComputedStyle(el);
		return { tag, size: style.fontSize, weight: style.fontWeight };
	}).filter(Boolean);
	const button = buttonEl ? (() => {
		const style = getComputedStyle(buttonEl);
		return { background: toHex(style.backgroundColor) || 'transparent', color: toHex(style.color) || '', radius: style.borderRadius };
	})() : null;
	const nav = Array.from(document.querySelectorAll('header a, nav a')).filter(isVisible).map((a) => clean(a.textContent))
		.filter((text, index, all) => text.length > 0 && text.length <= 40 && all.indexOf(text) === index).slice(0, 12);

	const root = document.querySelector('main') || document.body;
	let candidates = root ? Array.from(root.querySelectorAll('section')) : [];
	if (candidates.length < 2 && root) candidates = Array.from(root.children);
	const blocks = candidates.filter((el) => isVisible(el) && el.getBoundingClientRect().height > 120);
	const topLevel = blocks.filter((el) => !blocks.some((other) => other !== el && other.contains(el))).slice(0, 15);
	const columnsOf = (el) => {
		const nodes = [el].concat(Array.from(el.querySelectorAll('*')).slice(0, 200));
		for (const node of nodes) {
			const style = getComputedStyle(node);
			if (style.display.includes('grid')) {
				const count = style.gridTemplateColumns.split(' ').filter((part) => part && part !== 'none').length;
				if (count > 1) return Math.min(count, 6);
			}
			if (style.display.includes('flex') && !style.flexDirection.startsWith('column')) {
				const visibleChildren = Array.from(node.children).filter(isVisible).length;
				if (visibleChildren > 1) return Math.min(visibleChildren, 6);
			}
		}
		return 1;
	};
	const sections = topLevel.map((el) => ({
		heading: clean((el.querySelector('h1, h2, h3') || {}).textContent).slice(0, 120),
		columns: columnsOf(el),
		hasImage: Boolean(el.querySelector('img, picture, video, svg')),
	}));
	const copy = clean(topLevel.map((el) => el.innerText).join(' ')).slice(0, 6000);
	const images = Array.from(document.images).filter(isVisible).map((img) => img.currentSrc || img.src)
		.filter((src, index, all) => /^https?:/.test(src) && all.indexOf(src) === index).slice(0, 12);

	return {
		title: clean(document.title).slice(0, 200),
		palette,
		fonts: { body: firstFamily(document.body), headings: firstFamily(heading), buttons: firstFamily(buttonEl) },
		headings,
		button,
		nav,
		sections,
		copy,
		images,
	};
})()`;

const HEX = /^#[0-9a-f]{6}$/;

function text(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeReferenceDesign(raw: unknown): ReferenceDesign {
	const data = record(raw);
	const fonts = record(data.fonts);
	const button = record(data.button);
	return {
		title: text(data.title, 200),
		palette: list(data.palette)
			.map((color) => text(color, 7).toLowerCase())
			.filter((color) => HEX.test(color))
			.slice(0, 8),
		fonts: { body: text(fonts.body, 80), headings: text(fonts.headings, 80), buttons: text(fonts.buttons, 80) },
		headings: list(data.headings)
			.map(record)
			.map((h) => ({ tag: text(h.tag, 4), size: text(h.size, 16), weight: text(h.weight, 8) }))
			.filter((h) => /^h[1-6]$/.test(h.tag))
			.slice(0, 3),
		button: data.button ? { background: text(button.background, 32), color: text(button.color, 32), radius: text(button.radius, 32) } : null,
		nav: list(data.nav).map((label) => text(label, 40)).filter((label) => label.length > 0).slice(0, 12),
		sections: list(data.sections)
			.map(record)
			.map((s) => ({
				heading: text(s.heading, 120),
				columns: Math.min(6, Math.max(1, Math.round(Number(s.columns) || 1))),
				hasImage: s.hasImage === true,
			}))
			.slice(0, 15),
		copy: text(data.copy, 6000),
		images: list(data.images)
			.map((url) => text(url, 2000))
			.filter((url) => /^https?:\/\//.test(url))
			.slice(0, 12),
	};
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run worker/services/browser-capture/reference-extract.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/services/browser-capture/types.ts worker/services/browser-capture/reference-extract.ts worker/services/browser-capture/reference-extract.test.ts
git commit -m "feat(capture): define reference captures and extract design from rendered styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reference capture core and clients

**Files:**
- Modify: `worker/services/browser-capture/types.ts` (`CapturePage`, `BrowserCaptureClient`)
- Modify: `worker/services/browser-capture/capture-core.ts` (append `runReferenceCapture`)
- Modify: `worker/services/browser-capture/binding-client.ts`
- Modify: `worker/services/browser-capture/sidecar-client.ts`
- Modify: `scripts/dev-browser-sidecar.ts`
- Test: `worker/services/browser-capture/capture-core.test.ts`
- Test: `worker/services/browser-capture/screenshot-wiring.test.ts`

**Interfaces:**
- Consumes: the Task 3 types, `REFERENCE_EXTRACT_SCRIPT` and `normalizeReferenceDesign`.
- Produces:
  - `runReferenceCapture(page: CapturePage, payload: ReferencePayload): Promise<ReferenceCaptureResult>`;
  - `class ReferenceCaptureError extends Error`;
  - `BrowserCaptureClient.captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult>`, which throws on failure.

- [ ] **Step 1: Write the failing tests**

In `worker/services/browser-capture/capture-core.test.ts`:

1. Change the imports to:

```ts
import { describe, expect, it } from 'vitest';
import { REFERENCE_EXTRACT_SCRIPT } from './reference-extract';
import { ReferenceCaptureError, runReferenceCapture, runScreenshot } from './capture-core';
import type { CapturePage, ReferencePayload, ScreenshotPayload } from './types';
```

2. In `fakePage`, add `reload` and `url` to the fake object, after `evaluate`:

```ts
		reload: async () => null,
		url: () => 'https://preview.estori.app/app-1/',
```

3. Append to the end of the file:

```ts
interface ReferenceFake {
	page: CapturePage;
	calls: string[];
	shotOptions: unknown[];
}

function referencePage(options: { status?: number; contentType?: string } = {}): ReferenceFake {
	const calls: string[] = [];
	const shotOptions: unknown[] = [];
	let shot = 0;
	const page: CapturePage = {
		on: () => undefined,
		setViewport: async (v) => {
			calls.push(`viewport ${v.width}x${v.height}${v.isMobile ? ' mobile' : ''}`);
		},
		goto: async (url, opts) => {
			calls.push(`goto ${url} ${opts?.timeout}`);
			return {
				status: () => options.status ?? 200,
				headers: () => ({ 'content-type': options.contentType ?? 'text/html; charset=utf-8' }),
			};
		},
		reload: async (opts) => {
			calls.push(`reload ${opts?.timeout}`);
			return null;
		},
		url: () => 'https://stripe.com/',
		evaluate: async (script) => {
			if (script === REFERENCE_EXTRACT_SCRIPT) {
				calls.push('extract');
				return { title: 'Stripe', palette: ['#635bff'], fonts: { body: 'Sohne' }, sections: [{ heading: 'Hero', columns: 2 }] };
			}
			calls.push(`run ${script}`);
			return undefined;
		},
		screenshot: async (opts) => {
			shotOptions.push(opts);
			calls.push('screenshot');
			shot += 1;
			return `shot-${shot}`;
		},
		close: async () => {
			calls.push('close');
		},
	};
	return { page, calls, shotOptions };
}

const REFERENCE: ReferencePayload = { url: 'https://stripe.com', timeoutMs: 20_000, settleMs: 0 };

describe('runReferenceCapture', () => {
	it('takes three desktop shots, extracts the design, then a phone shot', async () => {
		const fake = referencePage();
		const result = await runReferenceCapture(fake.page, REFERENCE);
		expect(fake.calls).toEqual([
			'viewport 1280x800',
			'goto https://stripe.com 20000',
			'screenshot',
			'run window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.4))',
			'screenshot',
			'run window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.8))',
			'screenshot',
			'extract',
			'viewport 390x844 mobile',
			'reload 20000',
			'run window.scrollTo(0, 0)',
			'screenshot',
			'close',
		]);
		expect(result.finalUrl).toBe('https://stripe.com/');
		expect(result.shots.map((s) => [s.kind, s.jpegBase64, s.width, s.height])).toEqual([
			['desktop-top', 'shot-1', 1280, 800],
			['desktop-middle', 'shot-2', 1280, 800],
			['desktop-lower', 'shot-3', 1280, 800],
			['mobile-top', 'shot-4', 390, 844],
		]);
		expect(result.design.palette).toEqual(['#635bff']);
		expect(result.design.sections).toEqual([{ heading: 'Hero', columns: 2, hasImage: false }]);
	});

	it('takes viewport-only JPEGs at quality 70', async () => {
		const fake = referencePage();
		await runReferenceCapture(fake.page, REFERENCE);
		expect(fake.shotOptions).toHaveLength(4);
		for (const options of fake.shotOptions) {
			expect(options).toEqual({ type: 'jpeg', quality: 70, fullPage: false, encoding: 'base64' });
		}
	});

	it('fails on an HTTP error and still closes the page', async () => {
		const fake = referencePage({ status: 404 });
		await expect(runReferenceCapture(fake.page, REFERENCE)).rejects.toThrow(new ReferenceCaptureError('HTTP 404'));
		expect(fake.calls).toEqual(['viewport 1280x800', 'goto https://stripe.com 20000', 'close']);
	});

	it('fails on a page that is not HTML', async () => {
		const fake = referencePage({ contentType: 'application/pdf' });
		await expect(runReferenceCapture(fake.page, REFERENCE)).rejects.toThrow('not an HTML page');
		expect(fake.calls).toContain('close');
	});
});
```

In `worker/services/browser-capture/screenshot-wiring.test.ts`, append:

```ts
describe('reference capture clients', () => {
	it('captures references through the BROWSER binding', () => {
		expect(source('/worker/services/browser-capture/binding-client.ts')).toContain('runReferenceCapture(page, payload)');
	});

	it('sends reference URLs to the dev sidecar unchanged', () => {
		const client = source('/worker/services/browser-capture/sidecar-client.ts');
		const reference = between(client, 'async captureReference(', 'async captureConsoleLogs(');
		expect(reference).toContain('/capture-reference');
		expect(reference).not.toContain('this.localUrl(');
		const sidecar = source('/scripts/dev-browser-sidecar.ts');
		expect(sidecar).toContain("req.url === '/capture-reference'");
		expect(sidecar).toContain('runReferenceCapture(');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/services/browser-capture/capture-core.test.ts worker/services/browser-capture/screenshot-wiring.test.ts`
Expected: FAIL. `runReferenceCapture` and `ReferenceCaptureError` are not exported, and the new client guards fail. The earlier tests in both files pass.

- [ ] **Step 3: Extend the page and client types**

In `worker/services/browser-capture/types.ts`:

1. Add, directly above `export interface CapturePage {`:

```ts
export interface CaptureNavigationResponse {
	status(): number;
	headers(): Record<string, string>;
}

```

2. Replace the `CapturePage` interface with:

```ts
export interface CapturePage {
	on(event: 'console', cb: (msg: CaptureConsoleMessage) => void): unknown;
	on(event: 'pageerror', cb: (err: { message: string; stack?: string }) => void): unknown;
	on(event: 'requestfailed', cb: (req: CaptureHttpRequest) => void): unknown;
	on(event: 'response', cb: (res: CaptureHttpResponse) => void): unknown;
	setViewport(v: { width: number; height: number; isMobile?: boolean; hasTouch?: boolean }): Promise<void>;
	goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<CaptureNavigationResponse | null>;
	reload(opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
	url(): string;
	evaluate(script: string): Promise<unknown>;
	screenshot(opts: { type: 'png' | 'jpeg'; fullPage: boolean; encoding: 'base64'; quality?: number }): Promise<string>;
	close(): Promise<void>;
}
```

3. Add to `BrowserCaptureClient`, after `captureScreenshot`:

```ts
	/** Captures a reference page: screenshots plus design data; throws on failure. */
	captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult>;
```

- [ ] **Step 4: Write the capture core**

In `worker/services/browser-capture/capture-core.ts`, extend the type import to include `CaptureNavigationResponse`, `ReferenceCaptureResult`, `ReferencePayload`, `ReferenceShot` and `ReferenceShotKind`. Add `import { REFERENCE_EXTRACT_SCRIPT, normalizeReferenceDesign } from './reference-extract';` after it, and append:

```ts

/** A reference page that loaded but cannot be used, with the reason as its message. */
export class ReferenceCaptureError extends Error {}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const REFERENCE_JPEG = { type: 'jpeg', quality: 70, fullPage: false, encoding: 'base64' } as const;
const SCROLL_STOPS: Array<[ReferenceShotKind, number]> = [
	['desktop-middle', 0.4],
	['desktop-lower', 0.8],
];

function assertHtmlPage(response: CaptureNavigationResponse | null): void {
	if (!response) return;
	const status = response.status();
	if (status >= 400) throw new ReferenceCaptureError(`HTTP ${status}`);
	const type = response.headers()['content-type'] ?? '';
	if (type && !type.includes('text/html') && !type.includes('application/xhtml')) {
		throw new ReferenceCaptureError('not an HTML page');
	}
}

/**
 * Captures a reference page: three desktop screenshots down the page, the
 * design data from its rendered styles, and a phone screenshot of the top.
 */
export async function runReferenceCapture(
	page: CapturePage,
	payload: ReferencePayload,
): Promise<ReferenceCaptureResult> {
	const settle = () =>
		payload.settleMs > 0 ? new Promise<void>((r) => setTimeout(r, payload.settleMs)) : Promise.resolve();
	try {
		await page.setViewport(DESKTOP);
		assertHtmlPage(await page.goto(payload.url, { waitUntil: 'networkidle2', timeout: payload.timeoutMs }));
		await settle();
		const shots: ReferenceShot[] = [
			{ kind: 'desktop-top', jpegBase64: await page.screenshot(REFERENCE_JPEG), ...DESKTOP },
		];
		for (const [kind, fraction] of SCROLL_STOPS) {
			await page.evaluate(`window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * ${fraction}))`);
			await settle();
			shots.push({ kind, jpegBase64: await page.screenshot(REFERENCE_JPEG), ...DESKTOP });
		}
		const design = normalizeReferenceDesign(await page.evaluate(REFERENCE_EXTRACT_SCRIPT));
		const finalUrl = page.url();

		await page.setViewport(PHONE);
		await page.reload({ waitUntil: 'networkidle2', timeout: payload.timeoutMs });
		await settle();
		await page.evaluate('window.scrollTo(0, 0)');
		shots.push({
			kind: 'mobile-top',
			jpegBase64: await page.screenshot(REFERENCE_JPEG),
			width: PHONE.width,
			height: PHONE.height,
		});
		return { finalUrl, shots, design };
	} finally {
		try {
			await page.close();
		} catch {
			// ignore close failures
		}
	}
}
```

- [ ] **Step 5: Wire the binding client, the sidecar client and the dev sidecar**

In `worker/services/browser-capture/binding-client.ts`:
- import `runReferenceCapture` next to `runCapture` and `runScreenshot`;
- add `ReferenceCaptureResult` and `ReferencePayload` to the type import;
- add after `captureScreenshot`:

```ts
	async captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult> {
		return this.withPage(payload.url, (page) => runReferenceCapture(page, payload));
	}
```

In `worker/services/browser-capture/sidecar-client.ts`, add `ReferenceCaptureResult` and `ReferencePayload` to the type import, and add directly above `async captureConsoleLogs(`:

```ts
	/**
	 * Reference URLs are public sites, so unlike previews they are sent to the
	 * sidecar unchanged. Throws on failure, like screenshots.
	 */
	async captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult> {
		const resp = await fetch(`${this.sidecarBase()}/capture-reference`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(`Dev browser sidecar reference capture returned ${resp.status}: ${text.slice(0, 200)}`);
		}
		return (await resp.json()) as ReferenceCaptureResult;
	}

```

In `scripts/dev-browser-sidecar.ts`:
- import `runReferenceCapture` next to `runCapture` and `runScreenshot`;
- add `ReferencePayload` to the type import;
- add after `handleScreenshot`:

```ts
async function handleReference(payload: ReferencePayload) {
	const browser = await getBrowser();
	const page: Page = await browser.newPage();
	return runReferenceCapture(page as unknown as CapturePage, payload);
}
```

- add a route after the `/capture-screenshot` route:

```ts
		if (req.method === 'POST' && req.url === '/capture-reference') {
			const payload = await readPayload<ReferencePayload>(req, res);
			if (!payload) return;
			return sendJson(res, 200, await handleReference(payload));
		}
```

- append `, POST /capture-reference` to the endpoints log line.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run worker/services/browser-capture/capture-core.test.ts worker/services/browser-capture/screenshot-wiring.test.ts worker/services/browser-capture/reference-extract.test.ts`
Expected: PASS, including the earlier `runScreenshot` tests and screenshot guards.

- [ ] **Step 7: Typecheck the Worker and the sidecar script**

Run: `npm run typecheck`
Expected: only the 4 baseline errors.

Run: `npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node scripts/dev-browser-sidecar.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add worker/services/browser-capture/types.ts worker/services/browser-capture/capture-core.ts worker/services/browser-capture/capture-core.test.ts worker/services/browser-capture/binding-client.ts worker/services/browser-capture/sidecar-client.ts worker/services/browser-capture/screenshot-wiring.test.ts scripts/dev-browser-sidecar.ts
git commit -m "feat(capture): capture reference pages as screenshots and design data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reference URL rules, digest and summary

**Files:**
- Create: `worker/agents/think/references.ts`
- Test: `worker/agents/think/references.test.ts`

**Interfaces:**
- Consumes: `ReferenceDesign` and `ReferenceShotKind` from Task 3.
- Produces, from `worker/agents/think/references.ts`:
  - `MAX_REFERENCE_URLS = 3`;
  - `extractReferenceUrls(text, max?): { urls: string[]; skipped: string[] }`;
  - `type UrlRejection`;
  - `validateReferenceUrl(raw): { ok: true; url: URL } | { ok: false; reason: UrlRejection }`;
  - `referenceHost(raw): string`;
  - `CapturedReference`, `FailedReference` and `ReferenceOutcome`;
  - `referenceShotLabel(host, kind): string`;
  - `formatReferenceDigest(outcome, index): string`;
  - `describeReferenceSummary(design): string`.

- [ ] **Step 1: Write the failing test**

Create `worker/agents/think/references.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ReferenceDesign } from '../../services/browser-capture/types';
import {
	describeReferenceSummary,
	extractReferenceUrls,
	formatReferenceDigest,
	referenceHost,
	referenceShotLabel,
	validateReferenceUrl,
	type ReferenceOutcome,
} from './references';

const DESIGN: ReferenceDesign = {
	title: 'Stripe | Financial infrastructure',
	palette: ['#0a2540', '#635bff', '#ffffff'],
	fonts: { body: 'Inter', headings: 'Playfair Display', buttons: 'Inter' },
	headings: [{ tag: 'h1', size: '56px', weight: '700' }],
	button: { background: '#635bff', color: '#ffffff', radius: '4px' },
	nav: ['Products', 'Pricing'],
	sections: [
		{ heading: 'Grow your revenue', columns: 2, hasImage: true },
		{ heading: '', columns: 6, hasImage: false },
	],
	copy: 'Financial infrastructure to grow your revenue.',
	images: ['https://images.example.com/hero.png'],
};

const CAPTURED: ReferenceOutcome = {
	url: 'https://stripe.com',
	host: 'stripe.com',
	ok: true,
	captureId: 'c1',
	shots: [
		{ kind: 'desktop-top', r2Key: 'screenshots/app/ref-c1-desktop-top.jpg' },
		{ kind: 'mobile-top', r2Key: 'screenshots/app/ref-c1-mobile-top.jpg' },
	],
	design: DESIGN,
};

describe('extractReferenceUrls', () => {
	it('finds URLs and strips trailing punctuation, brackets and markdown', () => {
		expect(
			extractReferenceUrls('Like https://stripe.com, and [this](https://linear.app/features). Also <https://vercel.com>!').urls,
		).toEqual(['https://stripe.com', 'https://linear.app/features', 'https://vercel.com']);
	});

	it('keeps balanced parentheses that belong to the URL', () => {
		expect(extractReferenceUrls('see https://en.wikipedia.org/wiki/Swiss_(design) please').urls).toEqual([
			'https://en.wikipedia.org/wiki/Swiss_(design)',
		]);
	});

	it('removes duplicates and keeps the first three in order', () => {
		const result = extractReferenceUrls('https://a.com https://b.com https://a.com https://c.com https://d.com https://e.com');
		expect(result.urls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
		expect(result.skipped).toEqual(['https://d.com', 'https://e.com']);
	});

	it('finds nothing in plain text', () => {
		expect(extractReferenceUrls('Build a store called "Trailhead Supply".')).toEqual({ urls: [], skipped: [] });
	});
});

describe('validateReferenceUrl', () => {
	it('accepts public http and https pages', () => {
		expect(validateReferenceUrl('https://stripe.com/pricing').ok).toBe(true);
		expect(validateReferenceUrl('http://example.com').ok).toBe(true);
	});

	it.each([
		['ftp://example.com', 'not-http'],
		['javascript:alert(1)', 'not-http'],
		['not a url', 'invalid'],
		['http://localhost:3000', 'private-address'],
		['http://app.localhost', 'private-address'],
		['http://127.0.0.1', 'private-address'],
		['http://10.1.2.3', 'private-address'],
		['http://172.20.0.1', 'private-address'],
		['http://192.168.1.10', 'private-address'],
		['http://169.254.169.254/latest/meta-data', 'private-address'],
		['http://100.64.0.1', 'private-address'],
		['http://0.0.0.0', 'private-address'],
		['http://2130706433', 'private-address'],
		['http://[::1]', 'private-address'],
		['http://[fd00:ec2::254]', 'private-address'],
		['http://[fe80::1]', 'private-address'],
		['http://[::ffff:127.0.0.1]', 'private-address'],
		['https://estori.app', 'estori-host'],
		['https://preview.estori.app/space/x/preview/main/', 'estori-host'],
	])('rejects %s as %s', (url, reason) => {
		expect(validateReferenceUrl(url)).toEqual({ ok: false, reason });
	});

	it('does not reject public addresses that merely look similar', () => {
		expect(validateReferenceUrl('http://172.32.0.1').ok).toBe(true);
		expect(validateReferenceUrl('https://notestori.app').ok).toBe(true);
	});
});

describe('reference wording', () => {
	it('names the host without www', () => {
		expect(referenceHost('https://www.stripe.com/pricing')).toBe('stripe.com');
		expect(referenceHost('not a url')).toBe('not a url');
	});

	it('labels each screenshot', () => {
		expect(referenceShotLabel('stripe.com', 'desktop-middle')).toBe('Reference stripe.com: desktop, middle');
		expect(referenceShotLabel('stripe.com', 'mobile-top')).toBe('Reference stripe.com: phone, top');
	});

	it('writes a digest the model can follow', () => {
		expect(formatReferenceDigest(CAPTURED, 1)).toBe(
			[
				'Reference 1: https://stripe.com ("Stripe | Financial infrastructure")',
				'Palette (most used first): #0a2540, #635bff, #ffffff',
				'Fonts: body "Inter", headings "Playfair Display", buttons "Inter"',
				'Headings: h1 56px/700',
				'Buttons: background #635bff, text #ffffff, radius 4px',
				'Nav: Products, Pricing',
				'Sections, top to bottom:',
				'  1. Grow your revenue: 2 columns, image',
				'  2. (no heading): 6 columns',
				"Copy (for structure; reuse only if the user says the site is theirs): Financial infrastructure to grow your revenue.",
				'Image URLs (only if the user says the site is theirs): https://images.example.com/hero.png',
				'Screenshots follow: desktop, top; phone, top.',
			].join('\n'),
		);
	});

	it('tells the model when a reference could not be captured', () => {
		const failed: ReferenceOutcome = { url: 'https://x.com', host: 'x.com', ok: false, reason: 'HTTP 403' };
		expect(formatReferenceDigest(failed, 2)).toBe(
			"Reference 2: https://x.com could not be captured (HTTP 403); work from the user's description.",
		);
	});

	it('summarizes a capture for the reference card', () => {
		expect(describeReferenceSummary(DESIGN)).toBe('Desktop + mobile · 3 colors · Inter / Playfair Display · 2 sections');
		expect(describeReferenceSummary({ ...DESIGN, fonts: { body: 'Inter', headings: 'Inter', buttons: 'Inter' } })).toBe(
			'Desktop + mobile · 3 colors · Inter · 2 sections',
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/agents/think/references.test.ts`
Expected: FAIL. The module `./references` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `worker/agents/think/references.ts`:

```ts
/**
 * Reference URLs in a user's message: which ones to capture, which are safe
 * to open, and how a capture is described to the model and in the chat.
 */

import type { ReferenceDesign, ReferenceShotKind } from '../../services/browser-capture/types';

export const MAX_REFERENCE_URLS = 3;

export interface ExtractedReferenceUrls {
	urls: string[];
	skipped: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', "'", '"', '*', '_']);

function count(text: string, char: string): number {
	return text.split(char).length - 1;
}

/** Drops trailing punctuation, keeping a closing bracket the URL itself opened. */
function trimUrl(raw: string): string {
	let url = raw;
	while (url.length > 0 && TRAILING.has(url[url.length - 1])) {
		const last = url[url.length - 1];
		if (last === ')' && count(url, '(') >= count(url, ')')) break;
		if (last === ']' && count(url, '[') >= count(url, ']')) break;
		url = url.slice(0, -1);
	}
	return url;
}

export function extractReferenceUrls(text: string, max = MAX_REFERENCE_URLS): ExtractedReferenceUrls {
	const found: string[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(match[0]);
		if (url && !found.includes(url)) found.push(url);
	}
	return { urls: found.slice(0, max), skipped: found.slice(max) };
}

export type UrlRejection = 'not-http' | 'private-address' | 'estori-host' | 'invalid';

function ipv4Octets(host: string): number[] | null {
	const parts = host.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
	return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}

function isPrivateIpv6(host: string): boolean {
	if (host === '::' || host === '::1') return true;
	if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
	if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
	const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
	if (mapped) {
		const high = parseInt(mapped[1], 16);
		const low = parseInt(mapped[2], 16);
		return isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
	}
	const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
	if (dotted) {
		const octets = ipv4Octets(dotted[1]);
		return octets ? isPrivateIpv4(octets) : false;
	}
	return false;
}

/** Only public web pages are captured; Estori's own hosts and private networks never are. */
export function validateReferenceUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: UrlRejection } {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not-http' };
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'estori.app' || host.endsWith('.estori.app')) return { ok: false, reason: 'estori-host' };
	if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'private-address' };
	const octets = ipv4Octets(host);
	if (octets && isPrivateIpv4(octets)) return { ok: false, reason: 'private-address' };
	if (host.includes(':') && isPrivateIpv6(host)) return { ok: false, reason: 'private-address' };
	return { ok: true, url };
}

export function referenceHost(raw: string): string {
	try {
		return new URL(raw).hostname.replace(/^www\./, '');
	} catch {
		return raw;
	}
}

export interface CapturedReference {
	url: string;
	host: string;
	ok: true;
	captureId: string;
	shots: { kind: ReferenceShotKind; r2Key: string }[];
	design: ReferenceDesign;
}

export interface FailedReference {
	url: string;
	host: string;
	ok: false;
	reason: string;
}

export type ReferenceOutcome = CapturedReference | FailedReference;

const SHOT_LABELS: Record<ReferenceShotKind, string> = {
	'desktop-top': 'desktop, top',
	'desktop-middle': 'desktop, middle',
	'desktop-lower': 'desktop, lower',
	'mobile-top': 'phone, top',
};

export function referenceShotLabel(host: string, kind: ReferenceShotKind): string {
	return `Reference ${host}: ${SHOT_LABELS[kind]}`;
}

/** The text the model reads for one reference, numbered from 1. */
export function formatReferenceDigest(outcome: ReferenceOutcome, index: number): string {
	if (!outcome.ok) {
		return `Reference ${index}: ${outcome.url} could not be captured (${outcome.reason}); work from the user's description.`;
	}
	const d = outcome.design;
	const lines = [
		`Reference ${index}: ${outcome.url}${d.title ? ` ("${d.title}")` : ''}`,
		`Palette (most used first): ${d.palette.join(', ') || 'unknown'}`,
		`Fonts: body "${d.fonts.body}", headings "${d.fonts.headings}", buttons "${d.fonts.buttons}"`,
	];
	if (d.headings.length > 0) {
		lines.push(`Headings: ${d.headings.map((h) => `${h.tag} ${h.size}/${h.weight}`).join(', ')}`);
	}
	if (d.button) {
		lines.push(`Buttons: background ${d.button.background}, text ${d.button.color}, radius ${d.button.radius}`);
	}
	if (d.nav.length > 0) lines.push(`Nav: ${d.nav.join(', ')}`);
	if (d.sections.length > 0) {
		lines.push('Sections, top to bottom:');
		d.sections.forEach((s, i) => {
			const columns = `${s.columns} column${s.columns === 1 ? '' : 's'}`;
			lines.push(`  ${i + 1}. ${s.heading || '(no heading)'}: ${columns}${s.hasImage ? ', image' : ''}`);
		});
	}
	if (d.copy) lines.push(`Copy (for structure; reuse only if the user says the site is theirs): ${d.copy}`);
	if (d.images.length > 0) {
		lines.push(`Image URLs (only if the user says the site is theirs): ${d.images.join(', ')}`);
	}
	lines.push(`Screenshots follow: ${outcome.shots.map((s) => SHOT_LABELS[s.kind]).join('; ')}.`);
	return lines.join('\n');
}

/** One line for the reference card, e.g. "Desktop + mobile · 6 colors · Inter / Playfair Display · 7 sections". */
export function describeReferenceSummary(design: ReferenceDesign): string {
	const { body, headings } = design.fonts;
	const fonts = !headings || headings === body ? body : `${body} / ${headings}`;
	const parts = ['Desktop + mobile', `${design.palette.length} colors`];
	if (fonts) parts.push(fonts);
	parts.push(`${design.sections.length} sections`);
	return parts.join(' · ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/agents/think/references.test.ts`
Expected: PASS: 30 tests, with the `it.each` table counting each row.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/references.ts worker/agents/think/references.test.ts
git commit -m "feat(think): pick safe reference URLs and describe captures for the model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Capturing references in parallel and storing the screenshots

**Files:**
- Create: `worker/agents/think/reference-service.ts`
- Test: `worker/agents/think/reference-service.test.ts`

**Interfaces:**
- Consumes:
  - `validateReferenceUrl`, `referenceHost` and `ReferenceOutcome` (Task 5);
  - `BrowserCaptureClient.captureReference` and the Task 3 types;
  - `ReferenceCaptureError` (Task 4).
- Produces, from `worker/agents/think/reference-service.ts`:
  - `ReferenceDeps`;
  - `captureReferences(urls: string[], deps: ReferenceDeps, onStart: (host: string, index: number, total: number) => void): Promise<ReferenceOutcome[]>`;
  - `referenceFailureReason(error: unknown): string`.

- [ ] **Step 1: Write the failing test**

Create `worker/agents/think/reference-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ReferenceCaptureResult, ReferencePayload } from '../../services/browser-capture/types';
import { ReferenceCaptureError } from '../../services/browser-capture/capture-core';
import { captureReferences, referenceFailureReason, type ReferenceDeps } from './reference-service';

const RESULT: ReferenceCaptureResult = {
	finalUrl: 'https://stripe.com/',
	shots: [
		{ kind: 'desktop-top', jpegBase64: 'AAAA', width: 1280, height: 800 },
		{ kind: 'mobile-top', jpegBase64: 'BBBB', width: 390, height: 844 },
	],
	design: {
		title: 'Stripe',
		palette: [],
		fonts: { body: '', headings: '', buttons: '' },
		headings: [],
		button: null,
		nav: [],
		sections: [],
		copy: '',
		images: [],
	},
};

function deps(capture: (payload: ReferencePayload) => Promise<ReferenceCaptureResult>, putError?: Error) {
	const payloads: ReferencePayload[] = [];
	const puts: { key: string; contentType: string; bytes: number }[] = [];
	let ids = 0;
	const value: ReferenceDeps = {
		client: {
			captureReference: (payload) => {
				payloads.push(payload);
				return capture(payload);
			},
		},
		bucket: {
			put: async (key, bytes, options) => {
				if (putError) throw putError;
				puts.push({ key, contentType: options.httpMetadata.contentType, bytes: bytes.byteLength });
				return null;
			},
		},
		appId: 'app-1',
		newCaptureId: () => `c${++ids}`,
	};
	return { value, payloads, puts };
}

describe('captureReferences', () => {
	it('captures a page and stores its screenshots under the app', async () => {
		const d = deps(async () => RESULT);
		const outcomes = await captureReferences(['https://stripe.com'], d.value, () => undefined);
		expect(d.payloads).toEqual([{ url: 'https://stripe.com/', timeoutMs: 20_000, settleMs: 1_500 }]);
		expect(d.puts).toEqual([
			{ key: 'screenshots/app-1/ref-c1-desktop-top.jpg', contentType: 'image/jpeg', bytes: 3 },
			{ key: 'screenshots/app-1/ref-c1-mobile-top.jpg', contentType: 'image/jpeg', bytes: 3 },
		]);
		expect(outcomes).toEqual([
			{
				url: 'https://stripe.com',
				host: 'stripe.com',
				ok: true,
				captureId: 'c1',
				shots: [
					{ kind: 'desktop-top', r2Key: 'screenshots/app-1/ref-c1-desktop-top.jpg' },
					{ kind: 'mobile-top', r2Key: 'screenshots/app-1/ref-c1-mobile-top.jpg' },
				],
				design: RESULT.design,
			},
		]);
	});

	it('rejects unsafe URLs without opening them', async () => {
		const d = deps(async () => RESULT);
		const outcomes = await captureReferences(['http://localhost:3000'], d.value, () => undefined);
		expect(d.payloads).toEqual([]);
		expect(outcomes).toEqual([{ url: 'http://localhost:3000', host: 'localhost', ok: false, reason: 'not a public web page' }]);
	});

	it('captures several pages at the same time', async () => {
		const started: string[] = [];
		const releases: Array<() => void> = [];
		const d = deps(
			(payload) =>
				new Promise((resolve) => {
					started.push(payload.url);
					releases.push(() => resolve(RESULT));
				}),
		);
		const pending = captureReferences(['https://a.com', 'https://b.com'], d.value, () => undefined);
		await Promise.resolve();
		expect(started).toEqual(['https://a.com/', 'https://b.com/']);
		releases.forEach((release) => release());
		expect((await pending).every((o) => o.ok)).toBe(true);
	});

	it('reports progress as the first unfinished page, in order', async () => {
		const releases = new Map<string, () => void>();
		const d = deps(
			(payload) =>
				new Promise((resolve) => {
					releases.set(payload.url, () => resolve(RESULT));
				}),
		);
		const seen: string[] = [];
		const pending = captureReferences(['https://a.com', 'https://b.com'], d.value, (host, index, total) =>
			seen.push(`${host} ${index}/${total}`),
		);
		await Promise.resolve();
		releases.get('https://a.com/')?.();
		await new Promise((r) => setTimeout(r, 0));
		releases.get('https://b.com/')?.();
		await pending;
		expect(seen).toEqual(['a.com 1/2', 'b.com 2/2']);
	});

	it('fails a page whose screenshots cannot be stored', async () => {
		const d = deps(async () => RESULT, new Error('R2 unavailable'));
		const [outcome] = await captureReferences(['https://stripe.com'], d.value, () => undefined);
		expect(outcome).toEqual({ url: 'https://stripe.com', host: 'stripe.com', ok: false, reason: 'the screenshots could not be saved' });
	});

	it('fails a page that takes longer than its budget', async () => {
		const d = deps(() => new Promise(() => undefined));
		const [outcome] = await captureReferences(['https://slow.com'], { ...d.value, budgetMs: 10 }, () => undefined);
		expect(outcome).toEqual({ url: 'https://slow.com', host: 'slow.com', ok: false, reason: 'timed out' });
	});
});

describe('referenceFailureReason', () => {
	it.each([
		[new ReferenceCaptureError('HTTP 403'), 'HTTP 403'],
		[new ReferenceCaptureError('not an HTML page'), 'not an HTML page'],
		[new Error('Navigation timeout of 20000 ms exceeded'), 'timed out'],
		[new Error('429 Too Many Requests'), 'Browser capture busy, try again'],
		[new Error('Browser Rendering concurrency limit reached'), 'Browser capture busy, try again'],
		[new Error('net::ERR_NAME_NOT_RESOLVED at https://nope.example'), 'the page could not be reached'],
		[new Error('something else'), 'the page could not be loaded'],
	])('maps %s to %s', (error, reason) => {
		expect(referenceFailureReason(error)).toBe(reason);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/agents/think/reference-service.test.ts`
Expected: FAIL. The module `./reference-service` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `worker/agents/think/reference-service.ts`:

```ts
/**
 * Captures the reference URLs of a turn in parallel and stores their
 * screenshots in R2, where the screenshot endpoint and the model transport
 * can read them. Never throws: every URL ends as a captured or failed outcome.
 */

import { ReferenceCaptureError } from '../../services/browser-capture/capture-core';
import type { BrowserCaptureClient } from '../../services/browser-capture/types';
import { referenceHost, validateReferenceUrl, type ReferenceOutcome } from './references';

export const REFERENCE_NAV_TIMEOUT_MS = 20_000;
export const REFERENCE_SETTLE_MS = 1_500;
export const REFERENCE_CAPTURE_BUDGET_MS = 45_000;

export interface ReferenceDeps {
	client: Pick<BrowserCaptureClient, 'captureReference'>;
	bucket: { put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown> };
	appId: string;
	newCaptureId: () => string;
	/** Overall time allowed per URL; defaults to REFERENCE_CAPTURE_BUDGET_MS. */
	budgetMs?: number;
}

class CaptureTimeout extends Error {}
class StorageFailure extends Error {}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new CaptureTimeout('timed out')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** A short reason for the reference card and the model. */
export function referenceFailureReason(error: unknown): string {
	if (error instanceof CaptureTimeout) return 'timed out';
	if (error instanceof StorageFailure) return 'the screenshots could not be saved';
	if (error instanceof ReferenceCaptureError) return error.message;
	const message = error instanceof Error ? error.message : String(error);
	if (/\b429\b|too many|rate limit|concurrenc/i.test(message)) return 'Browser capture busy, try again';
	if (/timeout|timed out/i.test(message)) return 'timed out';
	if (/net::|ERR_/.test(message)) return 'the page could not be reached';
	return 'the page could not be loaded';
}

async function captureOne(url: string, deps: ReferenceDeps): Promise<ReferenceOutcome> {
	const host = referenceHost(url);
	const valid = validateReferenceUrl(url);
	if (!valid.ok) return { url, host, ok: false, reason: 'not a public web page' };
	try {
		const result = await withBudget(
			deps.client.captureReference({
				url: valid.url.toString(),
				timeoutMs: REFERENCE_NAV_TIMEOUT_MS,
				settleMs: REFERENCE_SETTLE_MS,
			}),
			deps.budgetMs ?? REFERENCE_CAPTURE_BUDGET_MS,
		);
		const captureId = deps.newCaptureId();
		const shots = await Promise.all(
			result.shots.map(async (shot) => {
				const r2Key = `screenshots/${deps.appId}/ref-${captureId}-${shot.kind}.jpg`;
				try {
					await deps.bucket.put(r2Key, Buffer.from(shot.jpegBase64, 'base64'), {
						httpMetadata: { contentType: 'image/jpeg' },
					});
				} catch (error) {
					throw new StorageFailure(error instanceof Error ? error.message : String(error));
				}
				return { kind: shot.kind, r2Key };
			}),
		);
		return { url, host, ok: true, captureId, shots, design: result.design };
	} catch (error) {
		return { url, host, ok: false, reason: referenceFailureReason(error) };
	}
}

/**
 * Captures every URL at once. `onStart` names the first URL still being
 * captured, in order, and is called again whenever that changes.
 */
export async function captureReferences(
	urls: string[],
	deps: ReferenceDeps,
	onStart: (host: string, index: number, total: number) => void,
): Promise<ReferenceOutcome[]> {
	const finished = new Set<number>();
	let announced = -1;
	const announceNext = () => {
		const next = urls.findIndex((_, i) => !finished.has(i));
		if (next === -1 || next === announced) return;
		announced = next;
		onStart(referenceHost(urls[next]), next + 1, urls.length);
	};
	announceNext();
	return Promise.all(
		urls.map(async (url, i) => {
			try {
				return await captureOne(url, deps);
			} finally {
				finished.add(i);
				announceNext();
			}
		}),
	);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/agents/think/reference-service.test.ts`
Expected: PASS: 13 tests, with the `it.each` table counting each row.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/reference-service.ts worker/agents/think/reference-service.test.ts
git commit -m "feat(think): capture a turn's references in parallel and store their screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reference messages, the capturing progress state and its wording

**Files:**
- Modify: `worker/api/websocketTypes.ts` (`BuildActivity`, a new `ReferenceCard`, two message types, and the union)
- Modify: `worker/agents/constants.ts` (after `BUILD_PROGRESS`)
- Modify: `src/api-types.ts` (WebSocket type re-exports)
- Modify: `worker/agents/think/build-progress.ts` (the tracker)
- Modify: `src/routes/chat/utils/build-status.ts` (`describeBuildActivityLabel`)
- Test: `worker/agents/think/build-progress.test.ts`
- Test: `src/routes/chat/utils/build-status.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `BuildActivity` gains the variant `{ kind: 'capturing'; host: string; index: number; total: number }`.
  - New types:
    - `ReferenceCard = { url; host; ok: true; summary; thumbnailUrl } | { url; host; ok: false; reason }`;
    - `reference_captured` messages: `{ conversationId; reference: ReferenceCard }`;
    - `references_skipped` messages: `{ conversationId; urls: string[] }`.
  - Constants: `WebSocketMessageResponses.REFERENCE_CAPTURED` and `REFERENCES_SKIPPED`.
  - `BuildProgressTracker.beginCapture(host, index, total, now): BuildProgress`.
  - `BuildProgressTracker.endCapture(now): BuildProgress | null`.
  - `describeBuildActivityLabel` renders `capturing`.
  - `ReferenceCard` re-exported from `@/api-types`.

- [ ] **Step 1: Write the failing tests**

In `worker/agents/think/build-progress.test.ts`, append inside the `describe('BuildProgressTracker', …)` block, before its closing `});`:

```ts
	it('shows reference capture as the activity until it ends', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.beginCapture('stripe.com', 1, 2, START + 100).activity).toEqual({
			kind: 'capturing',
			host: 'stripe.com',
			index: 1,
			total: 2,
		});
		expect(tracker.beginCapture('linear.app', 2, 2, START + 200).activity).toEqual({
			kind: 'capturing',
			host: 'linear.app',
			index: 2,
			total: 2,
		});
		expect(tracker.endCapture(START + 300)?.activity).toEqual({ kind: 'thinking' });
	});

	it('returns to the build activity after capture', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.endCapture(START)).toBeNull();
		tracker.beginCapture('stripe.com', 1, 1, START);
		tracker.endCapture(START);
		expect(tracker.onChunk(STEP, START)?.activity).toEqual({ kind: 'thinking' });
		expect(tracker.onChunk(open('c1', 'write'), START)?.activity).toEqual({ kind: 'tool', toolName: 'write' });
	});
```

In `src/routes/chat/utils/build-status.test.ts`, append inside the wording `describe` block:

```ts
	it('names the reference being captured', () => {
		expect(describeBuildActivity({ kind: 'capturing', host: 'stripe.com', index: 1, total: 2 })).toBe(
			'Capturing stripe.com · 1 of 2',
		);
	});
```

(`describeBuildActivity` is already imported in that file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/agents/think/build-progress.test.ts src/routes/chat/utils/build-status.test.ts`
Expected: FAIL. `beginCapture` is not a function, and the capturing wording returns the tool label path instead. Existing tests pass.

- [ ] **Step 3: Add the shared types and constants**

In `worker/api/websocketTypes.ts`:

1. Replace the `BuildActivity` type with:

```ts
/** What a running Think build is doing right now. */
export type BuildActivity =
	| { kind: 'thinking' }
	| { kind: 'tool'; toolName: string; path?: string; lines?: number }
	| { kind: 'capturing'; host: string; index: number; total: number };
```

2. Directly after `type BuildProgressMessage = …;`, add:

```ts

/** A reference URL as the chat shows it: captured with a thumbnail, or failed with a reason. */
export type ReferenceCard =
	| { url: string; host: string; ok: true; summary: string; thumbnailUrl: string }
	| { url: string; host: string; ok: false; reason: string };

type ReferenceCapturedMessage = { type: 'reference_captured'; conversationId: string; reference: ReferenceCard };

type ReferencesSkippedMessage = { type: 'references_skipped'; conversationId: string; urls: string[] };
```

3. In the `WebSocketMessage` union, replace the last line `| BuildProgressMessage;` with:

```ts
	| BuildProgressMessage
	| ReferenceCapturedMessage
	| ReferencesSkippedMessage;
```

In `worker/agents/constants.ts`, after `BUILD_PROGRESS: 'build_progress',`, add:

```ts

    // Reference URLs captured for a turn (think only)
    REFERENCE_CAPTURED: 'reference_captured',
    REFERENCES_SKIPPED: 'references_skipped',
```

In `src/api-types.ts`, add `ReferenceCard,` after `BuildProgress,` in the `worker/api/websocketTypes` export list.

- [ ] **Step 4: Teach the tracker the capturing state**

In `worker/agents/think/build-progress.ts`, inside `BuildProgressTracker`:

1. After `private lastSent: …;`, add:

```ts
	/** Set while the host captures reference URLs, before the turn starts. */
	private capturing: { host: string; index: number; total: number } | null = null;
```

2. Replace the body of `onChunk` with:

```ts
		if (!this.apply(chunk)) return null;
		const progress = this.snapshot(now);
		const key = progressKey(progress);
		const { activity } = progress;
		const lines = activity.kind === 'tool' ? activity.lines : undefined;
		const last = this.lastSent;
		if (last && last.key === key && (last.lines === lines || now - last.at < LINE_UPDATE_INTERVAL_MS)) {
			return null;
		}
		this.lastSent = { key, lines, at: now };
		return progress;
```

3. Add after `onChunk`:

```ts
	/** Shows reference capture as the activity; the host sends every returned snapshot. */
	beginCapture(host: string, index: number, total: number, now: number): BuildProgress {
		this.capturing = { host, index, total };
		return this.remember(this.snapshot(now), now);
	}

	/** Ends the capture state; null when no capture was shown. */
	endCapture(now: number): BuildProgress | null {
		if (!this.capturing) return null;
		this.capturing = null;
		return this.remember(this.snapshot(now), now);
	}

	private remember(progress: BuildProgress, now: number): BuildProgress {
		this.lastSent = { key: progressKey(progress), lines: undefined, at: now };
		return progress;
	}
```

4. Make the first line of `private activity(): BuildActivity {`:

```ts
		if (this.capturing) return { kind: 'capturing', ...this.capturing };
```

5. Add at module level, after the class:

```ts
/** What makes two snapshots different enough to send at once. */
function progressKey(progress: BuildProgress): string {
	const { activity } = progress;
	switch (activity.kind) {
		case 'tool':
			return `${progress.step}|tool|${activity.toolName}|${activity.path ?? ''}`;
		case 'capturing':
			return `${progress.step}|capturing|${activity.host}|${activity.index}`;
		default:
			return `${progress.step}|thinking`;
	}
}
```

- [ ] **Step 5: Word the capturing state in the chat**

In `src/routes/chat/utils/build-status.ts`, make `describeBuildActivityLabel`:

```ts
export function describeBuildActivityLabel(activity: BuildActivity): string {
	if (activity.kind === 'thinking') return 'Thinking…';
	if (activity.kind === 'capturing') return `Capturing ${activity.host} · ${activity.index} of ${activity.total}`;
	return getToolActivityLabel(activity.toolName, activity.path ? { path: activity.path } : undefined);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/build-progress.test.ts src/routes/chat/utils/build-status.test.ts`
Expected: PASS, including every existing tracker and wording test.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors.

- [ ] **Step 8: Commit**

```bash
git add worker/api/websocketTypes.ts worker/agents/constants.ts src/api-types.ts worker/agents/think/build-progress.ts worker/agents/think/build-progress.test.ts src/routes/chat/utils/build-status.ts src/routes/chat/utils/build-status.test.ts
git commit -m "feat(think): add reference messages and a capturing progress state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The turn message, hidden parts and the references prompt

**Files:**
- Modify: `worker/types/image-attachment.ts` (append `PendingImage`)
- Create: `worker/agents/think/turn-message.ts`
- Test: `worker/agents/think/turn-message.test.ts`
- Modify: `worker/agents/core/conversation/MessageLoader.ts` (`partText`, near line 108)
- Create: `worker/agents/think/prompts/references.txt`
- Modify: `worker/agents/think/prompts.ts` (import and export `PROMPT_REFERENCES`)
- Modify: `worker/agents/think/persona.ts` (`composeSystemPrompt`)
- Modify: `worker/agents/think/persona.test.ts`
- Test: `worker/agents/think/reference-transport-wiring.test.ts` (add the `MessageLoader` guard)

**Interfaces:**
- Consumes: `agentAssetUrl` (Task 1); `formatReferenceDigest`, `referenceShotLabel` and `ReferenceOutcome` (Task 5).
- Produces:
  - `PendingImage { r2Key: string; mimeType: SupportedImageMimeType }`, from `worker/types/image-attachment.ts`;
  - `buildTurnMessage({ id, text, images, references }): UIMessage` and `isHiddenPart(part: unknown): boolean`, from `turn-message.ts`;
  - `PROMPT_REFERENCES`, from `prompts.ts`;
  - `composeSystemPrompt(base, projectContext)`, which now includes the references prompt.

- [ ] **Step 1: Write the failing tests**

Create `worker/agents/think/turn-message.test.ts`:

```ts
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
```

In `worker/agents/think/persona.test.ts`:
- import `PROMPT_REFERENCES` from `./prompts`;
- replace the `composeSystemPrompt` test with:

```ts
describe('composeSystemPrompt', () => {
	it('places the persona and the references rules between the base prompt and the project context', () => {
		expect(composeSystemPrompt('BASE', 'CONTEXT')).toBe(
			`BASE\n\n${PERSONA_PROMPT}\n\n${PROMPT_REFERENCES}\n\nCONTEXT`,
		);
	});

	it('tells the model how to use references', () => {
		expect(PROMPT_REFERENCES).toContain('design source of truth');
		expect(PROMPT_REFERENCES).toContain('unless the user says the reference is their own site');
		expect(PROMPT_REFERENCES).toContain('ask_questions');
	});
});
```

In `worker/agents/think/reference-transport-wiring.test.ts`:
- add `'/worker/agents/core/conversation/MessageLoader.ts'` to the glob list;
- append:

```ts
describe('reloaded chats', () => {
	it('skip the parts hidden from the user', () => {
		const loader = source('/worker/agents/core/conversation/MessageLoader.ts');
		expect(loader).toContain('if (isHiddenPart(part)) return');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/agents/think/turn-message.test.ts worker/agents/think/persona.test.ts worker/agents/think/reference-transport-wiring.test.ts`
Expected: FAIL. `./turn-message` cannot be resolved, `PROMPT_REFERENCES` is undefined, and the loader guard fails.

- [ ] **Step 3: Add the pending image type and the turn message builder**

Append to `worker/types/image-attachment.ts`:

```ts

/** An uploaded image waiting to be sent with the next Think turn. */
export interface PendingImage {
	r2Key: string;
	mimeType: SupportedImageMimeType;
}
```

Create `worker/agents/think/turn-message.ts`:

```ts
/**
 * Builds the user message for one Think turn: the user's text, a digest per
 * reference, and the attachments and reference screenshots as images. Digests
 * and labels are for the model only and are hidden when a chat is reloaded.
 */

import type { UIMessage } from 'ai';
import type { PendingImage } from '../../types/image-attachment';
import { agentAssetUrl } from './agent-assets';
import { formatReferenceDigest, referenceShotLabel, type ReferenceOutcome } from './references';

type TurnPart = UIMessage['parts'][number];

export interface TurnMessageInput {
	id: string;
	text: string;
	images: PendingImage[];
	references: ReferenceOutcome[];
}

export function isHiddenPart(part: unknown): boolean {
	const metadata = (part as { providerMetadata?: { estori?: { hidden?: unknown } } } | null)?.providerMetadata;
	return metadata?.estori?.hidden === true;
}

function hiddenText(text: string): TurnPart {
	return { type: 'text', text, providerMetadata: { estori: { hidden: true } } };
}

function image(r2Key: string, mediaType: string): TurnPart {
	return { type: 'file', mediaType, url: agentAssetUrl(r2Key) };
}

export function buildTurnMessage({ id, text, images, references }: TurnMessageInput): UIMessage {
	const parts: TurnPart[] = [{ type: 'text', text }];
	references.forEach((outcome, i) => parts.push(hiddenText(formatReferenceDigest(outcome, i + 1))));
	images.forEach((attachment, i) => {
		parts.push(hiddenText(`Attachment ${i + 1}`));
		parts.push(image(attachment.r2Key, attachment.mimeType));
	});
	for (const outcome of references) {
		if (!outcome.ok) continue;
		for (const shot of outcome.shots) {
			parts.push(hiddenText(referenceShotLabel(outcome.host, shot.kind)));
			parts.push(image(shot.r2Key, 'image/jpeg'));
		}
	}
	return { id, role: 'user', parts };
}
```

- [ ] **Step 4: Skip hidden parts on reload**

In `worker/agents/core/conversation/MessageLoader.ts`, add `import { isHiddenPart } from '../../think/turn-message';` with the other imports, and make `partText`:

```ts
function partText(part: AnyUIPart): string {
	if (isHiddenPart(part)) return '';
	return part.type === 'text' && typeof (part as { text?: string }).text === 'string'
		? (part as { text: string }).text
		: '';
}
```

- [ ] **Step 5: Add the references prompt**

Create `worker/agents/think/prompts/references.txt`:

```
# Working from references

Users can attach images and paste reference URLs. Each captured URL arrives in the user's message as a "Reference" digest (palette, fonts, headings, buttons, nav, sections and copy), followed by labeled screenshots: desktop top, middle and lower, and a phone view.

- Treat references as the design source of truth. Match the section count and order, the exact hex colors, the fonts (the same family, or the closest Google Font when it is not available), the spacing, the corner radius and the button style. Use the phone screenshot for the responsive layout.
- Write fresh copy for the user's product and use placeholder or generated images, unless the user says the reference is their own site. Then reuse its copy and its image URLs.
- When it is unclear whether a reference is the user's own site and the answer changes what you build, ask with ask_questions before writing content.
- A reference that could not be captured is marked as such; work from the user's description instead.
- Attached images are usually a design to match or assets to use; follow the user's words about them.
```

In `worker/agents/think/prompts.ts`:
- after the `PROMPT_MAX_STEPS` import, add:

```ts
// Rules for attached images and captured reference URLs, for every model family.
import PROMPT_REFERENCES from './prompts/references.txt?raw';
```

- add `PROMPT_REFERENCES,` to the export list.

In `worker/agents/think/persona.ts`, add `import { PROMPT_REFERENCES } from './prompts';` and make:

```ts
export function composeSystemPrompt(base: string, projectContext: string): string {
	return `${base}\n\n${PERSONA_PROMPT}\n\n${PROMPT_REFERENCES}\n\n${projectContext}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/turn-message.test.ts worker/agents/think/persona.test.ts worker/agents/think/reference-transport-wiring.test.ts worker/agents/think/model-wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors.

- [ ] **Step 8: Commit**

```bash
git add worker/types/image-attachment.ts worker/agents/think/turn-message.ts worker/agents/think/turn-message.test.ts worker/agents/core/conversation/MessageLoader.ts worker/agents/think/prompts/references.txt worker/agents/think/prompts.ts worker/agents/think/persona.ts worker/agents/think/persona.test.ts worker/agents/think/reference-transport-wiring.test.ts
git commit -m "feat(think): build turn messages with references and teach the model to use them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Think host wiring

**Files:**
- Modify: `worker/agents/core/state.ts` (`ThinkState`)
- Modify: `worker/agents/core/behaviors/think.ts` (imports; the `ThinkAgentStub` type near line 47; `initialize`; `handleUserInput`; `build()`; `runPrompt`; new private methods)
- Test: `worker/agents/think/reference-transport-wiring.test.ts` (add host guards)

**Interfaces:**
- Consumes:
  - `PendingImage` and `buildTurnMessage` (Task 8);
  - `extractReferenceUrls`, `describeReferenceSummary` and `ReferenceOutcome` (Task 5);
  - `captureReferences` (Task 6);
  - `beginCapture`, `endCapture`, `ReferenceCard` and the two new constants (Task 7);
  - `getBrowserCaptureClient`, `getPublicUrlForR2Image` and `ScreenshotSecurity` (existing).
- Produces:
  - `ThinkState.pendingImages?: PendingImage[]`;
  - Think turns sent as a `UIMessage` with images and references;
  - `reference_captured` and `references_skipped` broadcasts;
  - capturing progress snapshots.

- [ ] **Step 1: Write the failing guards**

In `worker/agents/think/reference-transport-wiring.test.ts`:
- add `'/worker/agents/core/behaviors/think.ts'` to the glob list;
- add this helper after `source`:

```ts
function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}
```

- append:

```ts
describe('Think host: references and images', () => {
	const THINK = '/worker/agents/core/behaviors/think.ts';

	it('queues the first prompt images and appends later ones', () => {
		const think = source(THINK);
		expect(between(think, 'async initialize(', 'async handleUserInput(')).toContain(
			'pendingImages: (initArgs.images ?? []).map(toPendingImage),',
		);
		expect(between(think, 'async handleUserInput(', 'async build(): Promise<void> {')).toContain(
			'pendingImages: [...(this.state.pendingImages ?? []), ...processedImages.map(toPendingImage)],',
		);
	});

	it('captures references before running the turn and sends one message', () => {
		const build = between(source(THINK), 'async build(): Promise<void> {', 'private async runPrompt(');
		expect(build).toContain('pendingUserInputs: [], pendingImages: []');
		const capture = build.indexOf('await this.captureTurnReferences(compiled, conversationId)');
		const run = build.indexOf('await this.runPrompt(message, conversationId)');
		expect(capture).toBeGreaterThan(-1);
		expect(run).toBeGreaterThan(capture);
		expect(build).toContain('buildTurnMessage({ id: generateNanoId(), text: compiled, images, references })');
	});

	it('sends the full message to the agent', () => {
		const think = source(THINK);
		expect(think).toContain('chat: (userMessage: string | UIMessage, callback: RpcTarget) => Promise<void>;');
		expect(between(think, 'private async runPrompt(', 'private async reportTurnError(')).toContain(
			'await stub.chat(message, forwarder);',
		);
	});

	it('shows each reference and any skipped links in the chat', () => {
		const capture = between(source(THINK), 'private async captureTurnReferences(', 'private async referenceCard(');
		expect(capture).toContain('WebSocketMessageResponses.REFERENCES_SKIPPED');
		expect(capture).toContain('WebSocketMessageResponses.REFERENCE_CAPTURED');
		expect(capture).toContain('this.buildProgress?.beginCapture(host, index, total, Date.now())');
		expect(capture).toContain('this.buildProgress?.endCapture(Date.now())');
	});
});
```

- [ ] **Step 2: Run the guards to verify they fail**

Run: `npx vitest run worker/agents/think/reference-transport-wiring.test.ts`
Expected: FAIL in the 4 new host guards. The earlier guards pass.

- [ ] **Step 3: Add the state field**

In `worker/agents/core/state.ts`:
- add `import type { PendingImage } from '../../types/image-attachment';` with the imports;
- in `ThinkState`, after `pendingUserInputs` or after `screenshotCommit`, add:

```ts
    /** Uploaded images waiting for the next turn; kept in state so a restart does not drop them. */
    pendingImages?: PendingImage[];
```

- [ ] **Step 4: Wire the host**

In `worker/agents/core/behaviors/think.ts`:

1. **Imports:**
   - Extend `import { ImageAttachment, ProcessedImageAttachment } from 'worker/types/image-attachment';` with `type PendingImage`.
   - Extend `import { ImageType, uploadImage } from 'worker/utils/images';` with `getPublicUrlForR2Image`.
   - Change the `websocketTypes` type import to `import type { BuildProgress, CloudflareDeploymentErrorCode, ReferenceCard } from '../../../api/websocketTypes';`.
   - Add:

```ts
import { ScreenshotSecurity } from 'worker/utils/screenshot-security';
import { getBrowserCaptureClient } from '../../../services/browser-capture/factory';
import { describeReferenceSummary, extractReferenceUrls, type ReferenceOutcome } from '../../think/references';
import { captureReferences } from '../../think/reference-service';
import { buildTurnMessage } from '../../think/turn-message';
```

2. **`ThinkAgentStub`:** change its `chat` line to:

```ts
	chat: (userMessage: string | UIMessage, callback: RpcTarget) => Promise<void>;
```

3. **`initialize`:** in its `setState({ … })`, after `thinkModelId,`, add:

```ts
			pendingImages: (initArgs.images ?? []).map(toPendingImage),
```

4. **`handleUserInput`:** replace `await this.queueUserRequest(userMessage, processedImages);` with:

```ts
		await this.queueUserRequest(userMessage);
		if (processedImages && processedImages.length > 0) {
			this.setState({
				...this.state,
				pendingImages: [...(this.state.pendingImages ?? []), ...processedImages.map(toPendingImage)],
			});
		}
```

5. **`build()`:** replace the block from `const pending = this.state.pendingUserInputs.slice();` through `completed = await this.runPrompt(compiled);` with:

```ts
				const pending = this.state.pendingUserInputs.slice();
				const images = this.state.pendingImages ?? [];
				this.setState({ ...this.state, pendingUserInputs: [], pendingImages: [] });

				const compiled = pending.join('\n');
				const conversationId = IdGenerator.generateConversationId();
				let completed: boolean;
				try {
					const references = await this.captureTurnReferences(compiled, conversationId);
					const message = buildTurnMessage({ id: generateNanoId(), text: compiled, images, references });
					completed = await this.runPrompt(message, conversationId);
```

   Leave the `catch` and everything after it unchanged.

6. **`runPrompt`:** change its signature and remove its own id. Replace:

```ts
	private async runPrompt(text: string): Promise<boolean> {
		const conversationId = IdGenerator.generateConversationId();
```

with:

```ts
	private async runPrompt(message: UIMessage, conversationId: string): Promise<boolean> {
```

   Then change `await stub.chat(text, forwarder);` to `await stub.chat(message, forwarder);`. Update its doc comment's first line to "Submit a turn's message to the ThinkAgent and translate its streamed".

7. **New methods:** add directly above `private async reportTurnError(`:

```ts
	/**
	 * Captures the reference URLs in a turn's text before the model runs, shows
	 * each one in the chat, and returns the outcomes for the turn message.
	 */
	private async captureTurnReferences(text: string, conversationId: string): Promise<ReferenceOutcome[]> {
		const { urls, skipped } = extractReferenceUrls(text);
		if (skipped.length > 0) {
			this.broadcast(WebSocketMessageResponses.REFERENCES_SKIPPED, { conversationId, urls: skipped });
		}
		if (urls.length === 0) return [];
		const outcomes = await captureReferences(
			urls,
			{
				client: getBrowserCaptureClient(this.env, this.logger),
				bucket: this.env.TEMPLATES_BUCKET,
				appId: this.getAgentId(),
				newCaptureId: () => generateNanoId(),
			},
			(host, index, total) => this.sendBuildProgress(this.buildProgress?.beginCapture(host, index, total, Date.now())),
		);
		this.sendBuildProgress(this.buildProgress?.endCapture(Date.now()));
		for (const outcome of outcomes) {
			this.broadcast(WebSocketMessageResponses.REFERENCE_CAPTURED, {
				conversationId,
				reference: await this.referenceCard(outcome),
			});
		}
		return outcomes;
	}

	private async referenceCard(outcome: ReferenceOutcome): Promise<ReferenceCard> {
		if (!outcome.ok) return { url: outcome.url, host: outcome.host, ok: false, reason: outcome.reason };
		const top = outcome.shots.find((shot) => shot.kind === 'desktop-top') ?? outcome.shots[0];
		let thumbnailUrl = '';
		if (top) {
			try {
				thumbnailUrl = await new ScreenshotSecurity(this.env).signUrl(
					getPublicUrlForR2Image(this.env, top.r2Key),
					this.getAgentId(),
				);
			} catch (e) {
				this.logger.warn('Could not sign a reference thumbnail', e);
			}
		}
		return { url: outcome.url, host: outcome.host, ok: true, summary: describeReferenceSummary(outcome.design), thumbnailUrl };
	}

	private sendBuildProgress(progress: BuildProgress | null | undefined): void {
		if (progress) this.broadcast(WebSocketMessageResponses.BUILD_PROGRESS, { progress });
	}

```

8. **Helper:** at the bottom of the file, next to `isFileWriteTool`, add:

```ts
function toPendingImage(image: ProcessedImageAttachment): PendingImage {
	return { r2Key: image.r2Key, mimeType: image.mimeType };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/reference-transport-wiring.test.ts worker/agents/think/build-progress-wiring.test.ts worker/agents/think/model-wiring.test.ts worker/services/browser-capture/screenshot-wiring.test.ts`
Expected: PASS. The existing build-progress and screenshot guards must still pass, because `build()`'s `finally` is unchanged.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/core/state.ts worker/agents/core/behaviors/think.ts worker/agents/think/reference-transport-wiring.test.ts
git commit -m "feat(think): send attached images and captured references with each turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Downscale attachments in the browser

**Files:**
- Create: `src/utils/image-resize.ts`
- Test: `src/utils/image-resize.test.ts`
- Modify: `src/hooks/use-image-upload.ts` (the `processImageFile` body after the size check)
- Test: `src/routes/reference-inputs-guard.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/utils/image-resize.ts`:
  - `MAX_IMAGE_EDGE = 1600`;
  - `fitWithin(width, height, maxEdge?)`;
  - `downscaleImageFile(file: File): Promise<ResizedImage>`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/image-resize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, fitWithin } from './image-resize';

describe('fitWithin', () => {
	it('keeps images that already fit', () => {
		expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
		expect(fitWithin(MAX_IMAGE_EDGE, 900)).toEqual({ width: MAX_IMAGE_EDGE, height: 900 });
	});

	it('scales the long edge down to the limit and keeps the aspect ratio', () => {
		expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
		expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
	});

	it('never collapses a side to zero', () => {
		expect(fitWithin(10_000, 3)).toEqual({ width: 1600, height: 1 });
	});
});
```

Create `src/routes/reference-inputs-guard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/image-resize.test.ts src/routes/reference-inputs-guard.test.ts`
Expected: FAIL. `./image-resize` cannot be resolved, and the guard fails.

- [ ] **Step 3: Write the resize utility**

Create `src/utils/image-resize.ts`:

```ts
/** Longest edge, in pixels, of images uploaded for the model. */
export const MAX_IMAGE_EDGE = 1600;

/** The largest size within `maxEdge` that keeps the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge || longest === 0) return { width, height };
	const scale = maxEdge / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface ResizedImage {
	/** Base64 without a data URL prefix. */
	base64Data: string;
	mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
	width: number;
	height: number;
	size: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), type, quality),
	);
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
		reader.onerror = () => reject(new Error('Could not read the image'));
		reader.readAsDataURL(blob);
	});
}

/**
 * Downscales an image to at most MAX_IMAGE_EDGE on its long edge, as WebP, or
 * JPEG where the browser cannot encode WebP. Images that already fit keep their file.
 */
export async function downscaleImageFile(file: File): Promise<ResizedImage> {
	const bitmap = await createImageBitmap(file);
	const target = fitWithin(bitmap.width, bitmap.height);
	if (target.width === bitmap.width && target.height === bitmap.height) {
		bitmap.close();
		return {
			base64Data: await blobToBase64(file),
			mimeType: file.type as ResizedImage['mimeType'],
			width: target.width,
			height: target.height,
			size: file.size,
		};
	}
	const canvas = document.createElement('canvas');
	canvas.width = target.width;
	canvas.height = target.height;
	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		throw new Error('Canvas is not available');
	}
	context.drawImage(bitmap, 0, 0, target.width, target.height);
	bitmap.close();
	let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
	if (blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
	return {
		base64Data: await blobToBase64(blob),
		mimeType: blob.type as ResizedImage['mimeType'],
		width: target.width,
		height: target.height,
		size: blob.size,
	};
}
```

- [ ] **Step 4: Use it in the upload hook**

In `src/hooks/use-image-upload.ts`, add `import { downscaleImageFile } from '@/utils/image-resize';`. Then, in `processImageFile`, replace everything after the size check, from `return new Promise((resolve, reject) => {` through its closing `});`, with:

```ts
		try {
			const resized = await downscaleImageFile(file);
			return {
				id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				filename: file.name,
				mimeType: resized.mimeType,
				base64Data: resized.base64Data,
				size: resized.size,
				dimensions: { width: resized.width, height: resized.height },
			};
		} catch {
			const errorMsg = `Could not read image: ${file.name}`;
			toast.error(errorMsg);
			onError?.(errorMsg);
			return null;
		}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/utils/image-resize.test.ts src/routes/reference-inputs-guard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/image-resize.ts src/utils/image-resize.test.ts src/hooks/use-image-upload.ts src/routes/reference-inputs-guard.test.ts
git commit -m "feat(chat): downscale attached images before upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Reference cards in the chat

**Files:**
- Modify: `src/routes/chat/utils/message-helpers.ts` (`MessagePart`; new `appendReferencePart` and `skippedReferenceCard`)
- Test: `src/routes/chat/utils/message-helpers.test.ts`
- Create: `src/components/ReferenceCard.tsx`
- Modify: `src/routes/chat/components/messages.tsx` (`RenderUnit`, `bucketParts`, `AssistantParts`)
- Modify: `src/routes/chat/utils/handle-websocket-message.ts` (two new cases)
- Test: `src/routes/reference-inputs-guard.test.ts`

**Interfaces:**
- Consumes: `ReferenceCard` from `@/api-types` (Task 7), and the `reference_captured` and `references_skipped` messages.
- Produces:
  - `MessagePart` variant `{ type: 'reference'; reference: ReferenceCard }`;
  - `appendReferencePart(messages, conversationId, reference): ChatMessage[]`;
  - `skippedReferenceCard(url): ReferenceCard`;
  - the `ReferenceCard` component.

- [ ] **Step 1: Write the failing tests**

In `src/routes/chat/utils/message-helpers.test.ts`, add `appendReferencePart` and `skippedReferenceCard` to the import list, and append:

```ts
describe('reference parts', () => {
	const CARD = { url: 'https://stripe.com', host: 'stripe.com', ok: true as const, summary: 'Desktop + mobile', thumbnailUrl: 'https://t' };

	it('starts an assistant message with the reference card', () => {
		const messages = appendReferencePart([], CONV, CARD);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('assistant');
		expect(messages[0].parts).toEqual([{ type: 'reference', reference: CARD }]);
		expect(messages[0].content).toBe('');
	});

	it('appends to the turn the card belongs to', () => {
		let messages: ChatMessage[] = appendTextDelta([], CONV, 'Working on it');
		messages = appendReferencePart(messages, CONV, CARD);
		expect(messages[0].parts?.map((part) => part.type)).toEqual(['text', 'reference']);
		expect(messages[0].content).toBe('Working on it');
	});

	it('explains links beyond the limit', () => {
		expect(skippedReferenceCard('https://www.example.com/x')).toEqual({
			url: 'https://www.example.com/x',
			host: 'example.com',
			ok: false,
			reason: 'only the first 3 links are captured; this one stays as text',
		});
	});
});
```

In `src/routes/reference-inputs-guard.test.ts`, append:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/chat/utils/message-helpers.test.ts src/routes/reference-inputs-guard.test.ts`
Expected: FAIL. `appendReferencePart` is not exported, and the new guards fail. The existing tests pass.

- [ ] **Step 3: Add the part and the helpers**

In `src/routes/chat/utils/message-helpers.ts`:
- add `ReferenceCard` to its `@/api-types` type import, or add `import type { ReferenceCard } from '@/api-types';`;
- extend `MessagePart` with:

```ts
    | { type: 'reference'; reference: ReferenceCard };
```

- append after `appendToolEvent`:

```ts

/** Add a reference card to a turn, in emission order. */
export function appendReferencePart(
    messages: ChatMessage[],
    conversationId: string,
    reference: ReferenceCard,
): ChatMessage[] {
    const part: MessagePart = { type: 'reference', reference };
    const idx = findAssistant(messages, conversationId);
    if (idx === -1) {
        return [...messages, createAssistantFromParts(conversationId, [part])];
    }
    return updateAssistant(messages, idx, (parts) => [...parts, part]);
}

/** The card for a link beyond the per-message capture limit. */
export function skippedReferenceCard(url: string): ReferenceCard {
    let host = url;
    try {
        host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
        // keep the raw text as the host
    }
    return { url, host, ok: false, reason: 'only the first 3 links are captured; this one stays as text' };
}
```

(Match this file's indentation: it uses 4 spaces in these helpers.)

- [ ] **Step 4: Write the card component**

Create `src/components/ReferenceCard.tsx`:

```tsx
import type { ReferenceCard as ReferenceCardData } from '@/api-types';

interface ReferenceCardProps {
	reference: ReferenceCardData;
}

/** A reference URL in the chat: what the model sees, or why it could not be captured. */
export function ReferenceCard({ reference }: ReferenceCardProps) {
	if (!reference.ok) {
		return (
			<div className="max-w-md rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-subtle">
				Couldn't capture <span className="font-medium text-kumo-strong">{reference.host}</span>: {reference.reason}
			</div>
		);
	}
	return (
		<a
			href={reference.url}
			target="_blank"
			rel="noopener noreferrer"
			className="flex max-w-md items-center gap-3 rounded-lg border border-kumo-line bg-kumo-elevated p-2 text-sm hover:border-kumo-brand"
		>
			{reference.thumbnailUrl && (
				<img
					src={reference.thumbnailUrl}
					alt={`Screenshot of ${reference.host}`}
					loading="lazy"
					className="h-16 w-28 shrink-0 rounded object-cover object-top"
				/>
			)}
			<div className="min-w-0">
				<p className="truncate font-medium text-kumo-strong">{reference.host}</p>
				<p className="truncate text-xs text-kumo-subtle">{reference.summary}</p>
			</div>
		</a>
	);
}
```

- [ ] **Step 5: Render reference parts**

In `src/routes/chat/components/messages.tsx`:
- import `ReferenceCard` from `@/components/ReferenceCard`, and the `ReferenceCard` type as `ReferenceCardData` from `@/api-types`;
- extend `RenderUnit`:

```ts
type RenderUnit =
	| { kind: 'text'; text: string; key: string }
	| { kind: 'trace'; items: TracePart[]; key: string }
	| { kind: 'reference'; reference: ReferenceCardData; key: string };
```

- in `bucketParts`, inside `parts.forEach((part, i) => {`, after the `isTracePart` branch's `return;`, add:

```ts
		if (part.type === 'reference') {
			flush();
			units.push({ kind: 'reference', reference: part.reference, key: `reference-${i}` });
			return;
		}
```

- in `AssistantParts`, replace the `units.map(…)` expression with:

```tsx
			{units.map((unit) => {
				if (unit.kind === 'text') return <Markdown key={unit.key} className="a-tag">{unit.text}</Markdown>;
				if (unit.kind === 'reference') return <ReferenceCard key={unit.key} reference={unit.reference} />;
				return <TraceGroup key={unit.key} items={unit.items} streaming={streaming} />;
			})}
```

- [ ] **Step 6: Handle the messages**

In `src/routes/chat/utils/handle-websocket-message.ts`, import `appendReferencePart` and `skippedReferenceCard` from `./message-helpers` in the existing import block, and add next to the `build_progress` case:

```ts
            case 'reference_captured': {
                setMessages((prev) => appendReferencePart(prev, message.conversationId, message.reference));
                break;
            }

            case 'references_skipped': {
                setMessages((prev) =>
                    message.urls.reduce(
                        (acc, url) => appendReferencePart(acc, message.conversationId, skippedReferenceCard(url)),
                        prev,
                    ),
                );
                break;
            }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/routes/chat/utils/message-helpers.test.ts src/routes/reference-inputs-guard.test.ts src/routes/build-progress-guard.test.ts src/routes/model-picker-guard.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck`
Expected: only the 4 baseline errors. Any other `MessagePart` switch in `src` that fails to compile because of the new variant must be fixed by treating `reference` like a non-text part there.

Run: `npx eslint src/components/ReferenceCard.tsx src/routes/chat/components/messages.tsx src/routes/chat/utils/message-helpers.ts src/routes/chat/utils/handle-websocket-message.ts src/utils/image-resize.ts src/hooks/use-image-upload.ts`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/routes/chat/utils/message-helpers.ts src/routes/chat/utils/message-helpers.test.ts src/components/ReferenceCard.tsx src/routes/chat/components/messages.tsx src/routes/chat/utils/handle-websocket-message.ts src/routes/reference-inputs-guard.test.ts
git commit -m "feat(chat): show captured references as cards in the conversation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verify the whole feature

**Files:**
- No code changes, unless a check fails. A failure that needs a fix is fixed in the file at fault, with its own commit.

- [ ] **Step 1: Run every test file the feature touches**

Run:

```bash
npx vitest run worker/agents/think/agent-assets.test.ts worker/agents/think/model-transport.test.ts worker/agents/think/reference-transport-wiring.test.ts worker/agents/think/thought-signatures.test.ts worker/services/browser-capture/reference-extract.test.ts worker/services/browser-capture/capture-core.test.ts worker/services/browser-capture/screenshot-wiring.test.ts worker/agents/think/references.test.ts worker/agents/think/reference-service.test.ts worker/agents/think/build-progress.test.ts worker/agents/think/build-progress-wiring.test.ts worker/agents/think/turn-message.test.ts worker/agents/think/persona.test.ts worker/agents/think/model-wiring.test.ts worker/agents/think/screenshot-policy.test.ts src/utils/image-resize.test.ts src/routes/chat/utils/build-status.test.ts src/routes/chat/utils/message-helpers.test.ts src/routes/reference-inputs-guard.test.ts src/routes/build-progress-guard.test.ts src/routes/model-picker-guard.test.ts
```

Expected: all pass.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck`
Expected: only the 4 baseline errors.

Run: `npx eslint worker/agents/think worker/services/browser-capture worker/agents/core/behaviors/think.ts worker/agents/core/conversation/MessageLoader.ts src/components/ReferenceCard.tsx src/utils/image-resize.ts`
Expected: 0 errors. Warnings that test files are ignored are fine.

- [ ] **Step 3: Check the extraction script against real pages through the dev sidecar**

The extraction script needs a real DOM, which the test pool lacks.
1. Start the sidecar in a separate terminal, as a background process you stop afterwards: `npm run dev:browser`.
2. Run:

```bash
for url in https://example.com https://www.cloudflare.com https://tailwindcss.com; do curl -s -X POST http://127.0.0.1:9223/capture-reference -H 'content-type: application/json' -d "{\"url\":\"$url\",\"timeoutMs\":20000,\"settleMs\":1500}" | python3 -c "import json,sys; r=json.load(sys.stdin); d=r['design']; print(r['finalUrl'], [s['kind'] for s in r['shots']], d['palette'][:4], d['fonts'], len(d['sections']), 'sections', len(d['copy']), 'chars')"; done
```

Expected for each site:
- four shot kinds, in order: `desktop-top`, `desktop-middle`, `desktop-lower`, `mobile-top`;
- a non-empty palette and a body font;
- at least one section on the Cloudflare and Tailwind pages.

`example.com` may report 0 sections; that's fine. Record the output in the task report.

If the sidecar cannot launch Chromium (`puppeteer` needs a browser download), report that as a concern with the error instead of changing code. Stop the sidecar afterwards.

- [ ] **Step 4: Record the live checks for after deploy**

No commit. List these in the report as the post-deploy checks from the spec:
1. a build from an attached design screenshot;
2. a build with two reference URLs;
3. a URL behind a login, to see the failure card;
4. a build saying "this is my site", to see copy reused;
5. a message with four links, to see the skipped-link card.
