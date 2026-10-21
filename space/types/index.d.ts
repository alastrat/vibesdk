/**
 * Public type surface for `@space-do/space`.
 *
 * The package ships an esbuild-produced JS bundle (`dist/index.js`). Running
 * `tsc --declaration` against the source currently fails (known errors
 * inherited from the upstream port), so this hand-maintained `.d.ts`
 * describes the subset of the API that consumers actually depend on.
 *
 * Keep in sync with `src/index.ts` exports.
 *
 * Globals referenced (`DurableObjectNamespace`, `DurableObjectState`,
 * `DurableObject`) come from `@cloudflare/workers-types`, which the consumer
 * is expected to include in its tsconfig `types`.
 */

interface DurableObjectConstructor {
	new (state: DurableObjectState, env: unknown): DurableObject;
}

// ── Durable Object classes (DurableObject<Env> subclasses) ──────────────────
// Treated as opaque DO classes; consumers access them via wrangler bindings.
export const SpaceDO: DurableObjectConstructor;

// ── Inspector result types (used by DB-viewer route handlers) ──────────────
export interface AppDatabaseColumn {
	name: string;
	type: string;
	notnull: number;
	pk: number;
}

export interface AppDatabaseTable {
	name: string;
	rowCount: number;
	columns: AppDatabaseColumn[];
}

export interface AppDatabaseReadResult {
	columns: string[];
	rows: Record<string, unknown>[];
	totalCount: number;
}

export interface BranchDeploymentBundle {
	branch: string;
	commitHash: string;
	mainModule: string;
	modules: Record<string, string | Record<string, unknown>>;
	assets: Record<string, string>;
	assetConfig?: {
		html_handling?: 'auto-trailing-slash' | 'drop-trailing-slash' | 'force-trailing-slash' | 'none';
		not_found_handling?: 'single-page-application' | '404-page' | 'none';
	};
	compatibilityDate: string;
}

// ── Draft types (mirror src/space/drafts-store.ts and src/space/draft-git.ts) ──
export type DraftStart = 'main' | 'live';

/** One draft as the seller sees it. */
export interface DraftSummary {
	id: string;
	name: string;
	startedFrom: DraftStart;
	updatedAt: number;
	/** Checked out: the chat edits it and the preview shows it. */
	active: boolean;
	/** Its latest version is what the live store serves. */
	live: boolean;
	/** The live store was last published from it. */
	publishedFromHere: boolean;
	/** It has changes the live store doesn't. */
	unpublishedChanges: boolean;
	/** The live store has changes it doesn't. */
	behindLive: boolean;
	/** The AI is bringing the live store's changes into it. */
	bringingInLiveChanges: boolean;
}

export interface DraftsSnapshot {
	drafts: DraftSummary[];
	activeDraftId: string;
	/** The store has been published at least once. */
	published: boolean;
	limit: number;
}

export interface ActiveDraft {
	id: string;
	name: string;
	branch: string;
}

export type ActivateDraftResult = { draft: ActiveDraft; previewStale: boolean } | { error: string };
export type CreateDraftResult = { id: string; name: string } | { error: string };
export type PublishDraftResult =
	| { commitHash: string; storeManifest: string | null; draftId: string; draftName: string }
	| { error: string };

export interface PublishDraftOptions {
	/** The account's plan lacks the catalog: refuse a version selling catalog products the live store doesn't. */
	refuseNewCatalogProducts?: boolean;
}

/** What the Go live panel needs: the draft being edited, and the draft the live store came from. */
export interface PublishContext {
	active: { id: string; name: string; tip: string | null };
	publishedDraft: { id: string; name: string } | null;
}

/**
 * What bringing in the live store's changes did, as SpaceDO reports it. A binary file changed on both sides merges
 * nothing: git can't combine two versions of one, so the seller has to pick.
 */
export type BringInOutcome =
	| { result: 'up-to-date' }
	| { result: 'fast-forward' | 'merged'; commit: string; deploy: unknown }
	| { result: 'conflicts'; files: string[]; deletedByDraft: string[]; deletedByLive: string[]; liveChanges: string[] }
	| { result: 'binary-changed-on-both-sides'; files: string[] }
	| { error: string };

