import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { UNDERLINE_FILL } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { CATALOG_CARDS, RESELLER_FAQ, RESELLER_STEPS, TODAY_CARDS } from '@/content/positioning';
import { RESELLERS_PAGE } from '@/content/public-pages';
import { cn } from '@/lib/utils';
import { ClosingPanel } from '@/routes/landing/sections';

export default function ResellersPage() {
	return (
		<div>
			<PageMeta {...RESELLERS_PAGE} />
			<SolutionHero
				eyebrow="For dropshippers and resellers"
				title="Find products. Add them in a few clicks. Let suppliers ship."
				lead="Estori is building a curated catalog of vetted suppliers. Apply, choose products and they appear in your store, ready to sell."
				tag="product-catalog"
			/>
			<CardSection id="catalog" eyebrow="Catalog & fulfillment" tag="product-catalog" title="A curated product catalog" cards={CATALOG_CARDS}>
				<Link to="/platform/catalog-fulfillment" className={cn('inline-flex items-center gap-2 text-[17px] text-public-ink', UNDERLINE_FILL)}>
					How catalog and fulfillment work
					<ArrowRightIcon className="size-4" aria-hidden />
				</Link>
			</CardSection>
			<HowItWorks steps={RESELLER_STEPS} />
			<CardSection
				eyebrow="Available today"
				title="Build the store first"
				lead="While the catalog is on its way, build the store itself with Estori, ready for the products you'll add."
				cards={TODAY_CARDS}
			/>
			<PublicFaq items={RESELLER_FAQ} />
			<ClosingPanel />
		</div>
	);
}
