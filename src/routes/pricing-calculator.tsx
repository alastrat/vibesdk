import { Calculator } from '@/components/pricing/Calculator';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { pricingFaq } from '@/content/positioning';
import { PRICING_CALCULATOR_PAGE } from '@/content/public-pages';
import { useBillingOn } from '@/hooks/use-billing';
import { useModelRates } from '@/hooks/use-model-rates';

export default function PricingCalculatorPage() {
	const billing = useBillingOn();
	const { rates } = useModelRates();
	return (
		<div>
			<PageMeta {...PRICING_CALCULATOR_PAGE} />
			<Calculator />
			<PublicFaq items={pricingFaq(billing, rates)} />
		</div>
	);
}
