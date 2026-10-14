import { AgenticCommerceSection, OperationsSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { BRAND_FAQ, BRAND_STEPS, TODAY_CARDS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';

export default function BrandsPage() {
	return (
		<div>
			<PageMeta
				title="For brands"
				description="Build your store with AI today. Agentic commerce, operations agents and personalized shopping are coming soon to every Estori store."
			/>
			<SolutionHero
				eyebrow="For brands and store owners"
				title="Your store, built by agents and ready for AI shoppers"
				lead="Describe your brand and Estori builds a complete store you keep shaping by chat. Selling through AI assistants, agents that run day-to-day work and personalized shopping are coming soon to every store."
			/>
			<CardSection eyebrow="Available today" title="What Estori builds today" cards={TODAY_CARDS} />
			<AgenticCommerceSection id="agentic-commerce" />
			<OperationsSection id="operations" />
			<PersonalizationSection id="personalization" />
			<HowItWorks steps={BRAND_STEPS} />
			<PublicFaq items={BRAND_FAQ} />
			<ClosingPanel />
		</div>
	);
}
