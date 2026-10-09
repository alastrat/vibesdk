# Reference inputs: attached images and reference URLs

Status: approved in chat, 2026-10-09.

## Goal

Let users steer a Think build with references and have the build follow them closely:
- images they attach (a screenshot of a design, a mockup, an asset);
- URLs of sites whose look and structure they want.

Today neither reaches the model. Attached images are uploaded and then ignored: the Think host sends the model text only. URLs can't be read, because the agent has no tool that returns a page's content or appearance.

## Decisions

| Question | Decision |
|---|---|
| How URLs are given | Any `http(s)` URL in a message is detected, on the home prompt and mid-chat. No new input field. |
| URLs per message | The first 3 are captured; the rest stay as plain text, with a notice |
| Capture per URL | Three desktop screenshots (top, about 40%, about 80% of the page) at 1280×800, one phone screenshot (top) at 390×844, and design data extracted from the rendered page |
| What the build takes from a reference | Layout, section order, palette, typography and component style, closely. Copy and images only when the user says the site is theirs; the model asks with `ask_questions` when that's unclear. |
| Capture engine | The Worker's `BROWSER` binding (Browser Rendering), through the existing browser capture client. No third-party scraper. |
| Where images live | R2. Stored messages reference them by URL; the model transport inlines them as `data:` images on every request. |
| Attachments | The existing image button (2 per message), downscaled in the browser to at most 1600 px on the long edge |

## What the user sees

- **Attaching images.** The image button on the home prompt and in the chat input works as today. The browser downscales each image to at most 1600 px on its long edge and encodes it as WebP, falling back to JPEG, before uploading. The model now sees the images.
- **Pasting URLs.**
  - Before the model starts, the progress bar shows `Capturing <host> · <n> of <total>`.
  - Each URL then appears in the chat as a reference card: the hostname, the top desktop screenshot, and a summary such as `Desktop + mobile · 6 colors · Inter / Playfair Display · 7 sections`.
  - A failed capture shows `Couldn't capture <host>: <reason>`, and the build continues with the URL as text.
  - When a message has more than 3 URLs, a notice says the extra links stay as text.
- **Cost.** Each URL adds four screenshots to the conversation, resent on every build step: roughly $0.10–0.15 per URL on a Sonnet build. An attached image adds about 1–2k input tokens per step.
- **Reload.** A reloaded chat shows the user's message text only. Reference cards are live-only; restoring them is out of scope.

## Architecture

### Finding and validating URLs

`worker/agents/think/references.ts` (pure):

```ts
export interface ExtractedReferenceUrls { urls: string[]; skipped: string[] }
export function extractReferenceUrls(text: string, max?: number): ExtractedReferenceUrls; // max defaults to 3
export type UrlRejection = 'not-http' | 'private-address' | 'estori-host' | 'invalid';
export function validateReferenceUrl(url: string): { ok: true; url: URL } | { ok: false; reason: UrlRejection };
```

- **Extraction** finds `http(s)` URLs, including inside markdown links. It strips trailing punctuation and closing brackets, removes duplicates, keeps the first `max` in order, and returns the rest as `skipped`.
- **Validation** rejects:
  - any scheme other than `http` and `https`;
  - `localhost` and `*.localhost`;
  - IP literals in private, loopback, link-local, CGNAT or cloud-metadata ranges (including `169.254.169.254`), IPv4 and IPv6;
  - `estori.app` and its subdomains.

  No DNS lookups: Browser Rendering runs on Cloudflare's network, not Estori's.

### Capturing a page

In `worker/services/browser-capture/`:

