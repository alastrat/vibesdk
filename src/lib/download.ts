/** The file name a response asks for in its Content-Disposition header, with no folder in it; the fallback when it names none. */
export function filenameOfDisposition(header: string | null, fallback: string): string {
	const match = header === null ? null : /filename="?([^";]+)"?/i.exec(header);
	const name = match?.[1]?.split(/[\\/]/).pop()?.trim() ?? '';
	return name === '' || name === '.' || name === '..' ? fallback : name;
}

/** Hands the browser a file to save. */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	// Some browsers read the file after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The server's words for a refused download, or the fallback for a failure that has none: a request that never arrived has status 0. */
export function downloadFailureMessage(failure: unknown, fallback: string): string {
	if (!(failure instanceof Error) || failure.message === '') return fallback;
	const status = 'status' in failure && typeof failure.status === 'number' ? failure.status : 0;
	return status > 0 ? failure.message : fallback;
}
