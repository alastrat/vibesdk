import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT, LEGAL_ENTITY, TERMS_VERSION, legalAddressLine } from '../../../shared/types/legal';
import { EXTRA_CREDITS_DISCLOSURE, renewalDisclosure } from '../../../shared/types/billing';
import { PLATFORM_FEE_LABEL } from '../../../shared/types/templates';
import { LEGAL_DOCUMENTS, LEGAL_LINKS, LEGAL_SLUGS } from './legal-documents';
import { SELLER_TERMS_VERSION } from '../../../shared/types/seller-setup';
import { SUPPLIER_NAMES } from '../../routes/copy-rules';

describe('legal documents', () => {
	it('has the four pages, each with a path and a label', () => {
		expect(LEGAL_SLUGS).toEqual(['terms', 'privacy', 'refunds', 'copyright']);
		expect(LEGAL_LINKS.map((link) => link.path)).toEqual(['/terms', '/privacy', '/refunds', '/copyright']);
	});

	it('versions the terms and privacy policy together with what users agree to', () => {
		expect(LEGAL_DOCUMENTS.terms.version).toBe(TERMS_VERSION);
		expect(LEGAL_DOCUMENTS.privacy.version).toBe(TERMS_VERSION);
	});

	it('fills every field, naming the operator and its contact addresses', () => {
		for (const slug of LEGAL_SLUGS) {
			const { body, updated } = LEGAL_DOCUMENTS[slug];
			expect(body).not.toContain('{{');
			expect(body).toContain(LEGAL_ENTITY.name);
			expect(updated.length).toBeGreaterThan(0);
		}
		expect(LEGAL_DOCUMENTS.terms.body).toContain(legalAddressLine());
		expect(LEGAL_DOCUMENTS.terms.body).toContain(PLATFORM_FEE_LABEL);
		expect(LEGAL_DOCUMENTS.privacy.body).toContain(LEGAL_CONTACT.privacy);
		expect(LEGAL_DOCUMENTS.refunds.body).toContain(LEGAL_CONTACT.support);
		expect(LEGAL_DOCUMENTS.copyright.body).toContain(LEGAL_CONTACT.copyright);
	});

	it('lists account emails among what Cloudflare sends for us', () => {
		expect(LEGAL_DOCUMENTS.privacy.body).toContain(
			'sending account emails such as password resets and email confirmations',
		);
	});

	it('names Texas law and Harris County courts, and the Stripe agreement for sellers', () => {
		expect(LEGAL_DOCUMENTS.terms.body).toContain('laws of the State of Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Harris County, Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Stripe Connected Account Agreement');
	});

	it('promises erasure on request, not automatic deletion when a site is deleted', () => {
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('We complete erasure within 45 days');
		expect(LEGAL_DOCUMENTS.privacy.body).not.toContain('we delete the related personal data within 45 days');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('except for stored copies we keep until erasure is complete');
	});

	it('adds selling in your own store as section 10, in the version sellers agree to', () => {
		const terms = LEGAL_DOCUMENTS.terms;
		expect(terms.version).toBe('2026-10-19');
		// The selling terms change only when section 10 changes, never newer than the Terms that hold them.
		expect(SELLER_TERMS_VERSION <= terms.version).toBe(true);
		expect(terms.body).toContain('## 10. Selling in your own store');
		expect(terms.body).toContain('## 22. Contact');
		for (const promise of [
			'You are the merchant of record for your store',
			'you pay the whole refund',
			'the dispute fee Stripe charges',
			'from your later sales',
			'Stripe may debit the bank account',
			'$2 for each month in which you receive a payout',
			'0.25% plus 25 cents for each payout',
			'New sellers start with lower limits',
		]) {
			expect(terms.body).toContain(promise);
		}
		expect(terms.body).toContain('Globalink is the merchant of record for purchases of paid sites');
	});

	it("says the store's order emails reach shoppers through Estori, and how long Estori keeps a record of each", () => {
		const privacy = LEGAL_DOCUMENTS.privacy.body;
		expect(privacy).toContain('sending the order emails stores send their shoppers');
		expect(privacy).toContain("We use the shopper's email to send the store's order emails through Estori");
		expect(privacy).toContain('for 90 days');
	});

	it("tells shoppers whose data goes where, and leaves store purchases to the store's policy", () => {
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('**Fulfillment partners**');
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('Shoppers who pay at a store');
		expect(LEGAL_DOCUMENTS.refunds.body).toContain("follow that store's own refund policy");
		for (const slug of LEGAL_SLUGS) {
			for (const name of SUPPLIER_NAMES) expect(LEGAL_DOCUMENTS[slug].body.toLowerCase()).not.toContain(name);
		}
	});

	it('keeps section 10 and Our property among the sections that survive termination', () => {
		const body = LEGAL_DOCUMENTS.terms.body;
		expect(body.match(/## (\d+)\. Our property/)?.[1]).toBe('13');
		expect(body.split('\n').find((line) => line.includes('survive termination'))).toBe(
			'Sections 4 (the license for copies already made), 5, 6, 8, 9, 10, 13 and 16 to 20 survive termination.',
		);
	});

	it("binds store sellers to Stripe's agreement in section 8 too", () => {
		expect(LEGAL_DOCUMENTS.terms.body).toContain("Section 8's paragraph on the Stripe Services Agreement applies to you as a store seller too.");
	});

	it("tells shoppers their phone number is shared, and that store owners see their orders", () => {
		const privacy = LEGAL_DOCUMENTS.privacy.body;
		expect(privacy).toContain('We receive the name, email, phone number (when given) and shipping address');
		expect(privacy).toContain("A paid site's seller sees that a sale happened; its buyers' details aren't shown to them.");
		expect(privacy).not.toContain("buyers' details aren't shown to sellers");
	});

	it('adds plans, credits and extra credits as section 11, with renewal, cancelling and refunds', () => {
		const terms = LEGAL_DOCUMENTS.terms.body;
		expect(terms).toContain('## 11. Plans, AI credits and extra credits');
		for (const promise of [
			'renew automatically every month until you cancel',
			'Cancelling takes effect at the end of the period you paid for',
			'no refunds for part of a period',
			'Credits have no cash value',
			"charged from the AI's real usage",
			"Monthly credits don't carry over",
			'Extra credits are used after your monthly credits and expire 12 months after purchase',
			'non-refundable, except when you were charged twice or your account could not use them',
			"at least 30 days' notice",
			"If a renewal payment fails, your plan's features continue for 7 days while we retry the payment",
			"that period's AI credits start once the payment goes through",
			"your account moves to Basic if it still isn't paid",
		]) {
			expect(terms).toContain(promise);
		}
		expect(terms).toContain('Plans set how many sites you can create and how many AI credits you get. See section 11');
		expect(terms).not.toContain('daily limits');
		expect(terms).not.toContain('Purchases are one-time payments');
		expect(terms).toContain('A paid site is a one-time payment in US dollars');
		const refunds = LEGAL_DOCUMENTS.refunds.body;
		expect(refunds).toContain('Pro, Premium and extra credits');
		expect(refunds).toContain('within 14 days');
	});

	it('says at checkout what the Terms say', () => {
		const terms = LEGAL_DOCUMENTS.terms.body;
		expect(EXTRA_CREDITS_DISCLOSURE.startsWith('Extra credits are used after your monthly credits and expire 12 months after purchase')).toBe(true);
		expect(terms).toContain(EXTRA_CREDITS_DISCLOSURE.replace(/\.$/, ''));
		expect(renewalDisclosure('pro')).toContain('until you cancel');
	});

	it('names PostHog and Cloudflare Web Analytics, says no email or name goes to PostHog, and how to turn analytics off', () => {
		const privacy = LEGAL_DOCUMENTS.privacy.body;
		expect(privacy).toContain('**Usage information.**');
		expect(privacy).toContain("We record layouts and clicks, not what's written on the page or what you type.");
		expect(privacy).toContain('without the part of the address after a question mark');
		expect(privacy).toContain('**Page view counts.**');
		expect(privacy).toContain('Cloudflare Web Analytics counts page views');
		expect(privacy).toContain('previews and stores served on estori.app addresses');
		expect(privacy).toContain('**PostHog** (hosted in the United States): product analytics, session recordings and error reports');
		expect(privacy).toContain("We don't send it your email address or name.");
		expect(privacy).toContain('page view counts through Cloudflare Web Analytics, which uses no cookies');
		expect(privacy).toContain("We use PostHog's analytics cookie and browser storage on estori.app");
		expect(privacy).toContain("We don't use advertising cookies.");
		expect(privacy).not.toContain("We don't use advertising or analytics cookies.");
		expect(privacy).toContain("Stores built with Estori don't load PostHog.");
		expect(privacy).toContain('You can turn analytics off at any time with the Analytics setting in Settings.');
		expect(privacy).toContain('we still count the AI credits your builds use, without anything that identifies you');
		expect(privacy).toContain('Global Privacy Control');
		expect(LEGAL_DOCUMENTS.privacy.version).toBe(TERMS_VERSION);
	});
});
