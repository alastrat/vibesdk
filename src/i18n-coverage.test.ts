import { describe, expect, it } from 'vitest';
import { findUntranslatedText } from '../shared/i18n/extract';

/**
 * The folders and files whose English text is all translated: no JSX text, text attribute, toast message or other
 * English string (a capital, then a space or a closing mark) outside `t()`, `tn()`, `msg()` or `<T>`. Each task that
 * translates part of the app adds what it translated, and this test then holds it to that. Entries are paths from the
 * repo root:
 *  - a folder ends with `/` and covers every .ts and .tsx file below it: `'src/components/layout/'`;
 *  - a file is its path: `'src/routes/home.tsx'`;
 *  - a glob may use `*`, `**`, `?` and `{a,b}`: `'src/hooks/use-billing*.ts'`;
 *  - a leading `!` leaves out what the entry matches, wherever it stands in the list: `'!src/routes/chat/debug-panel.tsx'`.
 * Text that is never translated, such as a brand name or a string of code, is marked with an `i18n-ignore` comment (see
 * `extract.ts`).
 */
const COVERED: string[] = [
	'src/lib/i18n/',
	'src/components/settings/',
	'src/components/auth/',
	'src/routes/auth/',
	'src/hooks/use-oauth-error-toast.ts',
	'src/lib/auth-validation.ts',
	'src/lib/oauth-start.ts',
	'src/contexts/auth-context.tsx',
	'src/components/layout/app-layout.tsx',
	'src/components/layout/app-sidebar.tsx',
	'src/components/layout/global-header.tsx',
	'src/components/layout/EstoriTopBar.tsx',
	'src/components/layout/header-context.tsx',
	'src/routes/app/',
	'src/routes/home.tsx',
	'src/components/ErrorBoundary.tsx',
	'src/components/credits-banner.tsx',
	'src/components/billing/BillingBanner.tsx',
	'src/components/usage-limits-badge.tsx',
	'src/utils/usage-limit-checker.tsx',
	'src/components/ModelUnavailableNotice.tsx',
	'src/utils/credit-change.ts',
	'src/lib/legal-link-label.ts',
	'src/lib/visibility-label.ts',
	'src/components/ui/dialog.tsx',
	'src/components/ui/model-selector.tsx',
	'src/routes/translations/',
	'src/hooks/use-store-translations.ts',
];

/** Every source file that can be covered, loaded only when it is. Tests and declaration files are never covered. */
const loaders = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '/shared/**/*.{ts,tsx}', '/worker/**/*.{ts,tsx}', '!/**/*.{test,spec,d}.{ts,tsx}'], {
	query: '?raw',
	import: 'default',
});

/** A glob as a regular expression: `**` crosses folders, `*` and `?` stay in one, and `{a,b}` chooses. */
function globToRegExp(glob: string): RegExp {
	let pattern = '';
	let open = 0;
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*' && glob[index + 1] === '*') {
			const folders = glob[index + 2] === '/';
			index += folders ? 2 : 1;
			pattern += folders ? '(?:.*/)?' : '.*';
		} else if (char === '*') {
			pattern += '[^/]*';
		} else if (char === '?') {
			pattern += '[^/]';
		} else if (char === '{') {
			open++;
			pattern += '(?:';
		} else if (char === '}' && open > 0) {
			open--;
			pattern += ')';
		} else if (char === ',' && open > 0) {
			pattern += '|';
		} else {
			pattern += char.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
		}
	}
	return new RegExp(`^${pattern}$`);
}

