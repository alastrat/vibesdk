import { describe, expect, it } from 'vitest';
import { abortWhenClientLeaves } from './dev-browser-sidecar-signal';

/** Like `http.ServerResponse`: emits `close` once, finished or not. */
function fakeResponse(writableFinished: boolean) {
	let onClose: (() => void) | undefined;
	return {
		writableFinished,
		once(_event: 'close', listener: () => void) {
			onClose = listener;
			return this;
		},
		close() {
			onClose?.();
		},
	};
}

describe('abortWhenClientLeaves', () => {
	it('aborts when the worker drops the request before the response is sent', () => {
		const res = fakeResponse(false);
		const signal = abortWhenClientLeaves(res);

		res.close();

		expect(signal.aborted).toBe(true);
	});

	it('stays open when the connection closes after the response is sent', () => {
		const res = fakeResponse(true);
		const signal = abortWhenClientLeaves(res);

		res.close();

		expect(signal.aborted).toBe(false);
	});
});
