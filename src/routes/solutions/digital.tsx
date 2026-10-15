import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { COMMUNITY_CARDS, DIGITAL_FAQ, DIGITAL_PRODUCT_CARDS, DIGITAL_STEPS } from '@/content/positioning';
import { DIGITAL_PAGE } from '@/content/public-pages';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

export default function DigitalPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta {...DIGITAL_PAGE} />
			<SolutionHero
				eyebrow="For digital businesses"
				title="Sell digital products and build a community around them"
				lead="Sell e-books, images, videos and other downloads from your own store, and give your customers a place to gather."
				tag="digital-products"
				actions={
					<>
						<StartBuildingButton variant="white" />
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
