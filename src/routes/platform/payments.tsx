import { t } from '@/lib/i18n';
import { formatUsd, publicTranslator } from '@/lib/i18n/public-pricing';
import { DEFAULT_SELLER_LIMITS } from '@/api-types';
import { marketingCopy } from '@/content/marketing-copy';
import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { CardSection } from '@/components/public-site/solution-page';
import type { CardCopy } from '@/content/positioning';
import { PAYMENTS_PAGE } from '@/content/public-pages';
import { levelUpRule, paymentsCopy } from '@/content/solution-pages';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';

export default function PaymentsPage() {
 const copy = paymentsCopy(publicTranslator());
 const levelCards: readonly CardCopy[] = [
  ...(['new', 'established'] as const).map((id) => {
   const level = DEFAULT_SELLER_LIMITS.levels[id];
   return { title: id === 'new' ? t('New sellers') : t('Established sellers'), body: t('Orders up to {order}, up to {weekly} in sales a week, and payouts {days} business days after each sale.', { order: formatUsd(level.largestOrderCents), weekly: formatUsd(level.weeklySalesCents), days: level.payoutDelayDays }) };
  }),
  { title: t('Moving up'), body: t('You become an established seller after {rule}. Estori checks after every sale.', { rule: levelUpRule(publicTranslator()) }) },
 ];
	return (
		<SolutionCopyPage head={PAYMENTS_PAGE} copy={copy}>
			<CardSection
				id="orders"
				tag="order-management"
				eyebrow={t(marketingCopy.platform.orders.eyebrow)}
				title={t(marketingCopy.platform.orders.title)}
				lead={t(marketingCopy.platform.orders.description)}
				cards={marketingCopy.platform.orders.cards}
			/>
			<CardSection
				id="limits"
				eyebrow={t("Estori selling safeguards")}
				tag={copy.capability}
				title={t("Selling limits that grow with your store")}
				lead={t('Estori sets order limits, weekly sales limits and payout waits to manage selling risk while a store builds its record. These are Estori safeguards, separate from Stripe’s technical payment limits. Your seller level sets them, not your plan. {weighting}', { weighting: t(OWN_PRODUCTS_WEIGHTING) })}
				cards={levelCards}
			>
				<p className="max-w-3xl text-sm leading-relaxed text-public-muted">
					{t(marketingCopy.platform.payments.stripeLimitNote)}{' '}
					<a href="https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-public-blue">{t(marketingCopy.platform.payments.stripeLimitSource)} →</a>
				</p>
			</CardSection>
		</SolutionCopyPage>
	);
}
