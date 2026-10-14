/** The free plan's daily limits as currently configured; null when a limit is off or not counted per day. */
export interface PublicPlanLimits {
	newSitesPerDay: number | null;
	aiCreditsPerDay: number | null;
}
