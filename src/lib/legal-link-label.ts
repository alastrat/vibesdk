import { t } from '@/lib/i18n';
import type { LegalSlug } from '@/content/legal/legal-documents';

/** A legal link's label in the active language. The documents themselves stay in English. */
export function legalLinkLabel(slug: LegalSlug): string {
	switch (slug) {
		case 'terms':
			return t('Terms');
		case 'privacy':
			return t('Privacy');
		case 'refunds':
			return t('Refunds');
		case 'copyright':
			return t('Copyright');
	}
}
