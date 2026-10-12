/**
 * Starting a Think app from a template: the hidden instruction for the
 * personalization turn and the app's first title.
 */

export function templateStartInstruction(templateName: string, description: string): string {
	return `This app started from the template ${templateName}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: ${description}. Keep none of the template's original copy. Then deploy.`;
}

/** Title from the prompt, or "{template} copy" for an exact copy with no prompt. */
export function initialProjectTitle(
	query: string,
	templateName: string | undefined,
	deriveTitle: (text: string) => string,
): string {
	if (query.trim()) return deriveTitle(query);
	if (templateName) return `${templateName} copy`;
	return deriveTitle('project');
}
