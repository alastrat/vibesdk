import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Banner, Button, Input, LayerCard, Loader } from '@cloudflare/kumo';
import { CreditCardIcon, ReceiptIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
	CHECKOUT_EXPIRED_MESSAGE,
	EXTRA_CREDITS_DISCLOSURE,
	extraCreditsPriceCents,
	formatCredits,
	formatUsd,
	planName,
	renewalDisclosure,
	type CheckoutOrder,
} from '@/api-types';
import { pageTitle } from '@/brand';
import { BackToBilling } from '@/components/billing/BackToBilling';
import { CreditsStepper } from '@/components/billing/CreditsStepper';
import { SectionTitle } from '@/components/billing/SectionTitle';
import { Stopped } from '@/components/billing/Stopped';
import { Checkbox } from '@/components/ui/checkbox';
import { useBillingCheckout } from '@/hooks/use-billing-checkout';
import { EXTRA_CREDITS_PRICE } from '@/lib/plans';
import { canPayNow, checkoutExpiredOf, checkoutPathOf, checkoutRequestOf, consentPartsOf, dueTodayLabel, type CheckoutRequest, type CheckoutState } from './checkout-state';

/** How long the amount of credits holds still before a new session is opened for it. */
const CREDITS_SETTLE_MS = 500;

const TERMS_LINK_CLASS = 'underline hover:text-kumo-strong';

function DueToday({ label }: { label: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 rounded-lg bg-kumo-elevated px-3 py-2 text-sm">
			<span className="text-kumo-subtle">Due today</span>
			<span className="text-lg font-medium text-kumo-default">{label}</span>
		</div>
	);
}

function ApplyCode({ busy, disabled, error, onApply }: { busy: boolean; disabled: boolean; error: string | null; onApply: (code: string) => void }) {
	const [draft, setDraft] = useState('');
	return (
		<form
			className="grid gap-1.5"
			onSubmit={(event) => {
				event.preventDefault();
				onApply(draft);
			}}
		>
			<div className="flex items-center gap-2">
				<Input aria-label="Promotion code" placeholder="Promotion code" value={draft} disabled={disabled || busy} onChange={(event) => setDraft(event.target.value)} className="w-full" />
				<Button type="submit" variant="secondary" loading={busy} disabled={disabled || draft.trim() === ''}>
					Apply
				</Button>
			</div>
			{error && <p className="text-xs text-kumo-danger">{error}</p>}
		</form>
	);
}

function PromotionCode({ state, onApply, onRemove }: { state: CheckoutState; onApply: (code: string) => void; onRemove: () => void }) {
	const { code, paying } = state;
	if (code.applied === null) return <ApplyCode busy={code.busy} disabled={paying} error={code.error} onApply={onApply} />;
	return (
		<div className="grid gap-1.5">
			<div className="flex items-center justify-between gap-2 text-sm">
				<p className="text-kumo-default">Code {code.applied} applied</p>
				<Button variant="secondary" size="sm" loading={code.busy} disabled={paying} onClick={onRemove}>
					Remove
				</Button>
			</div>
			{code.error && <p className="text-xs text-kumo-danger">{code.error}</p>}
		</div>
	);
}

