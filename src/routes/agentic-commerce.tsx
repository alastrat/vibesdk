import { t } from '@/lib/i18n';
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
				eyebrow={t("Get found by AI assistants")}
				tag="agentic-commerce"
				title={t("Get recommended when shoppers ask AI")}
				lead={t("More shoppers now ask AI assistants what to buy. Every Estori store will be ready to be found and recommended by them, with nothing for you to set up.")}
			/>
			<CardSection eyebrow={t("The basics")} title={t("How it works")} cards={AGENTIC_BASICS_CARDS} />
			<CardSection eyebrow={t("Ready for AI assistants")} title={t("What your store will have")} cards={AGENT_READY_CARDS} />
			<CardSection
				eyebrow={t("On Estori")}
				tag="agentic-commerce"
				title={t("Built into every Estori store")}
				lead={t("Estori runs your store's code, hosting and checkout, so it can add this to every store at once. No apps to install and nothing to maintain by hand.")}
				cards={[]}
			/>
			<PublicFaq items={AGENTIC_FAQ} />
			<ClosingPanel />
		</div>
	);
}
