import { pageTitle } from '@/brand';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { CreatorsPanel } from './CreatorsPanel';
import { Features } from './Features';
import { Hero } from './Hero';
import { LivePreview } from './LivePreview';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<StoreLogos stores={stores} />
			<StoreShowcase stores={stores} />
			<Features />
			<CreatorsPanel />
			<LivePreview />
			<PricingSummary />
			<PublicFaq />
			<ClosingPanel />
		</>
	);
}
