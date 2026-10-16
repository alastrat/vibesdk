import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT, LEGAL_ENTITY, TERMS_VERSION, legalAddressLine } from '../../../shared/types/legal';
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
		expect(terms.version).toBe('2026-10-16');
		// The selling terms change only when section 10 changes, never newer than the Terms that hold them.
		expect(SELLER_TERMS_VERSION <= terms.version).toBe(true);
		expect(terms.body).toContain('## 10. Selling in your own store');
		expect(terms.body).toContain('## 21. Contact');
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
		expect(body.match(/## (\d+)\. Our property/)?.[1]).toBe('12');
		expect(body.split('\n').find((line) => line.includes('survive termination'))).toBe(
			'Sections 4 (the license for copies already made), 5, 6, 8, 9, 10, 12 and 15 to 19 survive termination.',
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
});
