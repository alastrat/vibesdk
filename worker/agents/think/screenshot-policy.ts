/** The commits that decide whether a Think app needs a new thumbnail. */
export interface ScreenshotTargetInput {
	/** Commit the preview currently serves. */
	lastDeployedCommit?: string;
	/** Commit the stored thumbnail shows. */
	screenshotCommit?: string;
	/** Commit a capture is already running for. */
	inFlightCommit?: string | null;
}

/**
 * Returns the deployed commit to capture, or null when nothing is deployed,
 * the stored thumbnail already shows it, or a capture for it is running.
 */
export function screenshotTarget({
	lastDeployedCommit,
	screenshotCommit,
	inFlightCommit,
}: ScreenshotTargetInput): string | null {
	if (!lastDeployedCommit) return null;
	if (lastDeployedCommit === screenshotCommit) return null;
	if (lastDeployedCommit === inFlightCommit) return null;
	return lastDeployedCommit;
}
