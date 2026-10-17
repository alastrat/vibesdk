import { Calculator } from '@/components/pricing/Calculator';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { PRICING_FAQ } from '@/content/positioning';
import { PRICING_CALCULATOR_PAGE } from '@/content/public-pages';

export default function PricingCalculatorPage() {
	return (
		<div>
			<PageMeta {...PRICING_CALCULATOR_PAGE} />
			<Calculator />
			<PublicFaq items={PRICING_FAQ} />
		</div>
	);
}