```ts
// types.ts
export interface ReferencePayload { url: string; timeoutMs: number; settleMs: number }
export interface ReferenceShot { kind: 'desktop-top' | 'desktop-middle' | 'desktop-lower' | 'mobile-top'; jpegBase64: string; width: number; height: number }
export interface ReferenceDesign {
  title: string;
  palette: string[];                                   // hex, most used first, up to 8
  fonts: { body: string; headings: string; buttons: string };
  headings: { tag: string; size: string; weight: string }[];
  button: { background: string; color: string; radius: string } | null;
  nav: string[];                                       // up to 12 labels
  sections: { heading: string; columns: number; hasImage: boolean }[];
  copy: string;                                        // visible text, up to about 6,000 characters
  images: string[];                                    // absolute URLs, up to 12
}
export interface ReferenceCaptureResult { finalUrl: string; shots: ReferenceShot[]; design: ReferenceDesign }
// BrowserCaptureClient gains:
captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult>; // throws on failure
```

- **Shared core:** `capture-core.ts` gains `runReferenceCapture(page, payload)`, used by the binding client in production and by the dev sidecar locally. It runs these steps:
  1. Viewport 1280×800, then `goto` with `waitUntil: 'networkidle2'` and `timeoutMs` (20 s), then `settleMs` (1.5 s).
  2. Desktop screenshots: JPEG at quality 70, viewport only. The first at the top, the next two after scrolling to about 40% and 80% of `document.documentElement.scrollHeight`, each scroll followed by a short settle.
  3. One `page.evaluate` with the extraction script, exported as a string from `reference-extract.ts`. It reads the computed styles of visible elements, so external stylesheets and utility-class sites work.
  4. Viewport 390×844, mobile and touch, then a reload, a settle, and one JPEG of the top.
  5. The page is closed in a `finally` block.
- **`CapturePage`** gains the methods the core needs: `screenshot` with `type: 'jpeg'`, `quality` and `encoding: 'base64'`; `reload`; and a `setViewport` that takes `isMobile` and `hasTouch`.
- **Dev sidecar:** it gains `POST /capture-reference`, and `SidecarCaptureClient.captureReference` calls it.
- **No evasion:** the capture does not try to get past bot protection or logins. A blocked or failed page is a failure.

### Orchestration and storage

`worker/agents/think/reference-service.ts`. Its dependencies are injected for tests: the capture client, an R2-like bucket, and a clock and id source.

```ts
export interface CapturedReference {
  url: string; host: string; ok: true;
  captureId: string;
  shots: { kind: ReferenceShot['kind']; r2Key: string }[];
  design: ReferenceDesign;
}
export interface FailedReference { url: string; host: string; ok: false; reason: string }
export type ReferenceOutcome = CapturedReference | FailedReference;
export interface ReferenceDeps {
  client: Pick<BrowserCaptureClient, 'captureReference'>;
  bucket: { put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown> };
  appId: string;
  newCaptureId: () => string;
}
export function captureReferences(urls: string[], deps: ReferenceDeps, onStart: (host: string, index: number, total: number) => void): Promise<ReferenceOutcome[]>;
```

- **Validation:** each URL is validated first. Rejected URLs become `FailedReference`: `not a public web page`.
- **Capture:** valid URLs are captured in parallel, each within a 45 s budget.
- **Storage:** each screenshot is written to R2 at `screenshots/<appId>/ref-<captureId>-<kind>.jpg`. That's the folder the existing screenshot endpoint serves to holders of a signed link for the app, so reference cards reuse `ScreenshotSecurity` signing. A failed write turns the whole URL into a failure.
- **Failure reasons:**
  - timeout;
  - a navigation error, an HTTP status of 400 or more, or a non-HTML page;
  - Browser Rendering busy (a 429 or a concurrency error): `Browser capture busy, try again`.

### Images in the conversation

`worker/agents/think/agent-assets.ts`:

```ts
export const AGENT_ASSET_HOST = 'assets.estori.internal';
export function agentAssetUrl(r2Key: string): string; // https://assets.estori.internal/<r2Key>
export interface AssetBucket {
  get(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string }; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
export interface AssetCache { get(key: string): string | undefined; set(key: string, dataUrl: string): void } // bounded by total bytes
export function inlineAgentAssets(body: string, bucket: AssetBucket, cache: AssetCache): Promise<string>;
```

