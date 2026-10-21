import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/components/layout/app-sidebar.tsx', '/src/routes/translations/*.{ts,tsx}', '/src/hooks/use-store-translations.ts', '!/**/*.test.{ts,tsx}'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGE_FILES = ['/src/routes/translations/translations.tsx', '/src/routes/translations/language-card.tsx', '/src/routes/translations/task-activity.tsx', '/src/routes/translations/translations-format.ts', '/src/hooks/use-store-translations.ts'];

describe('the Translations page', () => {
	it('is routed for signed-in users', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'translations',\s*Component: protectedPage\(TranslationsPage\)/);
	});

	it('opens from a Translations item after Emails in the sidebar, folded and open, hidden while translations are paused', () => {
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		const order = [...sidebar.matchAll(/id="([a-z]+)-link"/g)].map((match) => match[1]);
		expect(order).toEqual(['discover', 'catalog', 'orders', 'emails', 'translations', 'discover', 'catalog', 'orders', 'emails', 'translations']);
		expect(sidebar.match(/navigate\(STORE_TRANSLATIONS_PATH\)/g) ?? []).toHaveLength(2);
		expect(sidebar).toContain("const translationsPaused = useFlag('store-translations-paused');");
		expect(sidebar.match(/\{user && !translationsPaused && \(/g) ?? []).toHaveLength(2);
		expect(sidebar.match(/<TranslateIcon /g) ?? []).toHaveLength(2);
		expect(sidebar.match(/t\('Translations'\)/g)?.length).toBeGreaterThanOrEqual(2);
	});

	it('has its title, store picker, settings, a card per language and the activity', () => {
		const page = source('/src/routes/translations/translations.tsx');
		for (const part of ["pageTitle(t('Translations'))", 'stores.data', '<Select', 'data.languages.map', '<LanguageCard', '<TaskActivity', "t('Publish or preview your store first')", "t('No text to translate')", 'STORE_TRANSLATIONS_PAUSED_MESSAGE']) {
			expect(page, part).toContain(part);
		}
	});

	it('remembers the chosen store in this browser, and survives storage that is blocked', () => {
		const page = source('/src/routes/translations/translations.tsx');
		expect(page).toContain('localStorage.getItem(');
		expect(page).toContain('localStorage.setItem(');
		expect(page.match(/try \{/g)?.length).toBeGreaterThanOrEqual(2);
	});

	it('polls the light task list every 3 seconds while a task moves, never the store overview', () => {
		const hooks = source('/src/hooks/use-store-translations.ts');
		expect(hooks).toContain('TASK_POLL_MS = 3_000');
		expect(hooks.match(/refetchInterval:/g)).toHaveLength(1);
		expect(hooks).toContain('refetchInterval: (query) => (query.state.data?.some(taskIsMoving) ? TASK_POLL_MS : false)');
		expect(hooks).toContain('apiClient.getTasks(appId)');
	});

	it('shows the estimate before translating, and what credits are left', () => {
		const card = source('/src/routes/translations/language-card.tsx');
		expect(card).toContain('estimateText(language.estimateCredits, locale)');
		expect(card).toContain('creditsLeftText(creditsLeft, locale)');
		const format = source('/src/routes/translations/translations-format.ts');
		expect(format).toContain("'About {credits} credits'");
		expect(format).toContain('formatCredits(credits, locale)');
	});

	it('shows task errors in the language of the seller', () => {
		expect(source('/src/routes/translations/task-activity.tsx')).toContain('t(task.lastError)');
	});

	it('names no supplier or AI provider, and no machine', () => {
		for (const path of PAGE_FILES) {
			const text = source(path).toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(text, `${path}: ${name}`).not.toContain(name);
			expect(text, `${path}: machine`).not.toMatch(/['"`>][^'"`<]*\bmachine\b/);
		}
	});
});
