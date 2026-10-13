import { useEffect, useState, type RefObject } from 'react';
import { formatTemplatePrice, type SitePageData } from '@/api-types';
import { SiteMainButton, type SiteActions } from './SiteMainButton';

interface StickyBuyBarProps {
	page: SitePageData;
	actions: SiteActions;
	/** The header's actions; the bar shows while they are out of view. */
	watchRef: RefObject<HTMLDivElement | null>;
}

export function StickyBuyBar({ page, actions, watchRef }: StickyBuyBarProps) {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const element = watchRef.current;
		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting));
		observer.observe(element);
		return () => observer.disconnect();
	}, [watchRef]);

	if (!visible) return null;
	return (
		<div className="fixed inset-x-0 bottom-0 z-30 border-t border-kumo-hairline bg-kumo-base/95 backdrop-blur">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="truncate text-sm font-medium text-kumo-default">{page.title}</span>
					<span className="shrink-0 text-sm text-kumo-subtle">
						{page.priceCents !== null ? formatTemplatePrice(page.priceCents) : 'Free'}
					</span>
				</div>
				<SiteMainButton page={page} actions={actions} />
			</div>
		</div>
	);
}
