import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '@/routes/copy-rules';

const sources = import.meta.glob<string>(
	[
		'/src/components/drafts/DraftSwitcher.tsx',
		'/src/components/drafts/DraftNameDialog.tsx',
		'/src/components/drafts/LiveFixBanner.tsx',
		'/src/components/drafts/draft-view.ts',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/main-content-panel.tsx',
		'/src/components/live-store/GoLiveDialog.tsx',
		'/src/hooks/use-live-store.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

/** The seller-facing strings in a component: JSX text and string literals, without imports. */
function copyOf(text: string): string {
	return text.replace(/^import .*$/gm, '');
}

describe('the drafts UI', () => {
	it('puts the switcher in the preview header and the banner above the preview, for the owner of a Think store', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('<DraftSwitcher');
		expect(chat).toContain('<LiveFixBanner');
		expect(chat).toMatch(/isOwner && behaviorType === 'think'/);
		const panel = source('/src/routes/chat/components/main-content-panel.tsx');
		expect(panel).toContain('{draftSwitcher}');
		expect(panel).toContain('{previewNotice}');
	});

	it('switches, starts, renames and deletes drafts, asking before a delete', () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		for (const part of ['useActivateDraft(', 'useDeleteDraft(', 'draftBadges(', 'canDeleteDraft(', 'ConfirmButton', 'New draft', 'Rename', 'Bring in live changes', 'bringInRequest(']) {
			expect(switcher, part).toContain(part);
		}
		const dialog = source('/src/components/drafts/DraftNameDialog.tsx');
		for (const part of ['useCreateDraft(', 'useRenameDraft(', 'Start from', 'The live store (quick fix)', 'DRAFT_NAME_MAX_LENGTH']) {
			expect(dialog, part).toContain(part);
		}
	});

	it('names the draft Publish sends, and warns that Main falls behind', () => {
		const goLive = source('/src/components/live-store/GoLiveDialog.tsx');
		expect(goLive).toContain('view.draft');
		expect(goLive).toContain('Main will be behind the live store until you bring these changes in.');
	});

	it("refreshes the drafts after anything that changes the live store, since Publish and going offline don't reload the preview", () => {
		const hooks = source('/src/hooks/use-live-store.ts');
		expect(hooks).toContain('queryClient.invalidateQueries({ queryKey: queryKeys.drafts(appId) })');
	});

	it('never says git words or names an AI assistant or supplier', () => {
		for (const path of ['/src/components/drafts/DraftSwitcher.tsx', '/src/components/drafts/DraftNameDialog.tsx', '/src/components/drafts/LiveFixBanner.tsx', '/src/components/drafts/draft-view.ts']) {
			const copy = copyOf(source(path)).toLowerCase();
			for (const word of ['>git', ' git ', 'branch', 'merge', 'commit']) expect(copy, `${path}: ${word}`).not.toContain(word);
			for (const name of [...AI_ASSISTANT_NAMES, ...SUPPLIER_NAMES]) expect(copy, `${path}: ${name}`).not.toContain(name);
		}
	});
});
