/**
 * The landing demo's scroll growth: a card that pins under the top bar and grows until it fills the
 * window. Distances are in stage heights, the room under the top bar.
 */

/** Growth starts when the track's top is this far below the line the stage pins at. */
const GROW_LEAD = 0.5;
/** Growth finishes this far past that line. */
const GROW_FULL = 0.4;
/** Full size holds this long before the page moves on. */
const GROW_HOLD = 0.4;

/** How far past the stage's own height the track runs, so the stage stays pinned while it grows and holds. */
export const GROW_TRACK_EXTRA = GROW_FULL + GROW_HOLD;

/** The card's corner radius at rest. */
export const PANEL_RADIUS = 25;

/** Sizes in pixels, from layout: the window's scale doesn't change them. */
export interface GrowGeometry {
	stageWidth: number;
	stageHeight: number;
	cardWidth: number;
	cardHeight: number;
	frameWidth: number;
	frameHeight: number;
}

export interface GrowLayout {
	panelWidth: number;
	panelHeight: number;
	panelRadius: number;
	/** How far down the window moves to stay on the panel's bottom edge. */
	frameShift: number;
	frameScale: number;
}

/** 0 at rest to 1 fully grown, from the track's top and the line the stage pins at, both from the top of the scroll area. */
export function growProgress(trackTop: number, pinTop: number, stageHeight: number): number {
	if (stageHeight <= 0) return 0;
	const scrolled = (pinTop - trackTop) / stageHeight;
	return Math.min(1, Math.max(0, (scrolled + GROW_LEAD) / (GROW_LEAD + GROW_FULL)));
}

/** The card can grow only when the stage shows all of it. */
export function canGrow(geometry: GrowGeometry): boolean {
	return geometry.cardHeight <= geometry.stageHeight;
}

/**
 * The panel grows from the card to the whole stage. The window rides on its bottom edge and grows,
 * keeping the card's padding, until it meets the panel's sides or top.
 */
export function growLayout(progress: number, geometry: GrowGeometry): GrowLayout {
	const { stageWidth, stageHeight, cardWidth, cardHeight, frameWidth, frameHeight } = geometry;
	const sidePadding = (cardWidth - frameWidth) / 2;
	const topPadding = cardHeight - frameHeight;
	const fullScale = Math.max(1, Math.min((stageWidth - 2 * sidePadding) / frameWidth, (stageHeight - topPadding) / frameHeight));
	const rise = stageHeight - cardHeight;
	return {
		panelWidth: cardWidth + (stageWidth - cardWidth) * progress,
		panelHeight: cardHeight + rise * progress,
		panelRadius: PANEL_RADIUS * (1 - progress),
		frameShift: rise * progress,
		frameScale: 1 + (fullScale - 1) * progress,
	};
}