/** The paths the entries cover, and the entries that match no path at all, which a typo would leave covering nothing. */
function coveredPaths(entries: readonly string[], paths: readonly string[]): { files: string[]; unmatched: string[] } {
	const rules = entries.map((entry) => {
		const exclude = entry.startsWith('!');
		const glob = entry.slice(exclude ? 1 : 0).replace(/^\//, '');
		return { entry, exclude, pattern: globToRegExp(glob.endsWith('/') ? `${glob}**` : glob) };
	});
	return {
		files: paths.filter((path) => rules.some((rule) => !rule.exclude && rule.pattern.test(path)) && !rules.some((rule) => rule.exclude && rule.pattern.test(path))),
		unmatched: rules.filter((rule) => !paths.some((path) => rule.pattern.test(path))).map((rule) => rule.entry),
	};
}

/** One `file:line  text` line for each English text found in the files. */
async function untranslatedLines(paths: readonly string[], read: (path: string) => Promise<string>): Promise<string[]> {
	const sources = await Promise.all(paths.map(read));
	return paths.flatMap((path, index) => findUntranslatedText(sources[index], path).map((hit) => `${hit.file}:${hit.line}  ${hit.text}`));
}

describe('the covered folders', () => {
	const paths = Object.keys(loaders).map((path) => path.replace(/^\//, ''));

	it('are every source file but tests, so a covered path can be anywhere in the app', () => {
		expect(paths).toContain('src/main.tsx');
		expect(paths).toContain('shared/i18n/extract.ts');
		expect(paths).toContain('worker/index.ts');
		expect(paths.filter((path) => /\.(test|spec|d)\.tsx?$/.test(path))).toEqual([]);
	});

	it('name only paths that exist, so a typo does not leave a folder uncovered', () => {
		const { unmatched } = coveredPaths(COVERED, paths);
		if (unmatched.length > 0) throw new Error(`COVERED entries that match no file (a folder ends with /):\n${unmatched.join('\n')}`);
	});

	// Every covered file is loaded and parsed here, so the default 5 s is too little once most of the app is covered.
	it('have no English text outside t(), tn(), msg() and <T>', async () => {
		const { files } = coveredPaths(COVERED, paths);
		const lines = await untranslatedLines(files, (path) => loaders[`/${path}`]());
		if (lines.length > 0) {
			throw new Error(`${lines.length} English text(s) in covered files; wrap each in t(), tn(), msg() or <T>, or mark it with i18n-ignore:\n${lines.join('\n')}`);
		}
	}, 30_000);
});

describe('covering a folder', () => {
	const PATHS = ['src/a/one.tsx', 'src/a/deep/two.ts', 'src/ab/three.tsx', 'src/a.tsx', 'src/hooks/use-billing.ts', 'src/hooks/use-billing-view.ts', 'src/hooks/use-billing/x.ts', 'src/routes/[id].tsx'];

	it('covers every file below a folder, and only that folder', () => {
		expect(coveredPaths(['src/a/'], PATHS).files).toEqual(['src/a/one.tsx', 'src/a/deep/two.ts']);
		expect(coveredPaths(['src/a/**'], PATHS).files).toEqual(['src/a/one.tsx', 'src/a/deep/two.ts']);
	});

	it('covers a file by its path, with or without a leading slash', () => {
		expect(coveredPaths(['src/a.tsx'], PATHS).files).toEqual(['src/a.tsx']);
		expect(coveredPaths(['/src/a.tsx'], PATHS).files).toEqual(['src/a.tsx']);
	});

	it('covers by glob: * within a folder, ** across folders, ? for one character, {a,b} to choose', () => {
		expect(coveredPaths(['src/hooks/use-billing*.ts'], PATHS).files).toEqual(['src/hooks/use-billing.ts', 'src/hooks/use-billing-view.ts']);
		expect(coveredPaths(['src/**/*.tsx'], PATHS).files).toEqual(['src/a/one.tsx', 'src/ab/three.tsx', 'src/a.tsx', 'src/routes/[id].tsx']);
		expect(coveredPaths(['src/a?/three.tsx'], PATHS).files).toEqual(['src/ab/three.tsx']);
		expect(coveredPaths(['src/{a,ab}/*.tsx'], PATHS).files).toEqual(['src/a/one.tsx', 'src/ab/three.tsx']);
	});

	it('takes brackets and dots in a path as written', () => {
		expect(coveredPaths(['src/routes/[id].tsx'], PATHS).files).toEqual(['src/routes/[id].tsx']);
		expect(coveredPaths(['src/routes/[id].tsx'], ['src/routes/i.tsx', 'src/routes/xid.tsx']).files).toEqual([]);
	});

	it('leaves out what a ! entry matches', () => {
		expect(coveredPaths(['src/a/', '!src/a/deep/two.ts'], PATHS).files).toEqual(['src/a/one.tsx']);
		expect(coveredPaths(['!src/a/deep/two.ts', 'src/a/'], PATHS).files).toEqual(['src/a/one.tsx']);
	});

	it('covers nothing by default', () => {
		expect(coveredPaths([], PATHS)).toEqual({ files: [], unmatched: [] });
	});

	it('reports an entry that matches no file, even one that leaves files out', () => {
		expect(coveredPaths(['src/a', 'src/a/', '!src/a/missing.tsx', 'src/nothing/'], PATHS).unmatched).toEqual(['src/a', '!src/a/missing.tsx', 'src/nothing/']);
	});

	it('fails with a file:line list of the English text left in a covered file', async () => {
		const sources: Record<string, string> = {
			'src/a/one.tsx': `export const One = () => (\n\t<div>\n\t\t<p>Hello</p>\n\t\t<input placeholder={t('Search')} title="Close" />\n\t</div>\n);`,
			'src/ab/three.tsx': `export const Three = () => <p>Never read</p>;`,
		};
		const { files } = coveredPaths(['src/a/'], Object.keys(sources));
		const lines = await untranslatedLines(files, async (path) => sources[path]);
		expect(lines).toEqual(['src/a/one.tsx:3  Hello', 'src/a/one.tsx:4  Close']);
	});
});