- **Stored form:** image parts in stored messages are `file` parts whose URL is `agentAssetUrl(r2Key)`. ThinkAgent's model is the AI SDK OpenAI chat model, whose `supportedUrls` include `https` images. So such a URL goes into the request body as `image_url.url` without being downloaded.
- **Inlining:** `inlineAgentAssets` parses the chat-completions body and replaces each `image_url.url` on `AGENT_ASSET_HOST` with `data:<type>;base64,…` read from R2.
  - A missing object becomes the text part `[image unavailable]`.
  - An object over 5 MB becomes `[image too large]`.
  - Bodies with no such URLs are returned unchanged.
  - `AssetCache` is an in-memory map on the ThinkAgent instance, capped at 20 MB, so later steps don't reread R2.
- **Transport:** `createModelTransport`'s `prepareBody` becomes `(body: string) => Promise<string>`. ThinkAgent's hook runs `inlineAgentAssets` first, then `injectThoughtSignatures`.

### Think host

In `worker/agents/core/behaviors/think.ts` and `ThinkState`:

- **State:** `ThinkState` gains `pendingImages?: { r2Key: string; mimeType: SupportedImageMimeType }[]`.
  - `handleUserInput` appends the uploaded attachments.
  - `initialize` queues the first prompt's uploaded images, which it ignores today.
- **`build()`:** it takes `pendingImages` together with `pendingUserInputs` and clears both. Before each turn:
  1. It runs `extractReferenceUrls` on the compiled text. Skipped URLs produce one notice in the chat.
  2. It runs `captureReferences`, with `onStart` setting the progress activity.
  3. For each outcome it broadcasts `reference_captured`.
- **`runPrompt(message: UIMessage)`** calls `stub.chat(message, forwarder)`. The message's parts, in order:
  1. the user's text;
  2. one reference digest text part per outcome;
  3. for each attachment, a label text part (`Attachment <n>`) and a `file` part;
  4. for each captured reference, a label (`Reference <host>: desktop, top`, and so on) and a `file` part per screenshot.

  Digest and label parts carry `providerMetadata: { estori: { hidden: true } }`.
- **Digest format:** `formatReferenceDigest(outcome)` in `references.ts`. For a captured page:
  - the URL and title;
  - the palette;
  - fonts, headings and button style;
  - nav labels and the numbered sections;
  - `Copy (for structure; reuse only if the user says the site is theirs)`;
  - `Image URLs (only if the user says the site is theirs)`;
  - the list of screenshots that follow.

  For a failure: `Reference <url> could not be captured (<reason>); work from the user's description.`
- **Reload:** `MessageLoader` skips text parts marked `estori.hidden`, so a reloaded chat shows only the user's text.

### Messages and progress

- **`worker/api/websocketTypes.ts`:**
  - `BuildActivity` gains `{ kind: 'capturing'; host: string; index: number; total: number }`.
  - A new `ReferenceCapturedMessage { type: 'reference_captured'; reference: ReferenceCard }`, where `ReferenceCard` is `{ url; host; ok: true; summary; thumbnailUrl } | { url; host; ok: false; reason }`. `thumbnailUrl` is a signed link to the `desktop-top` screenshot.
  - `ReferencesSkippedMessage { type: 'references_skipped'; urls: string[] }`.
- **Summary:** `describeReferenceSummary(design)` in `references.ts`: `Desktop + mobile · <n> colors · <body font> / <heading font> · <n> sections`.
- **Progress bar:** `describeBuildActivity` renders `capturing` as `Capturing <host> · <index> of <total>`.

### Frontend

- **`src/hooks/use-image-upload.ts`:** downscales with a canvas before reading the file. The size calculation is a pure helper, `fitWithin(width, height, 1600)`, in `src/utils/image-resize.ts`.
- **`src/components/ReferenceCard.tsx`:** renders a `ReferenceCard`. The handler appends it to the chat on `reference_captured`, and shows a one-line notice on `references_skipped`.

