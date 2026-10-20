import { Link } from 'react-router';
import { LayerCard, buttonVariants } from '@cloudflare/kumo';
import { CreditCardIcon } from '@phosphor-icons/react';
import type { CardOnFile } from '@/api-types';
import { cardLabelFor } from '@/routes/settings/billing-view';
import { CARD_PATH } from '@/routes/settings/card-state';
import { SectionTitle } from './SectionTitle';

/** The card the plan renews on, and the way to change it. */
export function PaymentMethodCard({ card }: { card: CardOnFile | null }) {
	return (
		<LayerCard id="payment-method" className="scroll-mt-4">
			<SectionTitle icon={<CreditCardIcon className="size-4" aria-hidden />}>Payment method</SectionTitle>
			<LayerCard.Primary>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<p className="text-sm text-kumo-default">{card ? cardLabelFor(card) : 'No card on file.'}</p>
					<Link to={CARD_PATH} className={buttonVariants({ variant: 'secondary' })}>
						{card ? 'Change card' : 'Add card'}
					</Link>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}
