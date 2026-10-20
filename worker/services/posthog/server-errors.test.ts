import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorReporter, errorFingerprint, exceptionProperties, parseStack, reportServerError, scrubEmails } from './server-errors';
import type { CaptureInput } from './client';

const STACK = [
	'TypeError: x is undefined',
	'    at readSlug (index.js:120:15)',
	'    at async LiveStoreController.publish (index.js:300:9)',
	'    at index.js:10:1',
].join('\n');

describe('stack frames', () => {
	it('reads V8 frames, oldest call first and the throwing frame last', () => {
		expect(parseStack(STACK)).toEqual([
			{ platform: 'custom', lang: 'javascript', function: '?', filename: 'index.js', lineno: 10, colno: 1, in_app: true },
			{ platform: 'custom', lang: 'javascript', function: 'LiveStoreController.publish', filename: 'index.js', lineno: 300, colno: 9, in_app: true },
			{ platform: 'custom', lang: 'javascript', function: 'readSlug', filename: 'index.js', lineno: 120, colno: 15, in_app: true },
		]);
	});

	it('answers no frames for a missing or unreadable stack', () => {
		expect(parseStack(undefined)).toEqual([]);
		expect(parseStack('Error: no frames here')).toEqual([]);
	});
});

describe('exception events', () => {
	it('carries the type, the message and the log line with emails removed, and the component', () => {
		const error = new TypeError('No user ana@example.com');
		error.stack = STACK;
		expect(exceptionProperties({ component: 'AuthController', message: 'Registration error for bob.smith@example.org', error })).toEqual({
			component: 'AuthController',
			log_message: 'Registration error for [email]',
			$exception_level: 'error',
			$exception_list: [
				{ type: 'TypeError', value: 'No user [email]', mechanism: { handled: true, synthetic: false }, stacktrace: { type: 'raw', frames: parseStack(STACK) } },
			],
		});
	});

	it('makes the log line the exception when no error was given, marked synthetic', () => {
		expect(exceptionProperties({ component: 'StripeWebhook', message: 'Stripe webhook rejected' }).$exception_list).toEqual([
			{ type: 'Error', value: 'Stripe webhook rejected', mechanism: { handled: true, synthetic: true }, stacktrace: { type: 'raw', frames: [] } },
		]);
	});

	it('removes email addresses wherever they appear', () => {
		expect(scrubEmails('From <ana+shop@example.co.uk>, to "x@y.io"')).toBe('From <[email]>, to "[email]"');
	});

	it('removes URL-encoded email addresses too', () => {
		expect(scrubEmails('contact ana%40example.com now')).toBe('contact [email] now');
		expect(scrubEmails('?email=bob.smith%40example.org&x=1')).not.toContain('bob');
	});

	// A Worker's clock stands still while code runs, so speed is held by the test's own time limit.
	it('reads a long run of text without an address in no time', () => {
		expect(scrubEmails('a'.repeat(100_000))).toHaveLength(100_000);
	}, 250);

	it('sends at most 2,000 characters of the message and of the log line', () => {
		const properties = exceptionProperties({ component: 'Big', message: 'm'.repeat(100_000), error: new Error('e'.repeat(100_000)) });
		expect(String(properties.log_message).length).toBeLessThanOrEqual(2_000);
		const [exception] = properties.$exception_list as { value: string }[];
		expect(exception.value.length).toBeLessThanOrEqual(2_000);
	});

	describe('an address near the end of a long message', () => {
		/** Both texts that are sent for a message: the log line, and the exception value. */
		function sentTexts(message: string): string[] {
			const properties = exceptionProperties({ component: 'Cut', message, error: new Error(message) });
			const [exception] = properties.$exception_list as { value: string }[];
			return [String(properties.log_message), exception.value];
		}

		function expectNoAddress(message: string): void {
			for (const text of sentTexts(message)) {
				expect(text).not.toContain('ana');
				expect(text).not.toContain('garcia');
				expect(text.length).toBeLessThanOrEqual(2_000);
			}
		}

		it('is removed when it ends just past the 2,000 character cut', () => {
			expectNoAddress('x '.repeat(998) + 'ana.garcia@example.com');
		});

		it('is removed when it straddles the cut', () => {
			expectNoAddress('x '.repeat(995) + 'ana.garcia@example.com');
		});

		it('is removed wherever it falls around the cut and the end of the scrubbed window', () => {
			for (let offset = 1_900; offset <= 2_700; offset += 3) expectNoAddress(`${'y'.repeat(offset)} ana.garcia@example.com tail`);
		});

		it('is removed from a long list of addresses, which shrinks as it is scrubbed', () => {
			expectNoAddress('ana.garcia@example.com '.repeat(200));
			expectNoAddress(`${'x '.repeat(500)}${'ana.garcia@example.com '.repeat(200)}`);
		});
	});

	it('skips an absurdly long stack line instead of reading it', () => {
		expect(parseStack(`Error: x\n    at ${'a ('.repeat(30_000)}`)).toEqual([]);
	}, 250);

	it('treats errors that differ only in ids and numbers as one', () => {
		const a = errorFingerprint({ component: 'Runner', message: 'step failed', error: new Error('Order ord_8f3a9c21d0 failed after 3 attempts') });
		const b = errorFingerprint({ component: 'Runner', message: 'step failed', error: new Error('Order ord_1b2c3d4e5f failed after 4 attempts') });
		expect(a).toBe(b);
		expect(errorFingerprint({ component: 'Other', message: 'step failed', error: new Error('Order ord_1 failed') })).not.toBe(a);
	});
});

