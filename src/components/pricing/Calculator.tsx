import { formatUsd, formatCredits, publicTranslator } from '@/lib/i18n/public-pricing';
import { t, tn, T, useLocale } from '@/lib/i18n';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowCounterClockwiseIcon, CheckCircleIcon, LightbulbIcon } from '@phosphor-icons/react';
import { PlanButton } from '@/components/billing/PlanButton';
import { marketingCopy } from '@/content/marketing-copy';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { useBillingOn } from '@/hooks/use-billing';
import { useModelRates } from '@/hooks/use-model-rates';
import { PLAN_LIMITS, PLAN_PRICES_CENTS, extraCreditsPriceCents } from '@/api-types';
import { contactPath } from '@/lib/contact';
import {
	CREDIT_ACTIONS,
	actionById,
	actionCredits,
	creditsFor,
	monthlyCredits,
	recommendPlan,
	typicalUsage,
	type CreditAction,
	type Recommendation,
	type Usage,
	type UsageCategory,
} from '@/lib/credits';
import { planById } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { Stepper } from './Stepper';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

/** The amounts a visitor sets, without the model rate, which comes from the model they pick. */
type Amounts = Omit<Usage, 'creditsPerStep'>;

function typicalAmounts(stores: number): Amounts {
	const { creditsPerStep: _rate, ...amounts } = typicalUsage(stores, 0);
	return amounts;
}

function StepHeading({ number, title, children }: { number: number; title: string; children?: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<h2 className="flex items-center gap-3 text-xl text-public-ink">
				<span className="grid size-8 place-items-center rounded-full text-[15px] ring-1 ring-public-ink">{number}</span>
				{t(title)}
			</h2>
			{children}
		</div>
	);
}

/** "2 stores × 30 changes × 32 credits = 1,920 credits a month" for a category, at the chosen rate. */
function Formula({ parts, total }: { parts: readonly string[]; total: number }) {
	return (
		<p className="mt-3 font-mono text-[12px] text-public-muted">
			{tn('{factors} = {count} credit a month', '{factors} = {count} credits a month', total, { factors: parts.join(' × ') })}</p>
	);
}

function CategoryCard({
	action,
	usage,
	onToggle,
	children,
}: {
	action: CreditAction;
	usage: Usage;
	onToggle: (on: boolean) => void;
	children: ReactNode;
}) {
	const on = usage.categories[action.id];
	return (
		<div className="overflow-hidden rounded-[16px] ring-1 ring-public-line">
			<label className="flex cursor-pointer flex-wrap items-center gap-3 bg-[#f5f6f8] px-5 py-4">
				<input type="checkbox" checked={on} onChange={(event) => onToggle(event.target.checked)} className="size-4 accent-public-blue" />
				<span className="text-[17px] text-public-ink">{t(action.name)}</span>
				{action.capability && <CapabilityTag id={action.capability} />}
				<span className="ml-auto rounded-full bg-white px-3 py-1 text-[13px] text-public-ink ring-1 ring-public-line">
					{tn('{count} credit a month', '{count} credits a month', on ? creditsFor(action.id, usage) : 0)}</span>
			</label>
			{on && <div className="grid gap-3 px-5 py-4">{children}</div>}
		</div>
	);
}

/** The plan's monthly price as one short figure; Premium's includes the extra credits the month needs. */
function planPrice(recommendation: Recommendation): string {
	switch (recommendation.plan) {
		case 'basic':
			return formatUsd(0);
		case 'pro':
			return formatUsd(PLAN_PRICES_CENTS.pro);
		case 'premium':
			return formatUsd(PLAN_PRICES_CENTS.premium + extraCreditsPriceCents(recommendation.extraCredits));
		case 'enterprise':
			return t("Let's talk");
	}
}

/** The credits a month the recommendation covers, extra credits included; Enterprise covers whatever is needed. */
function includedCredits(recommendation: Recommendation, basicCredits: number, needed: number): number {
	switch (recommendation.plan) {
		case 'basic':
			return basicCredits;
		case 'pro':
			return PLAN_LIMITS.pro.aiCredits;
		case 'premium':
			return PLAN_LIMITS.premium.aiCredits + recommendation.extraCredits;
		case 'enterprise':
			return needed;
	}
}

