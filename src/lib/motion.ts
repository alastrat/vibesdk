export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the visitor asked their system for reduced motion. */
export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
