import { checkoutRequestOf } from './checkout-state';
import { requestedBillingInterval } from '@/lib/billing-links';
import { BillingIntervalPicker } from '@/components/billing/BillingIntervalPicker';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Badge, Banner, Button, Empty, LayerCard, Loader, Meter, buttonVariants } from '@cloudflare/kumo';
import { CheckCircleIcon, CoinsIcon, InfoIcon, SpinnerGapIcon, StackPlusIcon, StorefrontIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
	BILLING_NOT_OPEN_MESSAGE,
	EXTRA_CREDITS,
	EXTRA_CREDITS_DISCLOSURE,
	PLAN_LIMITS,
	planPriceCents,
	creditsForPlanChange,
	type BillingInterval,
	extraCreditsPriceCents,
	formatBillingDate,
	formatCredits,
	formatUsd,
	planName,
	type BillingView,
	type PaidPlanId,
} from '@/api-types';
import { pageTitle } from '@/brand';
import { BillingHistory } from '@/components/billing/BillingHistory';
import { CreditsStepper } from '@/components/billing/CreditsStepper';
import { PaymentMethodCard } from '@/components/billing/PaymentMethodCard';
import { SectionTitle } from '@/components/billing/SectionTitle';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CHANGE_FAILED_MESSAGE, showBillingError, useBilling, useBuyCredits, usePayNow, usePlanChange, usePlanCheckout, type PlanChange } from '@/hooks/use-billing';
import { extraCreditsPriceLabel, limitFeatures } from '@/lib/plans';
import { getLocale, msg, t, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
	configurationConfirmation,
	configurationMatches,
	type PlanConfiguration,
	CONFIRM_POLL_MS,
	CONFIRM_TIMEOUT_MS,
	canCancel,
	checkoutBaselineOf,
	checkoutReturnOf,
	confirmationFor,
	creditsSummaryFor,
	describePaymentResult,
	isConfirmed,
	isRenewalPaid,
	pastDueActionsFor,
	paymentNoteFor,
	planChoicesFor,
	planStatusFor,
	purchaseLineFor,
	readCheckoutBaseline,
	renewalLineFor,
	requestedPlanOf,
	showsChange,
	type CheckoutBaseline,
	type Confirmation,
	type ConfirmedAction,
	type PastDueActions,
	type PlanAction,
	type PlanChoice,
} from './billing-view';

const CHANGE_REQUESTED = msg('Done. It can take a few seconds to show here.');
const CHANGE_SLOW = msg('Your change is taking longer than usual to show. Refresh in a minute.');
const RENEWAL_SLOW = msg('Your payment went through. It can take a few seconds to show here. Refresh in a minute.');

/** Amounts and dates written the way the language writes them. */
const creditsText = (count: number): string => formatCredits(count, getLocale());
const usdText = (cents: number): string => formatUsd(cents, getLocale());
const dateText = (ms: number): string => formatBillingDate(ms, getLocale());

/** What the page polls for: a payment back from checkout, a failed renewal that was paid, or a change taken on this page. */
type Waiting = { kind: 'payment'; paid: 'plan' | 'credits' } | { kind: 'renewal' } | { kind: 'change'; action: PlanAction } | { kind: 'configuration'; target: PlanConfiguration };

/** What each confirmed action asks Stripe for. */
const CONFIRMED_CHANGES: Record<ConfirmedAction, PlanChange> = {
	upgrade: { kind: 'change', plan: 'premium' },
	downgrade: { kind: 'change', plan: 'pro' },
	cancel: { kind: 'cancel' },
};

/** Sections the address can scroll to: the Upgrade dialog links to the credits, and the billing emails to the history. */
const SCROLL_ANCHORS: readonly string[] = ['#extra-credits', '#history'];

/** Where the page keeps the view from before a credits checkout, so the return can tell the purchase landed. */
const BASELINE_KEY = 'billing:checkout-baseline';

function keepBaseline(baseline: CheckoutBaseline): void {
	try {
		sessionStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
	} catch {
		// Without storage the return compares against the first view it loads.
	}
}