/** "Premium, 100,000 credits a month, plus 50,000 extra credits ($75)": what the recommendation buys. */
function planSummary(recommendation: Recommendation): string {
	if (recommendation.plan === 'enterprise') return t('Enterprise, credits and terms for your volume');
	const plan = planById(recommendation.plan).name;
	const credits = PLAN_LIMITS[recommendation.plan].aiCredits;
	if (recommendation.plan === 'premium' && recommendation.extraCredits > 0) {
		return tn(
			'{plan}, {credits} credits a month, plus {count} extra credit ({price})',
			'{plan}, {credits} credits a month, plus {count} extra credits ({price})',
			recommendation.extraCredits,
			{ plan, credits: formatCredits(credits), price: formatUsd(extraCreditsPriceCents(recommendation.extraCredits)) },
		);
	}
	return tn('{plan}, {count} credit a month', '{plan}, {count} credits a month', credits, { plan });
}

/**
 * Apollo's pricing calculator, for stores: how many stores, which model, and a typical month by category on the left;
 * the plan that covers it, pinned on the right.
 */
export function Calculator() {
	useLocale();
	const { models, defaultModel } = useModelRates();
	const billing = useBillingOn();
	const [modelId, setModelId] = useState<string | null>(null);
	const [amounts, setAmounts] = useState<Amounts>(() => typicalAmounts(1));
	const recommendationRef = useRef<HTMLElement>(null);

	const model = models.find((entry) => entry.id === modelId) ?? defaultModel;
	const usage: Usage = { ...amounts, creditsPerStep: model?.creditsPerStep ?? 0 };
	const basicCredits = PLAN_LIMITS.basic.aiCredits;
	const needed = monthlyCredits(usage);
	const recommendation = recommendPlan(needed);
	const included = includedCredits(recommendation, basicCredits, needed);
	const fill = included > 0 ? Math.min(1, needed / included) : 0;
	const recommendedName = planById(recommendation.plan).name;
	// Live model rates determine how much AI work uses; plan allowances are monthly.
	const ready = models.length > 0;

	const update = (change: Partial<Amounts>) => setAmounts((current) => ({ ...current, ...change }));
	const toggle = (category: UsageCategory, on: boolean) => setAmounts((current) => ({ ...current, categories: { ...current.categories, [category]: on } }));
	const setStores = (stores: number) => setAmounts((current) => ({ ...typicalAmounts(stores), categories: current.categories }));
	const each = (category: UsageCategory) => actionCredits(actionById(category), usage.creditsPerStep);

	return (
		<section className="bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28">
			<div className="mx-auto max-w-3xl text-center">
				<h1 className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>{t("Find the plan that fits your stores")}</h1>
				<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{t("Tell us how you'll use Estori and we'll recommend a plan, based on the credits a typical month would take.")}</p>
			</div>
			<div className="mx-auto mt-14 grid max-w-[1248px] grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
				<div className="grid content-start gap-12">
					<div>
						<StepHeading number={1} title={t("Start with your stores")}>
							<button
								type="button"
								onClick={() => {
									setModelId(null);
									setAmounts(typicalAmounts(1));
								}}
								className="inline-flex items-center gap-1.5 text-[15px] text-public-ink underline underline-offset-4"
							>
								<ArrowCounterClockwiseIcon className="size-4" aria-hidden />{t("Start over")}</button>
						</StepHeading>
						<div className="mt-5 rounded-[16px] px-5 py-4 ring-1 ring-public-line">
							<Stepper label={t("How many stores will you run?")} noun={t("stores")} value={amounts.stores} onChange={setStores} min={1} max={500} />
						</div>
					</div>

					<div>
						<StepHeading number={2} title={t("Choose your AI model")} />
						<fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
							<legend className="sr-only">{t("AI model")}</legend>
							{models.length === 0 && <p className="text-[15px] text-public-muted">{t("Loading the models…")}</p>}
							{models.map((entry) => (
								<label
									key={entry.id}
									className={cn(
										'flex cursor-pointer items-center gap-3 rounded-[14px] px-4 py-3 ring-1 transition-colors',
										entry.id === model?.id ? 'bg-[#eef4ff] ring-public-blue' : 'ring-public-line hover:bg-[#f5f6f8]',
									)}
								>
									<input type="radio" name="model" checked={entry.id === model?.id} onChange={() => setModelId(entry.id)} className="size-4 accent-public-blue" />
									<span className="min-w-0">
										<span className="block text-[15px] text-public-ink">
											{entry.label}
											{entry.id === defaultModel?.id && <span className="ml-2 text-[12px] text-public-muted">{t("Default")}</span>}
										</span>
										<span className="block text-[13px] text-public-muted">{tn('about {count} credit per step', 'about {count} credits per step', entry.creditsPerStep)}</span>
									</span>
								</label>
							))}
						</fieldset>
					</div>

					<div>
						<StepHeading number={3} title={t("Adjust your monthly usage")} />
						<p className="mt-5 flex items-start gap-3 rounded-[14px] bg-[#fdf8ec] px-4 py-3 text-[14px] text-public-ink">
							<LightbulbIcon className="mt-0.5 size-5 shrink-0 text-[#b5651d]" aria-hidden />
							<span>{tn('These are typical amounts for {count} store. Adjust anything below to match your plans.', 'These are typical amounts for {count} stores. Adjust anything below to match your plans.', amounts.stores)}</span>
						</p>
						<div className="mt-4 grid gap-3">
							{CREDIT_ACTIONS.map((action) => (
								<CategoryCard key={action.id} action={action} usage={usage} onToggle={(on) => toggle(action.id, on)}>
									{action.id === 'build' && (
										<>
											<Stepper label={t("New stores built this month")} noun={t("new stores")} value={amounts.newStores} onChange={(newStores) => update({ newStores })} max={500} />
											<Formula parts={[tn('{count} store', '{count} stores', amounts.newStores), tn('{count} credit', '{count} credits', each('build'))]} total={creditsFor('build', usage)} />
										</>
									)}
									{action.id === 'change' && (
										<>
											<Stepper
												label={t("Changes per store each month")}
												noun={t("changes")}
												value={amounts.changesPerStore}
												onChange={(changesPerStore) => update({ changesPerStore })}
												step={5}
												max={2_000}
											/>
											<Formula
												parts={[tn('{count} store', '{count} stores', amounts.stores), tn('{count} change', '{count} changes', amounts.changesPerStore), tn('{count} credit', '{count} credits', each('change'))]}
												total={creditsFor('change', usage)}
											/>
										</>
									)}
									{action.id === 'assistant' && (
										<>
											<Stepper
												label={t("Assistant tasks per store each month")}
												noun={t("tasks")}
												value={amounts.assistantTasksPerStore}
												onChange={(assistantTasksPerStore) => update({ assistantTasksPerStore })}
												step={10}
												max={20_000}
											/>
											<Formula
												parts={[tn('{count} store', '{count} stores', amounts.stores), tn('{count} task', '{count} tasks', amounts.assistantTasksPerStore), tn('{count} credit', '{count} credits', each('assistant'))]}
												total={creditsFor('assistant', usage)}
											/>
										</>
									)}
								</CategoryCard>
							))}
						</div>
						<p className="mt-4 text-sm leading-relaxed text-public-muted">{t(marketingCopy.pricing.credits.calculatorNote)}</p>
					</div>
					{/* Phone summary: pinned to the bottom of the screen while the inputs scroll, then settles above the panel. */}
					{ready && (
						<div className="sticky bottom-0 z-10 -mx-4 border-t border-[#c9dbff] bg-[#eef4ff]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
							<div className="flex items-center justify-between gap-3">
								<p className="min-w-0 text-public-ink">
									<span className="block font-mono text-[11px] tracking-[0.08em] text-public-muted uppercase">{t("We recommend")}</span>
									<span className="text-lg">{recommendedName}</span>
									<span className="text-sm text-public-muted"> · {tn('{count} credit a month', '{count} credits a month', needed)}</span>
								</p>
								<button
									type="button"
									onClick={() => recommendationRef.current?.scrollIntoView({ block: 'start' })}
									aria-label={t('{price}, see the recommended plan', { price: planPrice(recommendation) })}
									className="shrink-0 rounded-full bg-public-charcoal px-4 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue"
								>
									{planPrice(recommendation)}
								</button>
							</div>
						</div>
					)}
				</div>

				<aside ref={recommendationRef} className="scroll-mt-[calc(var(--public-header-h)+1rem)] self-start lg:sticky lg:top-[calc(var(--public-header-h)+1.5rem)]">
					{ready ? (
						<div className="overflow-hidden rounded-[20px] ring-1 ring-[#c9dbff]">
							<div className="bg-[#eef4ff] px-6 pt-6 pb-7">
								<div className="flex items-center justify-between gap-3">
									<p className="font-mono text-[12px] tracking-[0.08em] text-public-ink uppercase">{t("We recommend")}</p>
									<Link to="/pricing#compare" className="rounded-full px-3 py-1 text-[13px] text-public-ink ring-1 ring-public-ink hover:bg-white">{t("Compare plans")}</Link>
								</div>
								<div aria-live="polite">
									<p className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink">{recommendedName}</p>
									<p className="mt-6 font-mono text-[11px] tracking-[0.08em] text-public-muted uppercase">{t("Credits you need")}</p>
									<p className="mt-1 text-base text-public-muted">
										<T text="<amount>{credits}</amount> a month" values={{ credits: formatCredits(needed) }} components={{ amount: (children) => <span className="text-3xl font-light text-public-ink">{children}</span> }} />
									</p>
								</div>
								<div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-[#c9dbff]">
									<div className="h-full rounded-full bg-public-ink transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${fill * 100}%` }} />
								</div>
								<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-public-ink">
									<span>
										{recommendation.plan === 'enterprise'
											? t('Custom credit volume')
											: recommendation.plan === 'premium' && recommendation.extraCredits > 0
												? tn('{count} credit a month with {plan} and extra credits', '{count} credits a month with {plan} and extra credits', included, { plan: recommendedName })
												: tn('{count} credit a month included in {plan}', '{count} credits a month included in {plan}', included, { plan: recommendedName })}
									</span>
									<span className="inline-flex items-center gap-1 text-[#14865f]">
										<CheckCircleIcon className="size-4" aria-hidden />{t("Usage covered")}</span>
								</div>
								{recommendation.plan !== 'enterprise' && (
									<p className="mt-1 text-[13px] text-public-muted">{tn('{count} credit left over', '{count} credits left over', Math.max(0, included - needed))}</p>
								)}
							</div>
							<div className="grid gap-3 px-6 py-5 text-[15px]">
								<div className="flex items-baseline justify-between gap-3">
									<span className="text-public-ink">{planSummary(recommendation)}</span>
									<span className="shrink-0 text-public-ink">{planPrice(recommendation)}</span>
								</div>
								<div className="flex items-baseline justify-between gap-3 border-t border-public-line pt-3">
									<span className="text-public-ink">{t("Total")}</span>
									<span className="text-2xl font-light text-public-ink">
										{recommendation.plan === 'enterprise' ? t("Let's talk") : t('{price} a month', { price: planPrice(recommendation) })}
									</span>
								</div>
								<div className="mt-2 grid gap-2">
									{recommendation.plan === 'basic' && (
										<StartBuildingButton variant="blue" />
									)}
									{(recommendation.plan === 'pro' || recommendation.plan === 'premium') &&
										(billing ? (
											<>
												<PlanButton i18n={publicTranslator()} plan={recommendation.plan} />
												{recommendation.plan === 'premium' && recommendation.extraCredits > 0 && (
													<p className="text-center text-xs text-public-muted">{t("Buy extra credits from your billing page. The same credit price applies to every plan.")}</p>
												)}
											</>
										) : (
											<>
												<PillLink to={contactPath(recommendation.plan, needed)} variant="charcoal">{t('Get {plan}', { plan: recommendedName })}
												</PillLink>
												<p className="text-center text-xs text-public-muted">{t('Contact us to activate {plan}.', { plan: recommendedName })}</p>
											</>
										))}
									<PillLink to={contactPath('enterprise')} variant={recommendation.plan === 'enterprise' ? 'charcoal' : 'outline-on-light'}>{t("Talk to sales")}</PillLink>
								</div>
							</div>
						</div>
					) : (
						<div className="rounded-[20px] bg-[#eef4ff] px-6 py-10 ring-1 ring-[#c9dbff]">
							<p className="text-[15px] text-public-muted">{t("Working out your plan…")}</p>
						</div>
					)}
					<p className="mt-4 text-xs leading-relaxed text-public-muted">{t("Prices are in US dollars and exclude any applicable taxes. This is a recommendation based on your inputs: actual credit use depends on the model, the size of your stores and how you work with the AI.")}</p>
				</aside>
			</div>
		</section>
	);
}