function PlanOrder({ order, state, onApply, onRemove }: { order: Extract<CheckoutOrder, { kind: 'plan' }>; state: CheckoutState; onApply: (code: string) => void; onRemove: () => void }) {
	const dueCents = state.terms?.status === 'ready' ? state.terms.view.dueTodayCents : order.priceCents;
	return (
		<div className="grid gap-4">
			<div className="grid gap-1">
				<h2 className="text-2xl font-semibold text-kumo-strong">Estori {planName(order.plan)}</h2>
				<p className="text-lg text-kumo-default">
					{formatUsd(order.priceCents)}
					<span className="text-sm text-kumo-subtle"> a month</span>
				</p>
			</div>
			<ul className="grid gap-1.5 text-sm text-kumo-subtle">
				{order.includes.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
			<DueToday label={dueTodayLabel(state.dueToday, dueCents)} />
			<PromotionCode state={state} onApply={onApply} onRemove={onRemove} />
		</div>
	);
}

function CreditsOrder({
	credits,
	amountCents,
	dueToday,
	changing,
	disabled,
	onChange,
}: {
	credits: number;
	amountCents: number;
	dueToday: string | null;
	changing: boolean;
	disabled: boolean;
	onChange: (credits: number) => void;
}) {
	return (
		<div className="grid gap-4">
			<div className="grid gap-1">
				<h2 className="text-2xl font-semibold text-kumo-strong">Extra AI credits</h2>
				<p className="text-sm text-kumo-subtle">{EXTRA_CREDITS_PRICE}</p>
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<CreditsStepper value={credits} onChange={onChange} disabled={disabled} />
				<p className="text-sm text-kumo-subtle">{formatCredits(credits)} credits</p>
			</div>
			<DueToday label={changing ? formatUsd(amountCents) : dueTodayLabel(dueToday, amountCents)} />
			<p className="text-xs text-kumo-subtle">{EXTRA_CREDITS_DISCLOSURE}</p>
		</div>
	);
}

function ConsentText({ text }: { text: string }) {
	const { before, link, after } = consentPartsOf(text);
	return (
		<span>
			{before}
			{link && (
				<a href="/terms" target="_blank" rel="noopener noreferrer" className={TERMS_LINK_CLASS}>
					{link}
				</a>
			)}
			{after}
		</span>
	);
}

function ConsentRow({ state, onToggle, onRetry }: { state: CheckoutState; onToggle: (consented: boolean) => void; onRetry: () => void }) {
	const { terms } = state;
	if (terms === null) return null;
	return (
		<div className="grid gap-1.5">
			<label className="flex items-start gap-2 text-sm text-kumo-default">
				<Checkbox
					checked={state.consented}
					disabled={terms.status !== 'ready' || state.paying || state.code.busy}
					onCheckedChange={(checked) => onToggle(checked === true)}
					className="mt-0.5"
				/>
				{terms.status === 'ready' && <ConsentText text={terms.view.consentText} />}
				{terms.status === 'loading' && <span className="text-kumo-subtle">Checking the price…</span>}
				{terms.status === 'failed' && <span>Couldn't check the price.</span>}
			</label>
			{terms.status === 'failed' && (
				<div>
					<Button variant="secondary" size="sm" onClick={onRetry}>
						Try again
					</Button>
				</div>
			)}
		</div>
	);
}

/** The pay button's words: the server's for a plan, and the amount for credits. */
function payLabel(request: CheckoutRequest, state: CheckoutState, creditsCents: number): string {
	if (request.kind === 'credits') return `Pay ${formatUsd(creditsCents)}`;
	if (state.terms?.status === 'ready') return state.terms.view.buttonText;
	return state.terms?.status === 'loading' ? 'Checking the price…' : 'Subscribe';
}

/**
 * Settings, Plan and billing, Checkout: the order on the left and Stripe's card form on the right, for a plan
 * (`?plan=`) or an amount of extra credits (`?credits=`). The card form stays in Stripe's frame; the wording the
 * seller agrees to is the server's for the session.
 */
export default function BillingCheckoutPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const request = useMemo(() => checkoutRequestOf(location.search), [location.search]);
	const checkout = useBillingCheckout(request, checkoutExpiredOf(location.search));
	const { state } = checkout;
	const [pendingCredits, setPendingCredits] = useState<number | null>(null);

	// An amount that keeps changing opens one new session once it settles, not one per click.
	useEffect(() => {
		if (pendingCredits === null) return;
		const timer = window.setTimeout(() => {
			setPendingCredits(null);
			navigate(checkoutPathOf({ kind: 'credits', credits: pendingCredits }), { replace: true });
		}, CREDITS_SETTLE_MS);
		return () => window.clearTimeout(timer);
	}, [pendingCredits, navigate]);

	const credits = request?.kind === 'credits' ? (pendingCredits ?? request.credits) : null;
	const changing = pendingCredits !== null;
	const creditsCents = state.order?.kind === 'credits' && !changing ? state.order.amountCents : extraCreditsPriceCents(credits ?? 0);

	// A stopped checkout carries its own way back, so the header's isn't repeated.
	const stopped = request === null || state.phase.name === 'expired' || state.phase.name === 'refused';
	let body: ReactNode;
	if (request === null) {
		body = <Stopped message="Choose a plan, or an amount of extra credits, on the billing page." action={null} />;
	} else if (state.phase.name === 'expired') {
		body = <Stopped message={CHECKOUT_EXPIRED_MESSAGE} action={{ label: 'Start again', onClick: checkout.restart }} />;
	} else if (state.phase.name === 'refused') {
		body = <Stopped message={state.phase.message} action={state.phase.retryable ? { label: 'Try again', onClick: checkout.restart } : null} />;
	} else {
		body = (
			<div className="grid gap-6 md:grid-cols-5">
				<div className="md:col-span-2">
					<LayerCard>
						<SectionTitle icon={<ReceiptIcon className="size-4" aria-hidden />}>Your order</SectionTitle>
						<LayerCard.Primary>
							{credits !== null ? (
								<CreditsOrder
									credits={credits}
									amountCents={creditsCents}
									dueToday={state.dueToday}
									changing={changing}
									disabled={state.paying}
									onChange={setPendingCredits}
								/>
							) : state.order?.kind === 'plan' ? (
								<PlanOrder order={state.order} state={state} onApply={checkout.applyCode} onRemove={checkout.removeCode} />
							) : (
								<div className="flex justify-center py-8">
									<Loader />
								</div>
							)}
						</LayerCard.Primary>
					</LayerCard>
				</div>
				<div className="md:col-span-3">
					<LayerCard>
						<SectionTitle icon={<CreditCardIcon className="size-4" aria-hidden />}>Payment</SectionTitle>
						<LayerCard.Primary>
							<div className="grid gap-4">
								<div className="relative min-h-40" aria-busy={!state.formReady}>
									<div ref={checkout.container} />
									{!state.formReady && (
										<div className="absolute inset-0 flex items-center justify-center">
											<Loader />
										</div>
									)}
								</div>
								{state.notice && <Banner variant="alert" icon={<WarningCircleIcon />} description={state.notice} />}
								<ConsentRow state={state} onToggle={checkout.toggleConsent} onRetry={checkout.retryTerms} />
								<p className="text-xs text-kumo-subtle">{state.order?.kind === 'plan' ? renewalDisclosure(state.order.plan) : EXTRA_CREDITS_DISCLOSURE}</p>
								<Button variant="primary" className="w-full justify-center" loading={state.paying} disabled={!canPayNow(state) || changing} onClick={() => void checkout.pay()}>
									{payLabel(request, state, creditsCents)}
								</Button>
							</div>
						</LayerCard.Primary>
					</LayerCard>
				</div>
			</div>
		);
	}

	return (
		<div className="size-full">
			<title>{pageTitle('Checkout')}</title>
			<div className="container mx-auto grid max-w-5xl gap-6 px-4 py-8">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<h1 className="text-3xl font-semibold text-kumo-strong">Checkout</h1>
					{!stopped && <BackToBilling />}
				</div>
				{body}
			</div>
		</div>
	);
}
