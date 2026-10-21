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
		'/src/hooks/use-drafts.ts',
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

	it("keeps the draft's name readable in the preview header: the trigger shows one badge, and the preview title is what shrinks", () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		const trigger = switcher.slice(switcher.indexOf('<PopoverTrigger'), switcher.indexOf('</PopoverTrigger>'));
		expect(trigger).toContain('<Badges draft={active} limit={1} />');
		expect(trigger).toMatch(/<button[^>]*className="[^"]*\bshrink-0\b/);
		expect(trigger).toContain('min-w-[3.5rem] max-w-[10rem] truncate');
		expect(trigger).toMatch(/<CaretDown className="[^"]*\bshrink-0\b/);
		expect(switcher).toContain('.slice(0, limit)');
		expect(switcher).toMatch(/className="shrink-0"/);
		const panel = source('/src/routes/chat/components/main-content-panel.tsx');
		const header = panel.slice(panel.indexOf('{draftSwitcher}'));
		expect(header.slice(0, header.indexOf('{previewTitle}'))).toMatch(/className="min-w-0 truncate /);
	});

	it('hides starting drafts while drafts are paused, and the switcher when Main is the only draft', () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		expect(switcher).toContain("const draftsPaused = useFlag('store-drafts-paused');");
		expect(switcher).toContain('if (draftsPaused && snapshot.drafts.length === 1) return null;');
		expect(switcher).toMatch(/\{!draftsPaused && \(\s*<>\s*<Button[^>]*onClick=\{\(\) => startNaming\(\)\}/);
	});

	it('keeps the drafts menu inside the pane, whatever the width of the header', () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		const tag = switcher.match(/<PopoverContent[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('align="start"');
		expect(tag).toContain('collisionPadding={8}');
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

	it("refreshes the Go live view when the preview reloads, since the AI's switches and deploys change what Publish sends", () => {
		const hooks = source('/src/hooks/use-drafts.ts');
		const effect = hooks.slice(hooks.indexOf('useEffect(() => {'), hooks.indexOf('}, [enabled'));
		expect(effect).toContain('void refetch();');
		expect(effect).toContain('void queryClient.invalidateQueries({ queryKey: queryKeys.liveStore(appId) });');
		expect(hooks).toMatch(/\}, \[enabled, appId, refreshKey, refetch, queryClient\]\);/);
	});

	it('never says git words or names an AI assistant or supplier', () => {
		for (const path of ['/src/components/drafts/DraftSwitcher.tsx', '/src/components/drafts/DraftNameDialog.tsx', '/src/components/drafts/LiveFixBanner.tsx', '/src/components/drafts/draft-view.ts']) {
			const copy = copyOf(source(path)).toLowerCase();
			for (const word of ['>git', ' git ', 'branch', 'merge', 'commit']) expect(copy, `${path}: ${word}`).not.toContain(word);
			for (const name of [...AI_ASSISTANT_NAMES, ...SUPPLIER_NAMES]) expect(copy, `${path}: ${name}`).not.toContain(name);
		}
	});
});
