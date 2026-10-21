import { t, useI18n } from '@/lib/i18n';
import type { Ref } from 'react';
import { TEMPLATE_CATEGORY_LABELS, type SitePageData } from '@/api-types';
import { sitePriceLabel } from '@/lib/site-page-display';
import { SiteMainButton, type SiteActions } from './SiteMainButton';

interface SiteHeaderProps {
	page: SitePageData;
	actions: SiteActions;
	/** The sticky bar appears once this element scrolls out of view. */
	actionsRef: Ref<HTMLDivElement>;
}

export function SiteHeader({ page, actions, actionsRef }: SiteHeaderProps) {
	useI18n();
	const kind = page.category ? t(TEMPLATE_CATEGORY_LABELS[page.category]) : t('Site');
	const price = sitePriceLabel(page);
	return (
		<header className="flex flex-wrap items-start justify-between gap-4">
			<div className="grid gap-1">
				<h1 className="text-3xl font-semibold text-kumo-strong">{page.title}</h1>
				{page.copy?.tagline && <p className="text-lg text-kumo-default">{page.copy.tagline}</p>}
				<p className="text-sm text-kumo-subtle">
					{t('{kind} template by {creator}', { kind, creator: page.creator.displayName })}
				</p>
			</div>
			<div ref={actionsRef} className="flex flex-wrap items-center gap-3">
				{price && <span className="text-lg font-medium text-kumo-default">{price}</span>}
				{page.previewUrl && (
					<a
						href={page.previewUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-lg px-3 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline hover:ring-kumo-line"
					>{t("Open live site ↗")}</a>
				)}
				<SiteMainButton page={page} actions={actions} />
			</div>
		</header>
	);
}
