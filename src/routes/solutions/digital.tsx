import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { COMMUNITY_CARDS, DIGITAL_FAQ, DIGITAL_PRODUCT_CARDS, DIGITAL_STEPS } from '@/content/positioning';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';

export default function DigitalPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta
				title="For digital businesses"
				description="Sell e-books, images and videos and run a community from your Estori store. In early access."
			/>
			<SolutionHero
				eyebrow="For digital businesses"
				title="Sell digital products and build a community around them"
				lead="Sell e-books, images, videos and other downloads from your own store, and give your customers a place to gather."
				tag="digital-products"
				actions={
					<>
						<PillLink to="/signup" variant="white">
							Start building free
						</PillLink>
						<EarlyAccessButton capability="digital-products" variant="outline-on-dark" listedClassName="text-white" />
					</>
				}
			/>
			<CardSection eyebrow="Digital products" tag="digital-products" title="Sell what you make, delivered as files" cards={DIGITAL_PRODUCT_CARDS} />
			<CardSection eyebrow="Community" tag="digital-products" title="A place for your customers" cards={COMMUNITY_CARDS}>
				<EarlyAccessButton capability="digital-products" listedClassName="text-public-ink" />
			</CardSection>
			<HowItWorks steps={DIGITAL_STEPS} />
			<PublicFaq items={DIGITAL_FAQ} />
			<ClosingPanel />
		</div>
	);
}
