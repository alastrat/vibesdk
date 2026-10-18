/**
 * One WebSocket attempt reports its failure once, however many of its timeout, error and close events fire, so a failed
 * attempt counts once toward the retry limit and schedules one retry.
 */
export function failureReporterForAttempt(report: (reason: string) => void): (reason: string) => void {
	let reported = false;
	return (reason) => {
		if (reported) return;
		reported = true;
		report(reason);
	};
}
