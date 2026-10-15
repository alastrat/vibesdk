import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { DEVELOPER_FAQ, DEVELOPER_STEPS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';
import { TemplateEarnings } from './TemplateEarnings';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

export default function DevelopersPage() {
	return (
		<div>
			<PageMeta title="For developers" description="Build stores with Estori, publish them to Discover as templates, and get paid through Stripe." />
			<SolutionHero
				eyebrow="For developers"
				title="Design a store once. Earn every time it's used."
				lead="Build stores with Estori, publish them to Discover as templates, and get paid through Stripe when someone starts from yours."
				actions={
					<>
						<StartBuildingButton variant="white" />
						<PillLink to="/discover" variant="outline-on-dark">
							Browse Discover
						</PillLink>
					</>
				}
			/>
			<TemplateEarnings />
			<HowItWorks steps={DEVELOPER_STEPS} />
			<PublicFaq items={DEVELOPER_FAQ} />
			<ClosingPanel />
		</div>
	);
}
