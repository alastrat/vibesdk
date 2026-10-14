/** The items on screen once `shown` have arrived: newest on top, or in arrival order. */
export function visibleListItems<T>(items: readonly T[], shown: number, newestFirst: boolean): T[] {
	const arrived = items.slice(0, Math.max(0, Math.min(shown, items.length)));
	return newestFirst ? arrived.reverse() : arrived;
}
