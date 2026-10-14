import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { AGENT_READY_CARDS, AGENTIC_BASICS_CARDS, AGENTIC_FAQ } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';

export default function AgenticCommercePage() {
	return (
		<div>
			<PageMeta
				title="Agentic commerce"
				description="What AI shopping assistants are, what makes a store agent-ready, and how every Estori store will get it."
			/>
			<SolutionHero
				eyebrow="Agentic commerce"
				tag="agentic-commerce"
				title="Ready for shoppers who ask AI"
				lead="AI assistants are starting to search, compare and buy on shoppers' behalf. Every Estori store will be ready for them, with nothing to set up."
			/>
			<CardSection eyebrow="The basics" title="What agentic commerce is" cards={AGENTIC_BASICS_CARDS} />
			<CardSection eyebrow="Agent-ready" title="What a store needs" cards={AGENT_READY_CARDS} />
			<CardSection
				eyebrow="On Estori"
				tag="agentic-commerce"
				title="Built into every Estori store"
				lead="Estori runs your store's code, hosting and checkout, so it can add the standards to every store at once. No apps to install and no feeds to maintain by hand."
				cards={[]}
			/>
			<PublicFaq items={AGENTIC_FAQ} />
			<ClosingPanel />
		</div>
	);
}