### Prompting

A new `worker/agents/think/prompts/references.txt` is appended once by `buildSystemPrompt`, after the base prompt, for every model family. It says:
- **Design source of truth:** treat references as the design source.
- **Match:** keep the section count and order, the exact hex colors, and the same font (or the closest Google Font if it isn't available). Also the spacing, corner radius and button style. Use the mobile screenshot for responsive layout.
- **Copy and images:** write fresh copy and use placeholders unless the user says the site is theirs. In that case, reuse its copy and image URLs. When ownership is unclear, ask with `ask_questions`.
- **Attachments:** follow the user's words. Attached images are usually a design to match or assets to use.

## Error handling

| Case | Behavior |
|---|---|
| URL not `http(s)`, private, internal, or an Estori host | Not captured; card: `Can't capture <host>: not a public web page`; text kept |
| More than 3 URLs | First 3 captured; `references_skipped` notice |
| Timeout, navigation error, HTTP 400 or above, non-HTML, bot challenge | Failure card with the reason; digest notes the failure |
| Browser Rendering busy | Failure card: `Browser capture busy, try again` |
| R2 write fails during capture | That URL fails |
| Asset missing from R2 at request time | `[image unavailable]` text part |
| Asset over 5 MB | `[image too large]` text part |
| Provider rejects an image | Existing turn-error path (error or failure card) |
| Agent restarts with queued images | `pendingImages` is in state, so they run with the next turn |

## Testing

- **Unit tests (pure):**
  - `extractReferenceUrls`: trailing punctuation, markdown links, duplicates, the cap, skipped order;
  - `validateReferenceUrl`: each rejected range in IPv4 and IPv6, `localhost`, `169.254.169.254`, Estori hosts, other schemes;
  - `formatReferenceDigest` and `describeReferenceSummary`, from fixtures;
  - `fitWithin`;
  - `agentAssetUrl`.
- **Capture core:** `runReferenceCapture` with a fake page, checking:
  - the viewports and scroll positions;
  - JPEG quality 70 and viewport-only screenshots;
  - that the mobile viewport and reload happen;
  - that the page is closed on failure.
- **Orchestration:** `captureReferences` with a fake client and bucket, checking:
  - rejected URLs fail without capture;
  - captures run in parallel;
  - R2 keys follow `screenshots/<appId>/ref-…`;
  - a write failure fails the URL;
  - `onStart` is called in order.
- **Pass-through:** the real AI SDK OpenAI chat model, with a fake fetch recording the body. A message with a `file` part on `assets.estori.internal` produces `image_url.url` with that URL, and nothing is downloaded.
- **Inlining:** `inlineAgentAssets` with a fake bucket, checking:
  - internal URLs become `data:` images;
  - missing and oversized objects become text;
  - the cache prevents rereads;
  - other bodies are unchanged;
  - the ThinkAgent hook order keeps Gemini thought signatures.
- **Wiring guards:**
  - `runPrompt` sends a `UIMessage`;
  - `build()` drains `pendingImages` and captures before the turn;
  - `initialize` queues the first prompt's images;
  - `MessageLoader` skips hidden parts;
  - `buildSystemPrompt` appends `references.txt`;
  - the handler covers `reference_captured` and `references_skipped`.
- **Extraction script:** it needs a real DOM, which the test pool lacks. The plan checks it through the dev sidecar (`npm run dev:browser`, then `POST /capture-reference`) against a few public sites.
- **Live, after deploy:**
  1. a build from an attached design screenshot;
  2. a build with two reference URLs;
  3. a URL behind a login, to see the failure card;
  4. a build saying "this is my site", to see copy reused.

## Out of scope

- The agent comparing its preview against the reference during the build.
- Caching captures between messages.
- Crawling more than one page per URL.
- Prompt caching for the added image tokens.
- Removing cookie banners from screenshots.
- Restoring reference cards when a chat is reloaded.
