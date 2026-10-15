import { AssistantsPanel } from '@/components/public-site/AssistantsPanel';
import { AgenticCommerceSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PageMeta } from '@/components/public-site/solution-page';
import { HOME_PAGE } from '@/content/public-pages';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Features } from './Features';
import { Hero } from './Hero';
import { SellersBand } from './SellersBand';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<PageMeta {...HOME_PAGE} />
			{/* One band under both: where the hero ends on a fractional pixel, the page's white would show through as a seam. */}
			<div className="bg-public-charcoal">
				<Hero stores={stores} />
				<StoreShowcase stores={stores} />
			</div>
			<AgenticCommerceSection />
			<AssistantsPanel />
			<PersonalizationSection />
			<Features />
			<SellersBand />
			<ClosingPanel />
		</>
	);
}
