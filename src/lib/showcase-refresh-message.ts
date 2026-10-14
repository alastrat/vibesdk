import type { ShowcaseRefreshData } from '@/api-types';

/** One line for the admin page after a showcase refresh. */
export function showcaseRefreshMessage(result: ShowcaseRefreshData): string {
	if (result.attempted === 0) return 'Every Discover store has a showcase image.';
	const parts = [`Captured ${result.captured} of ${result.attempted}.`];
	if (result.failed > 0) parts.push(`${result.failed} failed.`);
	parts.push(result.remaining > 0 ? `${result.remaining} still need one; refresh again.` : 'None left to capture.');
	return parts.join(' ');
}
