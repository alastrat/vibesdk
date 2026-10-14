/**
 * A D1 stand-in that records each statement a service prepares; `rawRows` are the rows a select returns,
 * or a function of the statement's SQL when a flow selects from several tables.
 */
export function recordingD1(rawRows: unknown[][] | ((sql: string) => unknown[][]) = []) {
	const statements: { sql: string; params: unknown[] }[] = [];
	const d1 = {
		batch: async () => [],
		exec: async () => ({ count: 0, duration: 0 }),
		prepare(sql: string) {
			const entry = { sql, params: [] as unknown[] };
			statements.push(entry);
			const statement = {
				bind(...params: unknown[]) {
					entry.params = params;
					return statement;
				},
				all: async () => ({ results: [], success: true, meta: {} }),
				raw: async () => (typeof rawRows === 'function' ? rawRows(sql) : rawRows),
				run: async () => ({ results: [], success: true, meta: {} }),
				first: async () => null,
			};
			return statement;
		},
	};
	return { d1, statements };
}
