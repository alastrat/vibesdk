/**
 * Removes the names listed in a comma-separated skip list (DEPLOY_SKIP_SECRETS)
 * from the variables the deploy script uploads as Worker secrets.
 */
export function filterSkippedSecrets(names: readonly string[], skipList: string | undefined): string[] {
	const skipped = new Set(
		(skipList ?? '')
			.split(',')
			.map((name) => name.trim())
			.filter((name) => name.length > 0),
	);
	return names.filter((name) => !skipped.has(name));
}
