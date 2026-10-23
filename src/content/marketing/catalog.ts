import type { Catalog } from '../../../shared/i18n/translate';

type CopyTree = string | readonly CopyTree[] | { readonly [key: string]: CopyTree };

/** Match stable content paths, then expose translations through the app's English-key dictionary. */
export function marketingCatalog(source: CopyTree, translated: CopyTree): Catalog {
	const result: Record<string, string> = {};
	function visit(english: CopyTree, localized: CopyTree): void {
		if (typeof english === 'string' && typeof localized === 'string') {
			if (localized.trim()) result[english] = localized;
			return;
		}
		if (typeof english !== 'object' || typeof localized !== 'object') return;
		for (const [key, value] of Object.entries(english)) {
			const next = (localized as Record<string, CopyTree>)[key];
			if (next !== undefined) visit(value, next);
		}
	}
	visit(source, translated);
	return result;
}
