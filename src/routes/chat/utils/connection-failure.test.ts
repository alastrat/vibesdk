import { describe, expect, it } from 'vitest';
import { failureReporterForAttempt } from './connection-failure';

const sources = import.meta.glob<string>(['/src/routes/chat/hooks/use-chat.ts'], { query: '?raw', import: 'default', eager: true });

describe("a connection attempt's failure", () => {
	it('is reported once, however many of its timeout, error and close events fire, so one retry is scheduled', () => {
		const reported: string[] = [];
		const report = failureReporterForAttempt((reason) => reported.push(reason));
		report('WebSocket error');
		report('Connection closed (code: 1006)');
		report('Connection timeout');
		expect(reported).toEqual(['WebSocket error']);
	});

	it("is what the chat's timeout, error and close handlers report through", () => {
		const chat = sources['/src/routes/chat/hooks/use-chat.ts'] ?? '';
		expect(chat).toContain('const reportFailure = failureReporterForAttempt(');
		for (const reason of ["reportFailure('Connection timeout')", "reportFailure('WebSocket error')", 'reportFailure(`Connection closed (code: ${event.code})`)']) {
			expect(chat, reason).toContain(reason);
		}
	});
});
