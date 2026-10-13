/**
 * Starting a Think app from a published site: the hidden instruction for the
 * personalization turn and the app's first title.
 */

export function siteStartInstruction(siteTitle: string, description: string): string {
	return `This app started as a copy of the site ${siteTitle}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: ${description}. Keep none of the original site's copy. Then deploy.`;
}

/** The query stored for an exact copy: the agent treats an empty query as uninitialized. */
export function siteCopyQuery(siteTitle: string): string {
	return `Start from ${siteTitle}`;
}

/** Title from the prompt, or "{site} copy" for an exact copy with no prompt. */
export function initialProjectTitle(
	query: string,
	siteTitle: string | undefined,
	deriveTitle: (text: string) => string,
): string {
	if (query.trim()) return deriveTitle(query);
	if (siteTitle) return `${siteTitle} copy`;
	return deriveTitle('project');
}