describe('the error reporter', () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function reporter(send: (input: CaptureInput) => void = () => undefined) {
		let now = 0;
		const sent: CaptureInput[] = [];
		const errors = new ErrorReporter(
			(input) => {
				sent.push(input);
				send(input);
			},
			{ perMinute: 30, repeatWindowMs: 60_000 },
			() => now,
		);
		return { errors, sent, advance: (ms: number) => (now += ms) };
	}

	it('sends a personless $exception from the system id', () => {
		const { errors, sent } = reporter();
		errors.report({ component: 'AuthController', message: 'Registration error', error: new Error('boom') });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ event: '$exception', distinctId: 'estori-system', personless: true });
	});

	it('sends a repeated error once a minute', () => {
		const { errors, sent, advance } = reporter();
		for (let i = 0; i < 1_000; i++) errors.report({ component: 'Loop', message: 'tick failed', error: new Error(`tick ${i} failed`) });
		expect(sent).toHaveLength(1);
		advance(60_000);
		errors.report({ component: 'Loop', message: 'tick failed', error: new Error('tick 1001 failed') });
		expect(sent).toHaveLength(2);
	});

	it('sends at most 30 errors a minute', () => {
		const { errors, sent, advance } = reporter();
		for (let i = 0; i < 50; i++) errors.report({ component: `Component${'x'.repeat(i)}`, message: 'failed' });
		expect(sent).toHaveLength(30);
		advance(60_000);
		errors.report({ component: 'Fresh', message: 'failed' });
		expect(sent).toHaveLength(31);
	});

	it('never throws, even when sending does', () => {
		const { errors } = reporter(() => {
			throw new Error('PostHog client broke');
		});
		expect(() => errors.report({ component: 'A', message: 'b' })).not.toThrow();
	});

	it('warns on the console, once, however often reporting fails', () => {
		const { errors } = reporter(() => {
			throw new Error('PostHog client broke');
		});
		for (let i = 0; i < 5; i++) errors.report({ component: `Failing${i}`, message: 'b' });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ level: 'warn', component: 'PostHog', error: 'PostHog client broke' });
	});

	it('stays quiet when nothing fails', () => {
		const { errors } = reporter();
		errors.report({ component: 'Fine', message: 'b' });
		expect(warn).not.toHaveBeenCalled();
	});

	it('is a quiet no-op without a project key', () => {
		expect(() => reportServerError({ component: 'Test', message: 'nothing configured' })).not.toThrow();
	});
});
