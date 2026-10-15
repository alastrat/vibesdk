import { pageTitle } from '@/brand';
import { AssistantsPanel } from '@/components/public-site/AssistantsPanel';
import { AgenticCommerceSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Features } from './Features';
import { Hero } from './Hero';
import { LivePreview } from './LivePreview';
import { SellersBand } from './SellersBand';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta
				name="description"
				content="Describe your store and Estori builds it in minutes, with your products, cart and checkout. AI assistants that help you sell and run it are coming soon."
			/>
			<Hero stores={stores} />
			<AgenticCommerceSection />
			<AssistantsPanel />
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