/** A merge of the published commit into a draft that hasn't built yet. */
export interface MergeState {
	draftId: string;
	branch: string;
	/** The draft's tip before the merge: cancelling returns to it. */
	ours: string;
	/** The published commit being brought in. */
	theirs: string;
	/** Files with conflict markers. */
	files: string[];
	/** Files the draft deleted that the live store changed. */
	deletedByDraft: string[];
	/** Files the live store deleted that the draft changed. */
	deletedByLive: string[];
	/** The merge (or fast-forward) commit once there is one. */
	merged: string | null;
}

// ── Store manifest (mirrors src/space/store-manifest.ts) ────────────────────
/** The catalog variants a manifest sells; a manifest that doesn't parse sells none. */
export function catalogVariantIdsOf(manifest: string | null): Set<string>;

// ── Env shape (minimum). The host worker's Env satisfies this. ─────────────
export interface Env {
	SPACE_DO: DurableObjectNamespace;
	LOADER?: unknown;
	AI?: unknown;
	ANTHROPIC_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GOOGLE_API_KEY?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_GATEWAY_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	CF_AIG_TOKEN?: string;
	SERVER_PASSWORD?: string;
	SERVER_USERNAME?: string;
	ENVIRONMENT?: string;
}

// ── Stored message types (subset, mirrors src/types.ts) ────────────────────
export interface ToolCallInfo {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface StoredPart {
	id: string;
	sessionID: string;
	messageID: string;
	type: string;
	text?: string;
	time?: { start: number; end?: number };
	reason?: string;
	cost?: number;
	tokens?: {
		input: number;
		output: number;
		reasoning: number;
		cache: { read: number; write: number };
	};
	callID?: string;
	tool?: string;
	state?: {
		status: string;
		input: Record<string, unknown>;
		raw?: string;
		title?: string;
		output?: string;
		metadata?: Record<string, unknown>;
		time?: { start: number; end?: number };
		error?: string;
	};
	metadata?: Record<string, unknown>;
	snapshot?: string;
}

export interface StoredMessage {
	info: {
		id: string;
		sessionID: string;
		role: 'user' | 'assistant';
		time: { created: number; completed?: number };
		agent: string;
		model?: { providerID: string; modelID: string };
		parentID?: string;
		modelID?: string;
		providerID?: string;
		mode?: string;
		path?: { cwd: string; root: string };
		cost?: number;
		tokens?: {
			total?: number;
			input: number;
			output: number;
			reasoning: number;
			cache: { read: number; write: number };
		};
		finish?: string;
		summary?: { diffs: unknown[] };
		error?: unknown;
	};
	parts: StoredPart[];
}

export type SessionEvent =
	| { type: 'server.connected'; properties: Record<string, unknown> }
	| { type: 'server.heartbeat'; properties: Record<string, unknown> }
	| { type: 'session.created'; properties: { sessionID: string; info: unknown } }
	| { type: 'session.updated'; properties: { sessionID: string; info: unknown } }
	| {
			type: 'message.created';
			properties: { sessionID: string; info: StoredMessage['info'] };
	  }
	| {
			type: 'message.updated';
			properties: { sessionID: string; info: StoredMessage['info'] };
	  }
	| {
			type: 'message.part.updated';
			properties: { sessionID: string; part: StoredPart };
	  }
	| {
			type: 'message.part.delta';
			properties: {
				sessionID: string;
				messageID: string;
				partID: string;
				/** Which field of the part is being extended (e.g. 'text'). */
				field: string;
				/** Incremental chunk to append to `field`. */
				delta: string;
			};
	  }
	| {
			type: 'message.completed';
			properties: { sessionID: string; messageID?: string };
	  }
	| {
			type: 'step.start';
			properties: { sessionID: string; messageID: string };
	  }
	| {
			type: 'tool.called';
			properties: { sessionID: string; messageID: string; tool: ToolCallInfo };
	  }
	| {
			type: 'tool.result';
			properties: { sessionID: string; messageID: string; result: unknown };
	  }
	| { type: 'error'; properties: { sessionID?: string; error: string } }
	| { type: 'done'; properties: { sessionID: string } }
	| { type: string; properties?: Record<string, unknown> };

// ── Convenience info types (subset, opaque) ────────────────────────────────
export interface SessionInfo {
	id: string;
	title: string;
	[key: string]: unknown;
}
