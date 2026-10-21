import { describe, expect, it } from 'vitest';
import { syncPerson, type PostHogPerson } from './posthog-browser';

/**
 * posthog-js as far as the person goes: `identify` captures `$identify` at once when capturing is on and the id
 * changes from an anonymous one, and nothing calls it back later; `reset` clears the analytics setting to the default
 * the instance was loaded with.
 */
class FakePostHog implements PostHogPerson {
	readonly calls: string[] = [];
	readonly sent: string[] = [];
	private distinctId = 'anon-1';
	private identified = false;
	private optedOut: boolean;
	private resets = 0;

	constructor(
		private readonly optedOutByDefault: boolean,
		state: { identifiedAs?: string; optedOut?: boolean } = {},
	) {
		this.optedOut = state.optedOut ?? optedOutByDefault;
		if (state.identifiedAs) {
			this.distinctId = state.identifiedAs;
			this.identified = true;
		}
	}

	reset(): void {
		this.calls.push('reset');
		this.resets += 1;
		this.distinctId = `anon-${this.resets + 1}`;
		this.identified = false;
		this.optedOut = this.optedOutByDefault;
	}

	identify(id: string): void {
		this.calls.push(`identify ${id}`);
		if (!this.optedOut && !this.identified && id !== this.distinctId) this.sent.push(`$identify ${id} from ${this.distinctId}`);
		this.distinctId = id;
		this.identified = true;
	}

	get_distinct_id(): string {
		return this.distinctId;
	}

	opt_in_capturing(): void {
		this.calls.push('opt in');
		this.optedOut = false;
	}

	opt_out_capturing(): void {
		this.calls.push('opt out');
		this.optedOut = true;
	}

	has_opted_out_capturing(): boolean {
		return this.optedOut;
	}
}

describe('the PostHog person in step with the session', () => {
	it('sends no $identify when an account that turned analytics off signs in', () => {
		const posthog = new FakePostHog(false);
		syncPerson(posthog, null, 'user-1', true);
		expect(posthog.sent).toEqual([]);
		expect(posthog.calls).toEqual(['opt out']);
		expect(posthog.has_opted_out_capturing()).toBe(true);
	});

	it('identifies an account that shares analytics as it signs in, joining its visit so far', () => {
		const posthog = new FakePostHog(false);
		syncPerson(posthog, null, 'user-1', false);
		expect(posthog.sent).toEqual(['$identify user-1 from anon-1']);
	});

	it('starts a new anonymous person before another account is identified', () => {
		const posthog = new FakePostHog(false, { identifiedAs: 'user-1' });
		syncPerson(posthog, 'user-1', 'user-2', false);
		expect(posthog.calls).toEqual(['reset', 'identify user-2']);
		expect(posthog.sent).toEqual(['$identify user-2 from anon-2']);
	});

	it('applies the setting again after the reset clears it, before identifying', () => {
		const loadedOptedOut = new FakePostHog(true, { identifiedAs: 'user-1' });
		syncPerson(loadedOptedOut, 'user-1', 'user-2', false);
		expect(loadedOptedOut.calls).toEqual(['reset', 'opt in', 'identify user-2']);
		expect(loadedOptedOut.sent).toEqual(['$identify user-2 from anon-2']);

		const switchingToOptedOut = new FakePostHog(false, { identifiedAs: 'user-1' });
		syncPerson(switchingToOptedOut, 'user-1', 'user-2', true);
		expect(switchingToOptedOut.calls).toEqual(['reset', 'opt out']);
		expect(switchingToOptedOut.sent).toEqual([]);
	});

	it('starts a new anonymous person on sign-out', () => {
		const posthog = new FakePostHog(false, { identifiedAs: 'user-1' });
		syncPerson(posthog, 'user-1', null, false);
		expect(posthog.calls).toEqual(['reset']);
		expect(posthog.get_distinct_id()).toBe('anon-2');
	});

	it('identifies an account when it turns analytics back on, and does nothing more while nothing changes', () => {
		const posthog = new FakePostHog(false, { optedOut: true });
		syncPerson(posthog, 'user-1', 'user-1', false);
		expect(posthog.calls).toEqual(['opt in', 'identify user-1']);
		expect(posthog.sent).toEqual(['$identify user-1 from anon-1']);

		syncPerson(posthog, 'user-1', 'user-1', false);
		expect(posthog.calls).toHaveLength(2);
	});
});
