/** The free plan's daily limits as currently configured, and whether paid plans are on sale; a limit is null when it's off or not counted per day. */
export interface PublicPlanLimits {
	newSitesPerDay: number | null;
	aiCreditsPerDay: number | null;
	/** True once billing is on for everyone. The route doesn't resolve the session, so an account billing is on for alone learns it from GET /api/billing. */
	billing: boolean;
}
