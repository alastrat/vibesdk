import { pageTitle } from '@/brand';
import { ClosingCta, FeaturedStores, ForCreators, ForStoreOwners, Hero, LandingFaq, PricingSummary } from './sections';

export function LandingPage() {
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<FeaturedStores />
			<ForCreators />
			<ForStoreOwners />
			<PricingSummary />
			<LandingFaq />
			<ClosingCta />
		</>
	);
}
