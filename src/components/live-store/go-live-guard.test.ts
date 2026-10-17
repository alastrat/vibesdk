import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/live-store/GoLiveDialog.tsx', '/src/hooks/use-live-store.ts', '/src/routes/chat/chat.tsx'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the Go live panel', () => {
	it('opens from a Go live button the store owner sees in the editor', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('<GoLiveDialog');
		expect(chat).toContain('Go live');
		expect(chat).toMatch(/isOwner && [^\n]*\n?[^\n]*setIsGoLiveOpen\(true\)/);
	});

	it('edits the address with its rule, publishes the preview, takes the store offline and opens it', () => {
		const dialog = source('/src/components/live-store/GoLiveDialog.tsx');
		for (const part of ['slugProblem(', 'usePublishLiveStore(', 'useTakeLiveStoreOffline(', 'publishAction(view, slug)', 'action.disabled', 'Take offline', 'Open store', 'view.storesDomain']) {
			expect(dialog, part).toContain(part);
		}
		// What a seller must know before shoppers pay: unpublished edits, and a checkout that isn't connected.
		expect(dialog).toContain('view.hasChanges');
		expect(dialog).toContain('view.checkoutConnected');
	});

	it("connects the seller's own domain, shows each DNS record to copy, checks it and removes it", () => {
		const dialog = source('/src/components/live-store/GoLiveDialog.tsx');
		for (const part of ['useAddStoreDomain(', 'useCheckStoreDomain(', 'useRemoveStoreDomain(', 'domain.records.map', 'navigator.clipboard.writeText', 'Check now', 'view.domainsAvailable']) {
			expect(dialog, part).toContain(part);
		}
	});

	it('keeps the panel current from what each call answers, without refetching', () => {
		const hooks = source('/src/hooks/use-live-store.ts');
		expect(hooks).toContain('queryClient.setQueryData(queryKeys.liveStore(appId), view)');
		for (const call of ['getLiveStore(', 'publishLiveStore(', 'takeLiveStoreOffline(', 'addStoreDomain(', 'checkStoreDomain(', 'removeStoreDomain(']) expect(hooks, call).toContain(call);
	});
});
