import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { CardSection } from '@/components/public-site/solution-page';
import type { CardCopy } from '@/content/positioning';
import { PAYMENTS_PAGE } from '@/content/public-pages';
import { LEVEL_UP_RULE, PAYMENTS_COPY } from '@/content/solution-pages';
import { SELLER_LEVEL_LIMITS } from '@/lib/plans';

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
				eyebrow="Limits"
				tag={PAYMENTS_COPY.capability}
				title="Limits that grow with your store"
				lead="Every store starts with lower limits and a longer wait before payouts, which protects shoppers while a store builds its record. Your seller level sets them, not your plan."
				cards={LEVEL_CARDS}
			/>
		</SolutionCopyPage>
	);
}
