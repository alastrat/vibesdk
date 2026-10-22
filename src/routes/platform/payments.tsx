import { marketingCopy } from '@/content/marketing-copy';
import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { CardSection } from '@/components/public-site/solution-page';
import type { CardCopy } from '@/content/positioning';
import { PAYMENTS_PAGE } from '@/content/public-pages';
import { LEVEL_UP_RULE, PAYMENTS_COPY } from '@/content/solution-pages';
import { OWN_PRODUCTS_WEIGHTING, SELLER_LEVEL_LIMITS } from '@/lib/plans';

const LEVEL_CARDS: readonly CardCopy[] = [
	...SELLER_LEVEL_LIMITS.map((level) => ({
		title: level.level,
		body: `Orders up to ${level.largestOrder}, up to ${level.weeklySales} in sales a week, and payouts ${level.payoutWait} after each sale.`,
	})),
	{ title: 'Moving up', body: `You become an established seller after ${LEVEL_UP_RULE}. Estori checks after every sale.` },
];

export default function PaymentsPage() {
	return (
		<SolutionCopyPage head={PAYMENTS_PAGE} copy={PAYMENTS_COPY}>
			<CardSection
				id="orders"
				tag="order-management"
				eyebrow={marketingCopy.platform.orders.eyebrow}
				title={marketingCopy.platform.orders.title}
				lead={marketingCopy.platform.orders.description}
				cards={marketingCopy.platform.orders.cards}
			/>
			<CardSection
				id="limits"
				eyebrow="Estori selling safeguards"
				tag={PAYMENTS_COPY.capability}
				title="Selling limits that grow with your store"
				lead={`Estori sets order limits, weekly sales limits and payout waits to manage selling risk while a store builds its record. These are Estori safeguards, separate from Stripe’s technical payment limits. Your seller level sets them, not your plan. ${OWN_PRODUCTS_WEIGHTING}`}
				cards={LEVEL_CARDS}
			>
				<p className="max-w-3xl text-sm leading-relaxed text-public-muted">
					{marketingCopy.platform.payments.stripeLimitNote}{' '}
					<a href="https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-public-blue">{marketingCopy.platform.payments.stripeLimitSource} →</a>
				</p>
			</CardSection>
		</SolutionCopyPage>
	);
}
