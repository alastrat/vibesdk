/** Endings that name the kind of site rather than the brand. */
const GENERIC_ENDINGS = ['landing page', 'website', 'template', 'theme', 'store', 'shop', 'site'] as const;

/** A store's name for the logo strip: its title without generic endings, never empty. */
export function storeWordmark(title: string): string {
	let words = title.trim().split(/\s+/).filter(Boolean);
	let trimmed = true;
	while (trimmed) {
		trimmed = false;
		for (const ending of GENERIC_ENDINGS) {
			const size = ending.split(' ').length;
			if (words.length > size && words.slice(-size).join(' ').toLowerCase() === ending) {
				words = words.slice(0, -size);
				trimmed = true;
				break;
			}
		}
	}
	return words.join(' ');
}
