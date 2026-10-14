import { pageTitle } from '@/brand';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Hero } from './Hero';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingCta, ForCreators, ForStoreOwners, LandingFaq, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<StoreLogos stores={stores} />
			<StoreShowcase stores={stores} />
			<ForCreators />
			<ForStoreOwners />
			<PricingSummary />
			<LandingFaq />
			<ClosingCta />
		</>
	);
}
