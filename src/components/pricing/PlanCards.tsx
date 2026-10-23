import { formatUsd, formatCredits, publicTranslator, limitFeatures } from '@/lib/i18n/public-pricing';
import { t, T } from '@/lib/i18n';
import { Select } from '@cloudflare/kumo';
import { BillingIntervalPicker } from '@/components/billing/BillingIntervalPicker';
import { marketingCopy } from '@/content/marketing-copy';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { BuildingsIcon, CheckIcon, CoinsIcon, CrownIcon, RocketLaunchIcon, StorefrontIcon, type Icon } from '@phosphor-icons/react';
import { PLAN_LIMITS, planCreditOptions, isPlanCreditAmount, planPriceCents, type BillingInterval, type PaidPlanId } from '@/api-types';
import { PlanButton } from '@/components/billing/PlanButton';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PillLink } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { useBillingOn } from '@/hooks/use-billing';
import type { CapabilityId } from '@/lib/capabilities';
import { contactPath } from '@/lib/contact';
import { planById, type PlanId } from '@/lib/plans';

function Feature({ children, capability }: { children: ReactNode; capability?: CapabilityId }) {
	return (
		<li className="flex items-start gap-3 text-[15px] font-light text-public-ink">
			<CheckIcon className="mt-1 size-4 shrink-0 text-public-blue" weight="bold" aria-hidden />
			<span className="inline-flex flex-wrap items-center gap-2">
				{children}
				{capability && <CapabilityTag id={capability} />}
			</span>
		</li>
	);
}

function PlanHeading({ id, icon: Glyph, children }: { id: PlanId; icon: Icon; children?: ReactNode }) {
	const plan = planById(id);
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<h3 className="flex items-center gap-2.5 text-2xl font-normal text-public-ink">
					<Glyph className="size-6 text-public-blue" aria-hidden />
					{t(plan.name)}
				</h3>
				{children}
			</div>
			<p className="mt-2 text-[15px] font-light text-public-muted">{t(plan.tagline)}</p>
		</>
	);
}

function Price({ cents }: { cents: number }) {
	return (
		<p aria-live="polite" aria-atomic="true" className="mt-8 text-4xl font-light tracking-[-0.02em] lg:text-5xl text-public-ink">
			<T text="{price}<period> / month</period>" values={{ price: formatUsd(cents) }} components={{ period: children => <span className="whitespace-nowrap text-base font-normal tracking-normal text-public-muted">{children}</span> }} />
		</p>
	);
}

/** The plan's credits, in the shaded line under the price. */
function Allowance({ children }: { children: ReactNode }) {
	return (
		<div className="mt-6 flex min-h-16 items-center gap-3 rounded-xl bg-[#f5f6f8] px-4 py-3 text-sm text-public-ink">
			<CoinsIcon className="size-5 shrink-0 text-public-blue" aria-hidden />
			{children}
		</div>
	);
}

// Share the heading, copy, price, allowance and action rows across desktop cards.
const CARD = 'flex flex-col p-8 sm:p-10 md:row-span-7 md:grid md:grid-rows-subgrid md:p-7 lg:p-10';

function BasicPlan() {
	const { storesLifetime } = PLAN_LIMITS.basic;
	return (
		<article className={CARD}>
			<PlanHeading id="basic" icon={StorefrontIcon} />
			<Price cents={0} />
			<p className="mt-1 min-h-10 text-sm text-public-muted">{t("Free forever. No credit card.")}</p>
			<Allowance>
				<PlanLimits className="text-sm text-public-ink" />
			</Allowance>
			<div className="mt-6"><StartBuildingButton variant="blue" className="w-full" /></div>
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8 md:self-start">
				<Feature>{t(marketingCopy.pricing.cards.build)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.preview)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.drafts, { count: PLAN_LIMITS.basic.draftsPerStore })}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.languages)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.templates)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.publish)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.basicSelling)}</Feature>
				<Feature>{t(marketingCopy.pricing.comparison.features.catalog.label)}</Feature>
				<Feature>{t(marketingCopy.pricing.comparison.features.fulfillment.label)}</Feature>
				{storesLifetime !== null && (
					<Feature>
						{t(marketingCopy.pricing.cards.stores, { count: storesLifetime })}
					</Feature>
				)}
			</ul>
		</article>
	);
}

