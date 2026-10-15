import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { AGENT_READY_CARDS, AGENTIC_BASICS_CARDS, AGENTIC_FAQ } from '@/content/positioning';
import { AGENTIC_COMMERCE_PAGE } from '@/content/public-pages';
import { ClosingPanel } from '@/routes/landing/sections';

export default function AgenticCommercePage() {
	return (
		<div>
			<PageMeta {...AGENTIC_COMMERCE_PAGE} />
			<SolutionHero
				eyebrow="Get found by AI assistants"
				tag="agentic-commerce"
				title="Get recommended when shoppers ask AI"
				lead="More shoppers now ask AI assistants what to buy. Every Estori store will be ready to be found and recommended by them, with nothing for you to set up."
			/>
			<CardSection eyebrow="The basics" title="How it works" cards={AGENTIC_BASICS_CARDS} />
			<CardSection eyebrow="Ready for AI assistants" title="What your store will have" cards={AGENT_READY_CARDS} />
			<CardSection
				eyebrow="On Estori"
				tag="agentic-commerce"
				title="Built into every Estori store"
				lead="Estori runs your store's code, hosting and checkout, so it can add this to every store at once. No apps to install and nothing to maintain by hand."
				cards={[]}
			/>
			<PublicFaq items={AGENTIC_FAQ} />
			<ClosingPanel />
		</div>
	);
}
