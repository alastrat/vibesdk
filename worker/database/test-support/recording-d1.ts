/** A D1 stand-in that records each statement a service prepares and returns no rows. */
export function recordingD1() {
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
				raw: async () => [],
				run: async () => ({ results: [], success: true, meta: {} }),
				first: async () => null,
			};
			return statement;
		},
	};
	return { d1, statements };
}