/** What each paid plan adds to the one before it, from the shared limits. */
function PaidFeatures({ plan }: { plan: PaidPlanId }) {
	if (plan === 'pro') {
		return (
			<>
				<Feature>{t("Everything in Basic")}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.customEmails)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.flexiblePayouts)}</Feature>
				<Feature>{t(marketingCopy.pricing.cards.translations)}</Feature>
				{limitFeatures('pro', 'basic').map((line) => (
					<Feature key={line}>{t(line)}</Feature>
				))}
				<Feature>{t(marketingCopy.pricing.comparison.features.prioritySupport.label)}</Feature>
			</>
		);
	}
	return (
		<>
			<Feature>{t("Everything in Pro")}</Feature>
			{limitFeatures('premium', 'pro').map((line) => (
				<Feature key={line}>{t(line)}</Feature>
			))}
			<Feature>{t(marketingCopy.pricing.comparison.features.editEmails.label)}</Feature>
			<Feature>{t(marketingCopy.pricing.comparison.features.replyToEmails.label)}</Feature>
			<Feature>{t(marketingCopy.pricing.comparison.features.tracking.label)}</Feature>
			<Feature>{t(marketingCopy.pricing.comparison.features.refunds.label)}</Feature>
			<Feature>{t(marketingCopy.pricing.comparison.features.accountManager.label)}</Feature>
			<Feature capability="agentic-commerce">{t("Get recommended by AI assistants")}</Feature>
			<Feature capability="operations-agents">{t("Store assistants")}</Feature>
			<Feature capability="personalized-shopping">{t("Personalized shopping")}</Feature>
		</>
	);
}

const PAID_ICONS: Record<PaidPlanId, Icon> = { pro: RocketLaunchIcon, premium: CrownIcon };

/** Online checkout is used when available; otherwise the plan can be activated through sales. */
function PaidPlan({ plan, billing, interval, monthlyCredits, onCreditsChange, portalContainer }: { plan: PaidPlanId; billing: boolean; interval: BillingInterval; monthlyCredits: number; onCreditsChange: (credits: number) => void; portalContainer: RefObject<HTMLElement | null> }) {
	return (
		<article className={CARD}>
			<PlanHeading id={plan} icon={PAID_ICONS[plan]} />
			<Price cents={planPriceCents(plan, interval, monthlyCredits) / (interval === 'year' ? 12 : 1)} />
			<p className="mt-1 min-h-10 text-sm text-public-muted">{interval === 'year' ? t(marketingCopy.pricing.billing.yearlyNote, { amount: formatUsd(planPriceCents(plan, interval, monthlyCredits)) }) : t(marketingCopy.pricing.billing.monthlyNote)}</p>
			<div className="mt-6 min-w-0 [&>div]:min-w-0 [&>div]:w-full">
				<Select<number>
					container={portalContainer}
					aria-label={t("{plan} monthly AI credits", { plan: planById(plan).name })}
					value={monthlyCredits}
					onValueChange={(value) => { if (isPlanCreditAmount(plan, value)) onCreditsChange(value); }}
					className="h-auto min-h-16 w-full bg-[#f5f6f8] px-4 py-3 text-sm"
					renderValue={(value) => <span className="whitespace-normal text-left">{t("{credits} AI credits a month", { credits: formatCredits(value) })}</span>}
					items={planCreditOptions(plan).map(value => ({ value, label: t("{credits} AI credits a month", { credits: formatCredits(value) }) }))}
				/>
			</div>
			<div className="mt-6">
				{billing ? <PlanButton i18n={publicTranslator()} plan={plan} billingInterval={interval} monthlyCredits={monthlyCredits} className="w-full" /> : (
					<>
						<PillLink to={contactPath(plan)} variant="charcoal" className="w-full">{t("Get {plan}", { plan: planById(plan).name })}
						</PillLink>
						<p className="mt-3 text-center text-xs text-public-muted">{t(plan === 'premium' ? marketingCopy.pricing.comparison.premiumContact : marketingCopy.pricing.comparison.proContact)}</p>
					</>
				)}
			</div>
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8 md:self-start">
				<PaidFeatures plan={plan} />
			</ul>
		</article>
	);
}

