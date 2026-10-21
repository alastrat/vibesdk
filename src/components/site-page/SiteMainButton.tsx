import { getLocale, t, useI18n } from '@/lib/i18n';
import type { ReactNode } from 'react';
import { Button } from '@cloudflare/kumo';
import { formatTemplatePrice, type SitePageData } from '@/api-types';

export interface SiteActions {
	use: () => void;
	buy: () => void;
	edit: () => void;
	/** Checkout started; stays true until the browser leaves for Stripe. */
	buying: boolean;
}

/** The page's main action for this viewer: buy, use, edit their own page, or nothing yet. */
export function SiteMainButton({ page, actions }: { page: SitePageData; actions: SiteActions }): ReactNode {
	useI18n();
	const offer = page.offer;
	switch (offer.kind) {
		case 'paid':
			return (
				<Button variant="primary" loading={actions.buying} onClick={actions.buy}>{t('Buy for {price}', { price: formatTemplatePrice(offer.priceCents, getLocale(), t('Free')) })}
				</Button>
			);
		case 'free':
		case 'owned':
			return (
				<Button variant="primary" onClick={actions.use}>{t("Use this site")}</Button>
			);
		case 'own':
			return (
				<div className="flex items-center gap-2">
					<Button variant="secondary" onClick={actions.edit}>{t("Edit page")}</Button>
					<Button variant="primary" disabled={!offer.canUse} onClick={actions.use}>{t("Use this site")}</Button>
				</div>
			);
		case 'not-yet-available':
			return (
				<Button variant="primary" disabled>{t("Not available yet")}</Button>
			);
	}
}
