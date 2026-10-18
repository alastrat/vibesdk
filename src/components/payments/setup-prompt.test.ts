import { describe, expect, it } from 'vitest';
import { setupPrompt } from './setup-prompt';

const NEW_USER = { configured: true, connected: false, sellerTermsAccepted: false, setupStep: 'accept-terms' as const };

describe('the payments setup prompt on the home page', () => {
	it('invites someone who never started to set up payments', () => {
		expect(setupPrompt(NEW_USER, null)).toEqual({ key: 'invite', message: "Want your stores to take payments? Set up payments when you're ready to sell.", action: 'Set up payments' });
	});

	it("keeps showing a seller who started but can't take payments yet, naming the next step", () => {
		expect(setupPrompt({ ...NEW_USER, connected: true, sellerTermsAccepted: true, setupStep: 'finish-stripe' }, null)).toEqual({
			key: 'finish-stripe',
			message: "Your stores can't take payments yet: finish your Stripe setup.",
			action: 'Finish setup',
		});
		// Updated selling terms to accept again, though Stripe is done.
		expect(setupPrompt({ ...NEW_USER, connected: true, setupStep: 'accept-terms' }, null)).toMatchObject({ key: 'accept-terms', message: "Your stores can't take payments yet: accept the selling terms." });
		// Terms accepted but Stripe never opened.
		expect(setupPrompt({ ...NEW_USER, sellerTermsAccepted: true, setupStep: 'finish-stripe' }, null)).toMatchObject({ key: 'finish-stripe', action: 'Finish setup' });
	});

	it('shows nothing once the seller can take payments, or without Stripe on this deployment', () => {
		expect(setupPrompt({ ...NEW_USER, connected: true, sellerTermsAccepted: true, setupStep: null }, null)).toBeNull();
		expect(setupPrompt({ ...NEW_USER, configured: false }, null)).toBeNull();
	});

	it('stays dismissed for the step the seller dismissed, and comes back for a different one', () => {
		expect(setupPrompt(NEW_USER, 'invite')).toBeNull();
		// Dismissals saved before steps were remembered hid the invitation.
		expect(setupPrompt(NEW_USER, '1')).toBeNull();
		expect(setupPrompt({ ...NEW_USER, connected: true, setupStep: 'finish-stripe' }, '1')).toMatchObject({ key: 'finish-stripe' });
		expect(setupPrompt({ ...NEW_USER, connected: true, setupStep: 'finish-stripe' }, 'finish-stripe')).toBeNull();
		expect(setupPrompt({ ...NEW_USER, connected: true, sellerTermsAccepted: true, setupStep: 'bank-account' }, 'finish-stripe')).toMatchObject({ key: 'bank-account' });
	});
});
