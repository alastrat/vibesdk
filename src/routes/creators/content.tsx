import { t } from '@/lib/i18n';
import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { CONTENT_CREATOR_CARDS, CONTENT_FAQ, CONTENT_STEPS } from '@/content/positioning';
import { CONTENT_CREATORS_PAGE } from '@/content/public-pages';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

export default function ContentCreatorsPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta {...CONTENT_CREATORS_PAGE} />
			<SolutionHero
				eyebrow={t("For content creators")}
				tag="content-creators"
				title={t("Get paid for the products you recommend")}
				lead={t("Promote merchants' products with your own link or your own Estori store, and earn a commission on every sale you bring.")}
				actions={
					<>
						<StartBuildingButton variant="white" />
						<EarlyAccessButton capability="content-creators" variant="outline-on-dark" listedClassName="text-white" />
					</>
				}
			/>
			<CardSection eyebrow={t("How you earn")} tag="content-creators" title={t("Your audience, your recommendations")} cards={CONTENT_CREATOR_CARDS}>
				<EarlyAccessButton capability="content-creators" listedClassName="text-public-ink" />
			</CardSection>
			<HowItWorks steps={CONTENT_STEPS} />
			<PublicFaq items={CONTENT_FAQ} />
			<ClosingPanel />
		</div>
	);
}
