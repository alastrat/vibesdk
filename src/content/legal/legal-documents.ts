import { LEGAL_CONTACT, LEGAL_ENTITY, PLATFORM_FEE_LABEL, legalAddressLine } from '@/api-types';
import { parseLegalDocument, type LegalDocument } from '@/lib/legal-document';
import terms from './terms.md?raw';
import privacy from './privacy.md?raw';
import refunds from './refunds.md?raw';
import copyright from './copyright.md?raw';

export const LEGAL_SLUGS = ['terms', 'privacy', 'refunds', 'copyright'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const FIELDS: Readonly<Record<string, string>> = {
	'entity.name': LEGAL_ENTITY.name,
	'entity.kind': LEGAL_ENTITY.kind,
	'entity.address': legalAddressLine(),
	'contact.support': LEGAL_CONTACT.support,
	'contact.privacy': LEGAL_CONTACT.privacy,
	'contact.copyright': LEGAL_CONTACT.copyright,
	'fee.label': PLATFORM_FEE_LABEL,
};

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = {
	terms: parseLegalDocument(terms, FIELDS),
	privacy: parseLegalDocument(privacy, FIELDS),
	refunds: parseLegalDocument(refunds, FIELDS),
	copyright: parseLegalDocument(copyright, FIELDS),
};

export const LEGAL_LINKS: ReadonlyArray<{ slug: LegalSlug; label: string; path: string }> = [
	{ slug: 'terms', label: 'Terms', path: '/terms' },
	{ slug: 'privacy', label: 'Privacy', path: '/privacy' },
	{ slug: 'refunds', label: 'Refunds', path: '/refunds' },
	{ slug: 'copyright', label: 'Copyright', path: '/copyright' },
];
