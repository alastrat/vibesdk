import { AssistantsPanel } from '@/components/public-site/AssistantsPanel';
import { AgenticCommerceSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { BRAND_FAQ, BRAND_STEPS, TODAY_CARDS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

export default function BrandsPage() {
	return (
		<div>
			<PageMeta
				title="For brands"
				description="Build your brand's online store in minutes. Getting recommended by AI assistants, store assistants and personalized shopping are coming soon."
			/>
			<SolutionHero
				eyebrow="For brands and store owners"
				title="An online store for your brand, built in minutes"
				lead="Describe your brand and Estori builds a complete store that you keep shaping just by asking. Coming next: getting recommended by AI assistants, assistants that handle the daily work, and the right products for every shopper."
			/>
			<CardSection eyebrow="Available today" title="What your store comes with today" cards={TODAY_CARDS} />
			<AgenticCommerceSection id="agentic-commerce" />
			<AssistantsPanel
				id="operations"
				action={
					<StartBuildingButton variant="white" />
				}
			/>
			<PersonalizationSection id="personalization" />
			<HowItWorks steps={BRAND_STEPS} />
			<PublicFaq items={BRAND_FAQ} />
			<ClosingPanel />
		</div>
	);
}
