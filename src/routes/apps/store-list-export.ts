/** Values are display data only; the export never includes account, prompt or deployment fields. */
export function storeListCsv(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
): string {
	const cell = (value: string) => {
		// Quoting alone does not stop spreadsheet formulas, including those after whitespace.
		const safe =
			/^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)
				? `'${value}`
				: value;
		return `"${safe.replaceAll('"', '""')}"`;
	};
	return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function downloadStoreList(csv: string): void {
	const url = URL.createObjectURL(
		new Blob([csv], { type: 'text/csv;charset=utf-8' }),
	);
	const link = document.createElement('a');
	link.href = url;
	link.download = 'estori-stores.csv';
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
