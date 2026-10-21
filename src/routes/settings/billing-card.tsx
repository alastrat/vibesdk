import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Banner, Button, LayerCard, Loader } from '@cloudflare/kumo';
import { CreditCardIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { BackToBilling } from '@/components/billing/BackToBilling';
import { SectionTitle } from '@/components/billing/SectionTitle';
import { Stopped } from '@/components/billing/Stopped';
import { useBillingCard } from '@/hooks/use-billing-card';
import { CARD_EXPIRED_MESSAGE, canSaveNow, cardModeOf, saveLabelFor } from './card-state';

const SAVE_NOTE = 'The new card replaces your current one for your next renewal.';
const PAY_NOTE = 'The new card replaces your current one, and pays your failed renewal now.';

/**
 * Settings, Plan and billing, Card: Stripe's card form in a setup session, to change the card a plan renews on. With
 * `?mode=pay` saving the card also pays the failed renewal with it. The card form stays in Stripe's frame; saving sends
 * the seller to the return route, which makes the card the default.
 */
export default function BillingCardPage() {
	const location = useLocation();
	const mode = cardModeOf(location.search);
	const card = useBillingCard(mode);
	const { state } = card;

	// A stopped page carries its own way back, so the header's isn't repeated.
	const stopped = state.phase.name === 'expired' || state.phase.name === 'refused';
	let body: ReactNode;
	if (state.phase.name === 'expired') {
		body = <Stopped message={CARD_EXPIRED_MESSAGE} action={{ label: 'Start again', onClick: card.restart }} />;
	} else if (state.phase.name === 'refused') {
		body = <Stopped message={state.phase.message} action={state.phase.retryable ? { label: 'Try again', onClick: card.restart } : null} />;
	} else {
		body = (
			<LayerCard>
				<SectionTitle icon={<CreditCardIcon className="size-4" aria-hidden />}>New card</SectionTitle>
				<LayerCard.Primary>
					<div className="grid gap-4">
						<div className="relative min-h-40" aria-busy={!state.formReady}>
							<div ref={card.container} />
							{!state.formReady && (
								<div className="absolute inset-0 flex items-center justify-center">
									<Loader />
								</div>
							)}
						</div>
						{state.notice && <Banner variant="alert" icon={<WarningCircleIcon />} description={state.notice} />}
						<p className="text-xs text-kumo-subtle">{mode === 'pay' ? PAY_NOTE : SAVE_NOTE}</p>
						<Button variant="primary" className="w-full justify-center" loading={state.saving} disabled={!canSaveNow(state)} onClick={() => void card.save()}>
							{saveLabelFor(mode)}
						</Button>
					</div>
				</LayerCard.Primary>
			</LayerCard>
		);
	}

	return (
		<div className="size-full">
			<title>{pageTitle(mode === 'pay' ? 'Update card and pay' : 'Change card')}</title>
			<div className="container mx-auto grid max-w-xl gap-6 px-4 py-8">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<h1 className="text-3xl font-semibold text-kumo-strong">{mode === 'pay' ? 'Update card and pay' : 'Change card'}</h1>
					{!stopped && <BackToBilling />}
				</div>
				{body}
			</div>
		</div>
	);
}
