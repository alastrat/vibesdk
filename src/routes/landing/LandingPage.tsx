import { pageTitle } from '@/brand';
import { AgenticCommerceSection, OperationsSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Features } from './Features';
import { Hero } from './Hero';
import { LivePreview } from './LivePreview';
import { SellersBand } from './SellersBand';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta
				name="description"
				content="Estori is the agentic commerce platform: build your store with AI today, with selling through AI assistants and operations agents coming soon."
			/>
			<Hero />
			<StoreLogos stores={stores} />
			<AgenticCommerceSection />
			<OperationsSection />
			<PersonalizationSection />
			<Features />
			<SellersBand />
			<StoreShowcase stores={stores} />
			<LivePreview />
			<PricingSummary />
			<PublicFaq />
			<ClosingPanel />
		</>
	);
}
