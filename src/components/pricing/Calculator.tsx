import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowCounterClockwiseIcon, CheckCircleIcon, LightbulbIcon } from '@phosphor-icons/react';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { useModelRates } from '@/hooks/use-model-rates';
import { usePublicPlan } from '@/hooks/use-public-plan';
import { contactPath } from '@/lib/contact';
import {
	CREDIT_ACTIONS,
	DAYS_PER_MONTH,
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
import { formatCredits, formatUsd, planById } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { Stepper } from './Stepper';

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
				{title}
			</h2>
			{children}
		</div>
	);
}

/** "2 stores × 30 changes × 32 credits = 1,920 credits a month" for a category, at the chosen rate. */
function Formula({ parts, total }: { parts: readonly string[]; total: number }) {
	return (
		<p className="mt-3 font-mono text-[12px] text-public-muted">
			{parts.join(' × ')} = {formatCredits(total)} credits a month
		</p>
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
				<span className="text-[17px] text-public-ink">{action.name}</span>
				{action.capability && <CapabilityTag id={action.capability} />}
				<span className="ml-auto rounded-full bg-white px-3 py-1 text-[13px] text-public-ink ring-1 ring-public-line">
					{formatCredits(on ? creditsFor(action.id, usage) : 0)} credits a month
				</span>
			</label>
			{on && <div className="grid gap-3 px-5 py-4">{children}</div>}
		</div>
	);
}

/** The plan's monthly price as one short figure. */
function planPrice(recommendation: Recommendation): string {
	if (recommendation.plan === 'basic') return '$0';
	if (recommendation.plan === 'premium') return formatUsd(recommendation.tier.priceCents);
	return 'Custom';
}

/**
 * Apollo's pricing calculator, for stores: how many stores, which model, and a typical month by category on the left;
 * the plan that covers it, pinned on the right.
 */