function recallBaseline(): string | null {
	try {
		return sessionStorage.getItem(BASELINE_KEY);
	} catch {
		return null;
	}
}

function forgetBaseline(): void {
	try {
		sessionStorage.removeItem(BASELINE_KEY);
	} catch {
		// Nothing was kept.
	}
}

/** The two ways out of a failed renewal: pay with the card on file, or save another card and pay with it. */
function PastDueButtons({ actions, paying, disabled, onPayNow }: { actions: PastDueActions; paying: boolean; disabled: boolean; onPayNow: () => void }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{actions.payNow && (
				<Button variant="primary" loading={paying} disabled={disabled && !paying} onClick={onPayNow}>
					{actions.payNow}
				</Button>
			)}
			<Link to={actions.updateCard.to} className={buttonVariants({ variant: actions.payNow ? 'secondary' : 'primary' })}>
				{actions.updateCard.label}
			</Link>
		</div>
	);
}

function CurrentPlan({
	view,
	paying,
	disabled,
	declined,
	onCancel,
	onPayNow,
	onChangeInterval,
}: {
	view: BillingView;
	paying: boolean;
	disabled: boolean;
	declined: string | null;
	onCancel: () => void;
	onPayNow: () => void;
	onChangeInterval: () => void;
}) {
	const paymentNote = paymentNoteFor(view);
	const pastDue = pastDueActionsFor(view);
	const renewal = renewalLineFor(view);
	return (
		<LayerCard>
			<SectionTitle icon={<StorefrontIcon className="size-4" aria-hidden />}>{t('Your plan')}</SectionTitle>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div className="grid gap-1">
							<div className="flex flex-wrap items-center gap-2">
								<h2 className="text-2xl font-semibold text-kumo-strong">{planName(view.plan)}</h2>
								<Badge variant={view.paymentFailing ? 'warning' : 'secondary'}>{planStatusFor(view)}</Badge>
							</div>
							{renewal && <p className="text-sm text-kumo-subtle">{renewal}</p>}
						</div>
						<div className="flex flex-wrap gap-2">
							{canCancel(view) && view.pendingPlan === null && !view.paymentFailing && (
								<Button variant="secondary" disabled={disabled} onClick={onChangeInterval}>
									{view.billingInterval === 'year' ? t('Switch to monthly') : t('Switch to yearly')}
								</Button>
							)}
							{canCancel(view) && (
								<Button variant="secondary-destructive" onClick={onCancel}>
									{t('Cancel plan')}
								</Button>
							)}
						</div>
					</div>
					{paymentNote && <Banner variant="alert" icon={<WarningCircleIcon />} description={paymentNote} />}
					{pastDue && <PastDueButtons actions={pastDue} paying={paying} disabled={disabled} onPayNow={onPayNow} />}
					{declined && <Banner variant="error" icon={<WarningCircleIcon />} description={declined} />}
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

function ChoiceControl({ choice, busy, disabled, onAct }: { choice: PlanChoice; busy: boolean; disabled: boolean; onAct: () => void }) {
	switch (choice.action) {
		case 'current':
			return (
				<p className="inline-flex items-center gap-1.5 text-sm font-medium text-kumo-default">
					<CheckCircleIcon weight="fill" className="size-4 text-kumo-brand" aria-hidden />
					{choice.label}
				</p>
			);
		case 'none':
			return <p className="text-sm text-kumo-subtle">{choice.label}</p>;
		default:
			return (
				<Button
					variant={choice.action === 'checkout' || choice.action === 'upgrade' ? 'primary' : 'secondary'}
					loading={busy}
					disabled={disabled && !busy}
					onClick={onAct}
					className="w-full justify-center"
				>
					{choice.label}
				</Button>
			);
	}
}

function PlanOption({
	choice,
	current,
	busy,
	disabled,
	onAct,
	interval,
	monthlyCredits,
}: {
	interval: BillingInterval;
	monthlyCredits: number;
	choice: PlanChoice;
	current: boolean;
	busy: boolean;
	disabled: boolean;
	onAct: () => void;
}) {
	const i18n = useI18n();
	return (
		<div className={cn('flex flex-col gap-4 rounded-xl bg-kumo-base p-5 ring', current ? 'ring-2 ring-kumo-brand' : 'ring-kumo-line')}>
			<div className="grid gap-1">
				<h3 className="text-lg font-medium text-kumo-strong">{planName(choice.plan)}</h3>
				<p className="text-2xl text-kumo-default">
					{usdText(planPriceCents(choice.plan, interval, monthlyCredits))}
					<span className="text-sm text-kumo-subtle"> {interval === 'year' ? t('a year') : t('a month')}</span>
				</p>
			</div>
			<ul className="grid gap-1.5 text-sm text-kumo-subtle">
				<li>{t('{credits} AI credits a month', { credits: creditsText(monthlyCredits) })}</li>
				{limitFeatures(choice.plan, undefined, i18n).map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
			<div className="mt-auto grid gap-1.5">
				<ChoiceControl choice={choice} busy={busy} disabled={disabled} onAct={onAct} />
				{choice.note && <p className="text-xs text-kumo-subtle">{choice.note}</p>}
			</div>
		</div>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 rounded-lg bg-kumo-elevated px-3 py-2">
			<dt className="text-kumo-subtle">{label}</dt>
			<dd className="font-medium text-kumo-default">{value}</dd>
		</div>
	);
}

/** This period's credits: the monthly pool and Estori's grants, what's used, extra credits left and when they renew. */
function Credits({ view }: { view: BillingView }) {
	const { credits } = view;
	const summary = creditsSummaryFor(view);
	if (!credits || !summary) return null;
	return (
		<LayerCard>
			<SectionTitle icon={<CoinsIcon className="size-4" aria-hidden />}>{t('AI credits')}</SectionTitle>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="grid gap-1.5">
						<Meter label={summary.meterLabel} value={summary.meterPercent} showValue={false} />
						{summary.overrunNote && <p className="text-xs text-kumo-subtle">{summary.overrunNote}</p>}
					</div>
					<dl className="grid gap-2 text-sm sm:grid-cols-2">
						<Fact label={t('Monthly credits')} value={creditsText(credits.pool)} />
						{credits.granted > 0 && <Fact label={t('Added by Estori')} value={creditsText(credits.granted)} />}
						<Fact label={t('Left this month')} value={creditsText(summary.monthlyLeft)} />
						{(summary.extraLeft > 0 || view.purchases.length > 0) && <Fact label={t('Extra credits left')} value={creditsText(summary.extraLeft)} />}
						<Fact label={t('Renews on')} value={dateText(credits.renewsAt)} />
					</dl>
					{view.purchases.length > 0 && (
						<ul className="grid gap-1 text-sm text-kumo-subtle">
							{view.purchases.map((purchase) => (
								<li key={purchase.purchasedAt}>{purchaseLineFor(purchase)}</li>
							))}
						</ul>
					)}
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

function ExtraCredits({ view, disabled }: { view: BillingView; disabled: boolean }) {
	const i18n = useI18n();
	const [credits, setCredits] = useState<number>(EXTRA_CREDITS.minCredits);
	const buyCredits = useBuyCredits();
	const purchase = () => {
		keepBaseline(checkoutBaselineOf(view));
		buyCredits(credits);
	};

	return (
		<LayerCard id="extra-credits" className="scroll-mt-4">
			<SectionTitle icon={<StackPlusIcon className="size-4" aria-hidden />}>{t('Extra credits')}</SectionTitle>
			<LayerCard.Primary>
				{view.canBuyCredits ? (
					<div className="grid gap-4">
						<p className="text-sm text-kumo-subtle">
							{t('{price}, from {min} to {max} at a time.', {
								price: extraCreditsPriceLabel(i18n),
								min: creditsText(EXTRA_CREDITS.minCredits),
								max: creditsText(EXTRA_CREDITS.maxCredits),
							})}
						</p>
						<div className="flex flex-wrap items-center gap-4">
							<CreditsStepper value={credits} onChange={setCredits} />
							<p className="text-lg font-medium text-kumo-default">{usdText(extraCreditsPriceCents(credits))}</p>
							<Button variant="primary" disabled={disabled} onClick={purchase}>
								{t('Buy credits')}
							</Button>
						</div>
						<p className="text-xs text-kumo-subtle">{t(EXTRA_CREDITS_DISCLOSURE)}</p>
					</div>
				) : (
					<p className="text-sm text-kumo-default">{t('Credit purchases are unavailable. Contact us for help.')}</p>
				)}
			</LayerCard.Primary>
		</LayerCard>
	);
}

function NotOpen() {
	return (
		<LayerCard>
			<LayerCard.Primary>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<p className="text-sm text-kumo-default">{t(BILLING_NOT_OPEN_MESSAGE)}</p>
					<Link to="/pricing" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
						{t('See the plans')}
					</Link>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

function ConfirmDialog({
	action,
	confirmation,
	pending,
	onClose,
	onConfirm,
}: {
	action: ConfirmedAction | 'interval-change';
	confirmation: Confirmation;
	pending: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{confirmation.title}</DialogTitle>
					<DialogDescription>{confirmation.body}</DialogDescription>
				</DialogHeader>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose} disabled={pending}>
						{t('Not now')}
					</Button>
					<Button variant={action === 'cancel' ? 'destructive' : 'primary'} loading={pending} onClick={onConfirm}>
						{confirmation.confirm}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Settings, Plan and billing: the plan and what's next for it (with the ways to pay a failed renewal), this month's credits,
 * extra credits, the card on file and the invoices. Back from checkout, or from paying a failed renewal, it polls until the
 * webhook has recorded the payment; a `?plan=` link opens that plan's next step once.
 */
export default function BillingPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const [waiting, setWaiting] = useState<Waiting | null>(null);
	const [timedOut, setTimedOut] = useState(false);
	const [cancelled, setCancelled] = useState(false);
	const [requested, setRequested] = useState<{ plan: PaidPlanId; search: string } | null>(null);
	const [newInterval, setNewInterval] = useState<BillingInterval>('month');
	const [cadence, setCadence] = useState<PlanConfiguration | null>(null);
	const confirming = waiting !== null;
	const billing = useBilling({ refetchInterval: confirming ? CONFIRM_POLL_MS : false });
	const view = billing.data;
	const interval = view?.source === 'subscription' ? (view.billingInterval ?? 'month') : newInterval;
	const checkout = usePlanCheckout();
	const planChange = usePlanChange();
	const payNow = usePayNow((result) => {
		const notice = describePaymentResult(result);
		if (notice.tone === 'success') toast.success(notice.message);
		if (result.state === 'paid' || result.state === 'nothing_due') {
			setTimedOut(false);
			setWaiting({ kind: 'renewal' });
		}
	});
	const declined = payNow.data?.state === 'declined' ? describePaymentResult(payNow.data).message : null;
	const [confirm, setConfirm] = useState<ConfirmedAction | null>(null);
	/** What a credits return compares against: kept across the trip to Stripe, or else the first view after it. */
	const baseline = useRef<CheckoutBaseline | null>(null);

	// The address says what to do (a return from Stripe, or a plan a link asked for), whether the page just opened or a
	// link was followed on it. It's cleared once read, so a refresh doesn't repeat it.
	useEffect(() => {
		if (location.search === '') return;
		const returned = checkoutReturnOf(location.search);
		if (returned === 'plan' || returned === 'credits') {
			baseline.current = returned === 'credits' ? readCheckoutBaseline(recallBaseline()) : null;
			setTimedOut(false);
			setWaiting({ kind: 'payment', paid: returned });
		} else if (returned === 'renewal') {
			setTimedOut(false);
			setWaiting({ kind: 'renewal' });
		}
		setCancelled(returned === 'cancelled');
		const plan = requestedPlanOf(location.search);
		if (plan) setRequested({ plan, search: location.search });
		navigate({ pathname: location.pathname, hash: location.hash }, { replace: true });
	}, [location.pathname, location.search, location.hash, navigate]);

	useEffect(() => {
		if (!waiting || !view) return;
		if (waiting.kind === 'configuration') { if (configurationMatches(view, waiting.target)) setWaiting(null); return; }
		if (waiting.kind === 'change') {
			if (showsChange(waiting.action, view)) setWaiting(null);
			return;
		}
		if (waiting.kind === 'renewal') {
			if (isRenewalPaid(view)) setWaiting(null);
			return;
		}
		baseline.current ??= checkoutBaselineOf(view);
		if (!isConfirmed(waiting.paid, baseline.current, view)) return;
		setWaiting(null);
		forgetBaseline();
		toast.success(waiting.paid === 'plan' ? t("You're on {plan} now.", { plan: planName(view.plan) }) : t('Your extra credits are ready.'));
	}, [waiting, view]);

	useEffect(() => {
		if (!waiting) return;
		const timer = window.setTimeout(() => {
			setWaiting(null);
			if (waiting.kind === 'change' || waiting.kind === 'configuration') {
				toast(t(CHANGE_SLOW));
				return;
			}
			if (waiting.kind === 'renewal') {
				toast(t(RENEWAL_SLOW));
				return;
			}
			setTimedOut(true);
			forgetBaseline();
		}, CONFIRM_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [waiting]);

	// Waits for a settled view: after a refused checkout the page refetches, and a stale view would start it again.
	useEffect(() => {
		if (requested === null || !view || billing.isFetching) return;
		setRequested(null);
		if (!view.enabled) return;
		const selected = checkoutRequestOf(requested.search);
		if (selected?.kind !== 'plan') return;
		const desiredInterval = requestedBillingInterval(requested.search, view.billingInterval ?? 'month');
		const amount = selected.monthlyCredits ?? creditsForPlanChange(requested.plan, view.monthlyCredits);
		if (view.source === 'subscription' && (desiredInterval !== (view.billingInterval ?? 'month') || selected.monthlyCredits !== undefined && (requested.plan !== view.plan || amount !== (view.monthlyCredits ?? PLAN_LIMITS[requested.plan].aiCredits))) && !view.paymentFailing && !view.cancelAtPeriodEnd && view.pendingPlan === null) {
			setCadence({ plan: requested.plan, interval: desiredInterval, monthlyCredits: amount });
			return;
		}
		const choice = planChoicesFor(view).find((entry) => entry.plan === requested.plan);
		if (choice?.action === 'checkout') checkout.start(choice.plan, desiredInterval, selected.monthlyCredits);
		else if (choice?.action === 'upgrade' || choice?.action === 'downgrade') setConfirm(choice.action);
	}, [requested, view, billing.isFetching, checkout]);

	const loaded = view !== undefined;
	useEffect(() => {
		if (loaded && SCROLL_ANCHORS.includes(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
	}, [loaded, location.hash]);

	const change = (action: PlanAction, request: PlanChange, onDone?: () => void) =>
		planChange.mutate(request, {
			onSuccess: () => {
				onDone?.();
				toast.success(t(CHANGE_REQUESTED));
				setTimedOut(false);
				if (request.kind === 'change' && request.monthlyCredits !== undefined) setWaiting({ kind: 'configuration', target: { plan: request.plan, interval: request.billingInterval ?? view?.billingInterval ?? 'month', monthlyCredits: request.monthlyCredits } });
				else setWaiting({ kind: 'change', action });
			},
			onError: (failure) => showBillingError(failure, CHANGE_FAILED_MESSAGE),
		});

	const act = (choice: PlanChoice) => {
		switch (choice.action) {
			case 'checkout':
				checkout.start(choice.plan, interval);
				return;
			case 'upgrade':
			case 'downgrade':
				setConfirm(choice.action);
				return;
			case 'resume':
				change('resume', { kind: 'resume' });
				return;
			case 'cancel-change':
				change('cancel-change', { kind: 'change', plan: choice.plan });
				return;
			case 'current':
			case 'none':
				return;
		}
	};

	const busyFor = (choice: PlanChoice): boolean => {
		if (!planChange.isPending) return false;
		if (choice.action === 'resume') return planChange.variables?.kind === 'resume';
		return choice.action === 'cancel-change' && planChange.variables?.kind === 'change';
	};
	// One request at a time, and nothing new while the last payment or change is still on its way.
	const busy = confirming || planChange.isPending;
	const choices = view ? planChoicesFor(view) : [];

	return (
		<div className="size-full">
			<title>{pageTitle(t('Plan and billing'))}</title>
			<div className="container mx-auto grid max-w-4xl gap-6 px-4 py-8">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">{t('Plan and billing')}</h1>
					<p className="text-kumo-subtle">{t("Your plan, this month's AI credits and extra credits.")}</p>
				</div>

				{waiting !== null && waiting.kind !== 'change' && (
					<Banner
						icon={<SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />}
						title={t('Confirming your payment…')}
						description={t('This takes a few seconds.')}
					/>
				)}
				{timedOut && <Banner variant="alert" icon={<WarningCircleIcon />} description={t('Your payment is being confirmed. Refresh in a minute.')} />}
				{cancelled && <Banner variant="secondary" icon={<InfoIcon />} description={t('Checkout cancelled. Nothing was charged.')} />}

				{view ? (
					view.enabled ? (
						<>
							<CurrentPlan
								view={view}
								paying={payNow.isPending}
								disabled={busy}
								declined={declined}
								onCancel={() => setConfirm('cancel')}
								onPayNow={() => payNow.mutate()}
								onChangeInterval={() => {
									if (view.plan === 'pro' || view.plan === 'premium')
										setCadence({ plan: view.plan, interval: view.billingInterval === 'year' ? 'month' : 'year', monthlyCredits: creditsForPlanChange(view.plan, view.monthlyCredits) });
								}}
							/>
							<section aria-labelledby="plans-title" className="grid gap-3">
								<h2 id="plans-title" className="text-lg font-semibold text-kumo-strong">
									{t('Plans')}
								</h2>
								{view.source !== 'subscription' && (
									<BillingIntervalPicker value={newInterval} onChange={setNewInterval} monthly={t('Monthly')} yearly={t('Yearly')} savings={t('Save 20%')} />
								)}
								<div className="grid gap-4 sm:grid-cols-2">
									{choices.map((choice) => (
										<PlanOption
											key={choice.plan}
											interval={interval}
											monthlyCredits={creditsForPlanChange(choice.plan, view.monthlyCredits)}
											choice={choice}
											current={choice.plan === view.plan}
											busy={busyFor(choice)}
											disabled={busy}
											onAct={() => act(choice)}
										/>
									))}
								</div>
							</section>
							<Credits view={view} />
							<ExtraCredits view={view} disabled={busy} />
							{view.canManageBilling && (
								<>
									<PaymentMethodCard card={view.card} />
									<BillingHistory />
								</>
							)}
						</>
					) : (
						<NotOpen />
					)
				) : billing.isError ? (
					<Empty title={t("Couldn't load your plan")} description={t(billing.error.message)} />
				) : (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				)}
			</div>
			{view && cadence && (
				<ConfirmDialog
					action="interval-change"
					pending={planChange.isPending}
					onClose={() => setCadence(null)}
					confirmation={configurationConfirmation(view, cadence)}
					onConfirm={() => change('interval-change', { kind: 'change', plan: cadence.plan, billingInterval: cadence.interval, monthlyCredits: cadence.monthlyCredits }, () => setCadence(null))}
				/>
			)}
			{view && confirm && (
				<ConfirmDialog
					action={confirm}
					confirmation={confirmationFor(view, confirm)}
					pending={planChange.isPending}
					onClose={() => setConfirm(null)}
					onConfirm={() => change(confirm, CONFIRMED_CHANGES[confirm], () => setConfirm(null))}
				/>
			)}
		</div>
	);
}
