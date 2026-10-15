import { describe, expect, it } from 'vitest';
import { canGrow, GROW_TRACK_EXTRA, growLayout, growProgress, PANEL_RADIUS, type GrowGeometry } from './scroll-grow';

/** A 1440 x 900 window: the stage under a 117px top bar, the card at its 1152px cap. */
const DESKTOP: GrowGeometry = { stageWidth: 1425, stageHeight: 783, cardWidth: 1152, cardHeight: 556, frameWidth: 1072, frameHeight: 508 };

describe('growProgress', () => {
	it('stays at rest until the track is half a stage below the line it pins at', () => {
		expect(growProgress(117 + 783, 117, 783)).toBe(0);
		expect(growProgress(117 + 783 / 2, 117, 783)).toBe(0);
	});

	it('is over halfway grown when the stage pins, and full a little later', () => {
		expect(growProgress(117, 117, 783)).toBeCloseTo(0.5 / 0.9);
		expect(growProgress(117 - 0.4 * 783, 117, 783)).toBe(1);
	});

	it('holds full size while the rest of the track scrolls by', () => {
		expect(growProgress(117 - GROW_TRACK_EXTRA * 783, 117, 783)).toBe(1);
		expect(growProgress(-5000, 117, 783)).toBe(1);
	});

	it('pins long enough to finish growing and then hold', () => {
		expect(GROW_TRACK_EXTRA).toBeCloseTo(0.8);
	});

	it('stays at rest on a stage with no height', () => {
		expect(growProgress(0, 117, 0)).toBe(0);
	});
});

describe('growLayout', () => {
	it('matches the card at rest', () => {
		expect(growLayout(0, DESKTOP)).toEqual({ panelWidth: 1152, panelHeight: 556, panelRadius: PANEL_RADIUS, frameShift: 0, frameScale: 1 });
	});

	it('fills the stage edge to edge when fully grown, with square corners', () => {
		const full = growLayout(1, DESKTOP);
		expect(full.panelWidth).toBe(1425);
		expect(full.panelHeight).toBe(783);
		expect(full.panelRadius).toBe(0);
	});

	it('keeps the window on the panel bottom and grows it until a side meets the panel padding', () => {
		const full = growLayout(1, DESKTOP);
		expect(full.frameShift).toBe(783 - 556);
		// Width bound: the 40px side padding stays on a 1425px stage.
		expect(full.frameScale).toBeCloseTo((1425 - 80) / 1072);
		expect(1072 * full.frameScale).toBeLessThanOrEqual(1425 - 80 + 1e-9);
		expect(508 * full.frameScale).toBeLessThanOrEqual(783 - 48);
	});

	it('is bound by height on a wide, short stage', () => {
		const wide: GrowGeometry = { ...DESKTOP, stageWidth: 2545, stageHeight: 1200 };
		expect(growLayout(1, wide).frameScale).toBeCloseTo((1200 - 48) / 508);
	});

	it('never shrinks the window', () => {
		// Only 548px of height above the 32px top padding for a 558px window.
		const narrow: GrowGeometry = { stageWidth: 390, stageHeight: 580, cardWidth: 366, cardHeight: 590, frameWidth: 334, frameHeight: 558 };
		expect(growLayout(1, narrow).frameScale).toBe(1);
	});

	it('moves halfway at half progress', () => {
		const half = growLayout(0.5, DESKTOP);
		expect(half.panelWidth).toBeCloseTo((1152 + 1425) / 2);
		expect(half.panelRadius).toBeCloseTo(PANEL_RADIUS / 2);
		expect(half.frameShift).toBeCloseTo((783 - 556) / 2);
	});
});

describe('canGrow', () => {
	it('grows only when the card fits the stage', () => {
		expect(canGrow(DESKTOP)).toBe(true);
		expect(canGrow({ ...DESKTOP, stageHeight: 500 })).toBe(false);
	});
});