export function Calculator() {
	const { models, defaultModel } = useModelRates();
	const plan = usePublicPlan();
	const [modelId, setModelId] = useState<string | null>(null);
	const [amounts, setAmounts] = useState<Amounts>(() => typicalAmounts(1));
	const recommendationRef = useRef<HTMLElement>(null);

	const model = models.find((entry) => entry.id === modelId) ?? defaultModel;
	const usage: Usage = { ...amounts, creditsPerStep: model?.creditCost ?? 0 };
	const freeMonthly = plan.data?.aiCreditsPerDay != null ? plan.data.aiCreditsPerDay * DAYS_PER_MONTH : null;
	const needed = monthlyCredits(usage);
	const recommendation = recommendPlan(needed, freeMonthly);
	const included = recommendation.plan === 'basic' ? (freeMonthly ?? 0) : recommendation.plan === 'premium' ? recommendation.tier.credits : needed;
	const fill = included > 0 ? Math.min(1, needed / included) : 0;
	const recommendedName = planById(recommendation.plan).name;
	// Until the live rates and the free allowance arrive, any recommendation would be a guess.
	const ready = models.length > 0 && !plan.isPending;

	const update = (change: Partial<Amounts>) => setAmounts((current) => ({ ...current, ...change }));
	const toggle = (category: UsageCategory, on: boolean) => setAmounts((current) => ({ ...current, categories: { ...current.categories, [category]: on } }));
	const setStores = (stores: number) => setAmounts((current) => ({ ...typicalAmounts(stores), categories: current.categories }));
	const each = (category: UsageCategory) => actionCredits(actionById(category), usage.creditsPerStep);

	return (
		<section className="bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28">
			<div className="mx-auto max-w-3xl text-center">
				<h1 className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>Find the plan that fits your stores</h1>
				<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>
					Tell us how you'll use Estori and we'll recommend a plan, based on the credits a typical month would take.
				</p>
			</div>
			<div className="mx-auto mt-14 grid max-w-[1248px] grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
				<div className="grid content-start gap-12">
					<div>
						<StepHeading number={1} title="Start with your stores">
							<button
								type="button"
								onClick={() => {
									setModelId(null);
									setAmounts(typicalAmounts(1));
								}}
								className="inline-flex items-center gap-1.5 text-[15px] text-public-ink underline underline-offset-4"
							>
								<ArrowCounterClockwiseIcon className="size-4" aria-hidden />
								Start over
							</button>
						</StepHeading>
						<div className="mt-5 rounded-[16px] px-5 py-4 ring-1 ring-public-line">
							<Stepper label="How many stores will you run?" noun="stores" value={amounts.stores} onChange={setStores} min={1} max={500} />
						</div>
					</div>

					<div>
						<StepHeading number={2} title="Choose your AI model" />
						<fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
							<legend className="sr-only">AI model</legend>
							{models.length === 0 && <p className="text-[15px] text-public-muted">Loading the models…</p>}
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
											{entry.id === defaultModel?.id && <span className="ml-2 text-[12px] text-public-muted">Default</span>}
										</span>
										<span className="block text-[13px] text-public-muted">{entry.creditCost} credits per AI step</span>
									</span>
								</label>
							))}
						</fieldset>
					</div>

					<div>
						<StepHeading number={3} title="Adjust your monthly usage" />
						<p className="mt-5 flex items-start gap-3 rounded-[14px] bg-[#fdf8ec] px-4 py-3 text-[14px] text-public-ink">
							<LightbulbIcon className="mt-0.5 size-5 shrink-0 text-[#b5651d]" aria-hidden />
							<span>
								These are typical amounts for {amounts.stores} {amounts.stores === 1 ? 'store' : 'stores'}. Adjust anything below to match your
								plans.
							</span>
						</p>
						<div className="mt-4 grid gap-3">
							{CREDIT_ACTIONS.map((action) => (
								<CategoryCard key={action.id} action={action} usage={usage} onToggle={(on) => toggle(action.id, on)}>
									{action.id === 'build' && (
										<>
											<Stepper label="New stores built this month" noun="new stores" value={amounts.newStores} onChange={(newStores) => update({ newStores })} max={500} />
											<Formula parts={[`${amounts.newStores} stores`, `${formatCredits(each('build'))} credits`]} total={creditsFor('build', usage)} />
										</>
									)}
									{action.id === 'change' && (
										<>
											<Stepper
												label="Changes per store each month"
												noun="changes"
												value={amounts.changesPerStore}
												onChange={(changesPerStore) => update({ changesPerStore })}
												step={5}
												max={2_000}
											/>
											<Formula
												parts={[`${amounts.stores} stores`, `${amounts.changesPerStore} changes`, `${formatCredits(each('change'))} credits`]}
												total={creditsFor('change', usage)}
											/>
										</>
									)}
									{action.id === 'assistant' && (
										<>
											<Stepper
												label="Assistant tasks per store each month"
												noun="tasks"
												value={amounts.assistantTasksPerStore}
												onChange={(assistantTasksPerStore) => update({ assistantTasksPerStore })}
												step={10}
												max={20_000}
											/>
											<Formula
												parts={[`${amounts.stores} stores`, `${amounts.assistantTasksPerStore} tasks`, `${formatCredits(each('assistant'))} credits`]}
												total={creditsFor('assistant', usage)}
											/>
										</>
									)}
									{action.id === 'personalization' && (
										<>
											<Stepper
												label="Shopper visits per store each month"
												noun="visits"
												value={amounts.visitsPerStore}
												onChange={(visitsPerStore) => update({ visitsPerStore })}
												step={500}
												max={1_000_000}
											/>
											<Formula
												parts={[`${amounts.stores} stores`, `${formatCredits(amounts.visitsPerStore / 1_000)} thousand visits`, `${formatCredits(each('personalization'))} credits`]}
												total={creditsFor('personalization', usage)}
											/>
										</>
									)}
								</CategoryCard>
							))}
						</div>
					</div>
					{/* Phone summary: pinned to the bottom of the screen while the inputs scroll, then settles above the panel. */}
					{ready && (
						<div className="sticky bottom-0 z-10 -mx-4 border-t border-[#c9dbff] bg-[#eef4ff]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
							<div className="flex items-center justify-between gap-3">
								<p className="min-w-0 text-public-ink">
									<span className="block font-mono text-[11px] tracking-[0.08em] text-public-muted uppercase">We recommend</span>
									<span className="text-lg">{recommendedName}</span>
									<span className="text-sm text-public-muted"> · {formatCredits(needed)} credits a month</span>
								</p>
								<button
									type="button"
									onClick={() => recommendationRef.current?.scrollIntoView({ block: 'start' })}
									className="shrink-0 rounded-full bg-public-charcoal px-4 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue"
								>
									{planPrice(recommendation)}
									<span className="sr-only">, see the recommended plan</span>
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
									<p className="font-mono text-[12px] tracking-[0.08em] text-public-ink uppercase">We recommend</p>
									<Link to="/pricing#compare" className="rounded-full px-3 py-1 text-[13px] text-public-ink ring-1 ring-public-ink hover:bg-white">
										Compare plans
									</Link>
								</div>
								<div aria-live="polite">
									<p className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink">{recommendedName}</p>
									<p className="mt-6 font-mono text-[11px] tracking-[0.08em] text-public-muted uppercase">Credits you need</p>
									<p className="mt-1 text-3xl font-light text-public-ink">
										{formatCredits(needed)}
										<span className="text-base text-public-muted"> a month</span>
									</p>
								</div>
								<div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-[#c9dbff]">
									<div className="h-full rounded-full bg-public-ink transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${fill * 100}%` }} />
								</div>
								<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-public-ink">
									<span>
										{recommendation.plan === 'enterprise'
											? 'Custom credit volume'
											: `${formatCredits(included)} credits a month included in ${recommendedName}`}
									</span>
									<span className="inline-flex items-center gap-1 text-[#14865f]">
										<CheckCircleIcon className="size-4" aria-hidden />
										Usage covered
									</span>
								</div>
								{recommendation.plan !== 'enterprise' && (
									<p className="mt-1 text-[13px] text-public-muted">{formatCredits(Math.max(0, included - needed))} credits left over</p>
								)}
							</div>
							<div className="grid gap-3 px-6 py-5 text-[15px]">
								<div className="flex items-baseline justify-between gap-3">
									<span className="text-public-ink">
										{recommendation.plan === 'basic' && 'Basic, the free daily allowance'}
										{recommendation.plan === 'premium' && `Premium, ${formatCredits(recommendation.tier.credits)} credits a month`}
										{recommendation.plan === 'enterprise' && 'Enterprise, credits and terms for your volume'}
									</span>
									<span className="shrink-0 text-public-ink">{planPrice(recommendation)}</span>
								</div>
								<div className="flex items-baseline justify-between gap-3 border-t border-public-line pt-3">
									<span className="text-public-ink">Total</span>
									<span className="text-2xl font-light text-public-ink">
										{recommendation.plan === 'basic' && '$0 a month'}
										{recommendation.plan === 'premium' && `${formatUsd(recommendation.tier.priceCents)} a month`}
										{recommendation.plan === 'enterprise' && "Let's talk"}
									</span>
								</div>
								<div className="mt-2 grid gap-2">
									{recommendation.plan === 'basic' && (
										<PillLink to="/#build" variant="blue">
											Start building free
										</PillLink>
									)}
									{recommendation.plan === 'premium' && (
										<>
											<PillLink to={contactPath('premium', recommendation.tier.credits)} variant="charcoal">
												Get Premium
											</PillLink>
											<p className="text-center text-xs text-public-muted">Premium is coming soon. We'll set you up as it opens.</p>
										</>
									)}
									<PillLink to={contactPath('enterprise')} variant={recommendation.plan === 'enterprise' ? 'charcoal' : 'outline-on-light'}>
										Talk to sales
									</PillLink>
								</div>
							</div>
						</div>
					) : (
						<div className="rounded-[20px] bg-[#eef4ff] px-6 py-10 ring-1 ring-[#c9dbff]">
							<p className="text-[15px] text-public-muted">Working out your plan…</p>
						</div>
					)}
					<p className="mt-4 text-xs leading-relaxed text-public-muted">
						Prices are in US dollars and exclude any applicable taxes. This is a recommendation based on your inputs: actual credit use depends on
						the model, the size of your stores and how you work with the AI. Pricing and plan details may change before paid plans launch.
					</p>
				</aside>
			</div>
		</section>
	);
}
