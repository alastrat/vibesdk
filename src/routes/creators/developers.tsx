import { publicTranslator } from '@/lib/i18n/public-pricing';
import { t } from '@/lib/i18n';
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { developerFaq, DEVELOPER_STEPS } from '@/content/positioning';
import { DEVELOPERS_PAGE } from '@/content/public-pages';
import { ClosingPanel } from '@/routes/landing/sections';
import { TemplateEarnings } from './TemplateEarnings';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

export default function DevelopersPage() {
	return (
		<div>
			<PageMeta {...DEVELOPERS_PAGE} />
			<SolutionHero
				eyebrow={t("For developers")}
				title={t("Design a store once. Earn every time it's used.")}
				lead={t("Build stores with Estori, publish them to Discover as templates, and get paid through Stripe when someone starts from yours.")}
				actions={
					<>
						<StartBuildingButton variant="white" />
						<PillLink to="/discover" variant="outline-on-dark">{t("Browse Discover")}</PillLink>
					</>
				}
			/>
			<TemplateEarnings />
			<HowItWorks steps={DEVELOPER_STEPS} />
			<PublicFaq items={developerFaq(publicTranslator())} />
			<ClosingPanel />
		</div>
	);
}
