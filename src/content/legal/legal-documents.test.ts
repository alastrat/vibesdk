import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT, LEGAL_ENTITY, TERMS_VERSION, legalAddressLine } from '../../../shared/types/legal';
import { PLATFORM_FEE_LABEL } from '../../../shared/types/templates';
import { LEGAL_DOCUMENTS, LEGAL_LINKS, LEGAL_SLUGS } from './legal-documents';

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

	it('names Texas law and Harris County courts, and the Stripe agreement for sellers', () => {
		expect(LEGAL_DOCUMENTS.terms.body).toContain('laws of the State of Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Harris County, Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Stripe Connected Account Agreement');
	});
});
