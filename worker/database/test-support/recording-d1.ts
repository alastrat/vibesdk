/**
 * A D1 stand-in that records each statement a service prepares; `rawRows` are the rows a select returns,
 * or a function of the statement's SQL when a flow selects from several tables. `batches` lists the
 * statements each `batch` call ran together.
 */
export function recordingD1(rawRows: unknown[][] | ((sql: string) => unknown[][]) = []) {
	type Entry = { sql: string; params: unknown[] };
	const statements: Entry[] = [];
	const batches: Entry[][] = [];
	const entries = new Map<object, Entry>();
	const d1 = {
		batch: async (prepared: object[]): Promise<unknown[]> => {
			batches.push(prepared.flatMap((statement) => entries.get(statement) ?? []));
			return [];
		},
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
			entries.set(statement, entry);
			return statement;
		},
	};
	return { d1, statements, batches };
}
