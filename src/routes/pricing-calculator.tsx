import { Calculator } from '@/components/pricing/Calculator';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { PRICING_FAQ } from '@/content/positioning';

export default function PricingCalculatorPage() {
	return (
		<div>
			<PageMeta
				title="Credits calculator"
				description="Tell us how many stores you'll run and how you'll use the AI, and we'll estimate your monthly credits and recommend a plan."
			/>
			<Calculator />
			<PublicFaq items={PRICING_FAQ} />
		</div>
	);
}
