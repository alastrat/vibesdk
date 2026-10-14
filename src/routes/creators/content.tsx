import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { CONTENT_CREATOR_CARDS, CONTENT_FAQ, CONTENT_STEPS } from '@/content/positioning';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';

export default function ContentCreatorsPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta
				title="For content creators"
				description="Get paid for the products you recommend, with your own link or your own Estori store. In early access."
			/>
			<SolutionHero
				eyebrow="For content creators"
				tag="content-creators"
				title="Get paid for the products you recommend"
				lead="Promote merchants' products with your own link or your own Estori store, and earn a commission on every sale you bring."
				actions={
					<>
						<PillLink to="/#build" variant="white">
							Start building free
						</PillLink>
						<EarlyAccessButton capability="content-creators" variant="outline-on-dark" listedClassName="text-white" />
					</>
				}
			/>
			<CardSection eyebrow="How you earn" tag="content-creators" title="Your audience, your recommendations" cards={CONTENT_CREATOR_CARDS}>
				<EarlyAccessButton capability="content-creators" listedClassName="text-public-ink" />
			</CardSection>
			<HowItWorks steps={CONTENT_STEPS} />
			<PublicFaq items={CONTENT_FAQ} />
			<ClosingPanel />
		</div>
	);
}