/** 1Password's business pricing: Basic, Pro and Premium side by side in one frame, Enterprise on its own band below. */
export function PlanCards({ interval = 'month', onIntervalChange = () => undefined, credits, onCreditsChange }: { interval?: BillingInterval; onIntervalChange?: (interval: BillingInterval) => void; credits?: Record<PaidPlanId, number>; onCreditsChange?: (plan: PaidPlanId, credits: number) => void }) {
 const portalContainer = useRef<HTMLElement>(null);
 const [localCredits, setLocalCredits] = useState({ pro: PLAN_LIMITS.pro.aiCredits, premium: PLAN_LIMITS.premium.aiCredits });
 const selected = credits ?? localCredits;
 const chooseCredits = onCreditsChange ?? ((plan: PaidPlanId, amount: number) => setLocalCredits(current => ({ ...current, [plan]: amount })));
	const billing = useBillingOn();
	return (
		<section ref={portalContainer} aria-labelledby="plans-title" className="public-plan-controls bg-white px-4 pt-16 pb-6 sm:px-6 sm:pt-20">
			<h2 id="plans-title" className="sr-only">{t("Plans")}</h2>
			<div className="mb-8"><BillingIntervalPicker value={interval} onChange={onIntervalChange} monthly={t(marketingCopy.pricing.billing.monthly)} yearly={t(marketingCopy.pricing.billing.yearly)} savings={t(marketingCopy.pricing.billing.savings)} /></div>
			<div className="mx-auto grid max-w-[1248px] overflow-hidden rounded-[25px] ring-1 ring-[#c9dbff] md:grid-cols-3 md:grid-rows-[repeat(6,auto)_1fr] md:divide-x md:divide-[#c9dbff] max-md:divide-y max-md:divide-[#c9dbff]">
				<BasicPlan />
				<PaidPlan portalContainer={portalContainer} plan="pro" billing={billing} interval={interval} monthlyCredits={selected.pro} onCreditsChange={value => chooseCredits('pro', value)} />
				<PaidPlan portalContainer={portalContainer} plan="premium" billing={billing} interval={interval} monthlyCredits={selected.premium} onCreditsChange={value => chooseCredits('premium', value)} />
			</div>
			<EnterpriseBand />
			<p className="mx-auto mt-6 max-w-[1248px] text-center text-xs text-public-muted">{t("Prices are in US dollars and exclude any applicable taxes. ")}{t(marketingCopy.pricing.creditsNote)}</p>
		</section>
	);
}

function EnterpriseBand() {
	const plan = planById('enterprise');
	return (
		<article className="mx-auto mt-6 flex max-w-[1248px] flex-col gap-6 rounded-[25px] bg-public-charcoal p-8 text-white sm:flex-row sm:items-center sm:justify-between sm:p-10">
			<div>
				<h3 className="flex items-center gap-2.5 text-2xl font-normal">
					<BuildingsIcon className="size-6 text-[#9cc2ff]" aria-hidden />
					{t(plan.name)}
				</h3>
				<p className="mt-2 max-w-2xl text-[15px] font-light text-white/80">
					{t(plan.tagline)}{t(" Custom credit volume, invoiced billing and a named contact for teams running many stores.")}</p>
			</div>
			<PillLink to={contactPath('enterprise')} variant="white" className="shrink-0">{t("Talk to sales")}</PillLink>
		</article>
	);
}
