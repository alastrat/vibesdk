import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Tooltip, TooltipProvider } from '@cloudflare/kumo';
import { marketingCopy, formatMarketingCopy } from '@/content/marketing-copy';
import { CaretDownIcon, CheckIcon, InfoIcon, MinusIcon } from '@phosphor-icons/react';
import { PlanButton } from '@/components/billing/PlanButton';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PillLink } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { useIsMobile } from '@/hooks/use-mobile';
import { CAPABILITIES, STATUS_LABELS, type CapabilityId } from '@/lib/capabilities';
import { contactPath } from '@/lib/contact';
import { planPriceCents, type BillingInterval, type PaidPlanId, formatCredits } from '@/api-types';
import { comparisonFor, formatUsd, planById, type Plan, type PlanCell, type PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';

const ACTION = 'mt-4 w-full py-2 text-sm';

interface Header {
	price: string;
	note: string;
	action: ReactNode;
}

/** What each column header shows under the plan's name, and its button: sign up for Basic, buy Pro and Premium once billing is on, contact sales otherwise. */
function headerFor(id: PlanId, billing: boolean, interval: BillingInterval, monthlyCredits?: number): Header {
	switch (id) {
		case 'basic':
			return {
				price: '$0',
				note: 'Free forever',
				action: (
					<StartBuildingButton variant="blue" className={ACTION}>
						Start building
					</StartBuildingButton>
				),
			};
		case 'pro':
		case 'premium':
			return {
				price: `${formatUsd(planPriceCents(id, interval, monthlyCredits) / (interval === 'year' ? 12 : 1))}/mo`,
				note: interval === 'year' ? formatMarketingCopy(marketingCopy.pricing.billing.yearlyNote, { amount: formatUsd(planPriceCents(id, interval, monthlyCredits)) }) : marketingCopy.pricing.plans[id].headerNote,
				action: billing ? (
					<PlanButton plan={id} billingInterval={interval} monthlyCredits={monthlyCredits} className={ACTION} />
				) : (
					<PillLink to={contactPath(id)} variant="charcoal" className={ACTION}>
						Get {planById(id).name}
					</PillLink>
				),
			};
		case 'enterprise':
			return {
				price: 'Custom',
				note: 'Volume credits and terms',
				action: (
					<PillLink to={contactPath('enterprise')} variant="outline-on-light" className={ACTION}>
						Talk to sales
					</PillLink>
				),
			};
	}
}

function Cell({ value }: { value: PlanCell }) {
	if (value === true) {
		return (
			<>
				<CheckIcon className="mx-auto size-4 text-public-blue" weight="bold" aria-hidden />
				<span className="sr-only">Included</span>
			</>
		);
	}
	if (value === false) {
		return (
			<>
				<MinusIcon className="mx-auto size-4 text-public-muted" aria-hidden />
				<span className="sr-only">Not included</span>
			</>
		);
	}
	return <>{value}</>;
}

/** The status a screen reader hears with each row of a capability that isn't available yet. */
function statusNote(capability: CapabilityId | null): string | undefined {
	if (!capability) return undefined;
	const { status } = CAPABILITIES[capability];
	return status === 'available' ? undefined : STATUS_LABELS[status];
}

/** Kumo handles hover, focus, Escape and outside dismissal; a press also opens help on touch screens. */
function FeatureHelp({ label, description }: { label: string; description: string }) {
	const [open, setOpen] = useState(false);
	return (
		<Tooltip
			open={open}
			onOpenChange={(next, details) => {
				if (details.reason !== 'trigger-press') setOpen(next);
			}}
			delay={150}
			side="top"
			content={<span className="block max-w-64 text-left font-normal leading-relaxed">{description}</span>}
			render={
				<button
					type="button"
					aria-label={formatMarketingCopy(marketingCopy.pricing.comparison.featureHelp, { feature: label })}
					onClick={() => setOpen(true)}
					className="ml-1 inline-flex size-6 cursor-help align-middle sm:size-8 items-center justify-center rounded-full text-public-muted transition-colors hover:bg-[#eef0f3] hover:text-public-blue focus-visible:outline-2 focus-visible:outline-public-blue"
				>
					<InfoIcon className="size-4" aria-hidden />
				</button>
			}
		/>
	);
}

function Row({
	label,
	description,
	note,
	plans,
	cells,
	hidden,
}: {
	label: string;
	description: string;
	note?: string;
	plans: readonly Plan[];
	cells: Readonly<Record<PlanId, PlanCell>>;
	hidden: boolean;
}) {
	return (
		<tr hidden={hidden}>
			<th scope="row" className="border-b border-public-line py-4 pr-4 pl-4 text-left font-light text-public-ink">
				<span className="block">
					<span>{label}</span>
					<FeatureHelp label={label} description={description} />
				</span>
				{note && <span className="sr-only">, {note}</span>}
			</th>
			{plans.map((entry) => (
				<td key={entry.id} className="border-b border-l border-public-line px-3 py-4 text-center text-public-muted">
					<Cell value={cells[entry.id]} />
				</td>
			))}
		</tr>
	);
}

/**
 * Apollo's comparison: the plan headers stay pinned under the top bar while the rows scroll by, and each group of
 * rows folds away. Phones show one plan at a time beside the labels, picked from the corner of the header.
 */
export function ComparePlans({ billing, interval = 'month', credits = {} }: { billing: boolean; interval?: BillingInterval; credits?: Partial<Record<PaidPlanId, number>> }) {
	const isPhone = useIsMobile();
	const { plans, sections } = comparisonFor();
	// Phones open on Pro; the picker offers all three self-service plans.
	const [picked, setPicked] = useState<PlanId | null>(null);
	const phonePlan = plans.find((entry) => entry.id === picked)?.id ?? 'pro';
	const shown = isPhone ? plans.filter((entry) => entry.id === phonePlan) : plans;
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const toggle = (title: string) =>
		setFolded((current) => {
			const next = new Set(current);
			if (next.has(title)) next.delete(title);
			else next.add(title);
			return next;
		});

	return (
		<TooltipProvider>
			<section id="compare" aria-labelledby="compare-title" className="scroll-mt-36 bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto max-w-[1248px]">
					{/* No scrolling box around the table: it would stop the headers from pinning to the page. */}
					<div className="relative">
						<table className="w-full table-fixed border-separate border-spacing-0 text-[15px]">
							<caption className="sr-only">{marketingCopy.pricing.comparison.caption}</caption>
							<thead>
								<tr>
									{/* The heading sits in the header's corner, beside the plans, and stays pinned with them. */}
									<td className="sticky top-[var(--public-header-h)] z-10 w-1/2 bg-white pt-3 pr-3 pb-5 align-top md:w-[34%]">
										<h2 id="compare-title" className="text-[32px] leading-[1.1] font-light tracking-[-0.02em] text-balance text-public-ink lg:text-[48px]">
											{marketingCopy.pricing.comparison.title}
										</h2>
										{isPhone && (
											<div className="relative mt-4">
												<select
													aria-label="Plan to compare"
													value={phonePlan}
													onChange={(event) => {
														const next = plans.find((entry) => entry.id === event.target.value);
														if (next) setPicked(next.id);
													}}
													className="w-full cursor-pointer appearance-none rounded-xl bg-[#f5f6f8] py-2.5 pr-8 pl-3 text-sm text-public-ink outline-none focus-visible:ring-2 focus-visible:ring-public-blue"
												>
													{plans.map((entry) => (
														<option key={entry.id} value={entry.id}>
															{entry.name}
														</option>
													))}
												</select>
												<CaretDownIcon className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-public-muted" aria-hidden />
											</div>
										)}
									</td>
									{shown.map((entry) => {
										const header = headerFor(entry.id, billing, interval, entry.id === 'pro' || entry.id === 'premium' ? credits[entry.id] : undefined);
										return (
											<th
												key={entry.id}
												scope="col"
												className="sticky top-[var(--public-header-h)] z-10 border-b border-l border-public-line bg-white px-3 pt-3 pb-5 text-left align-top font-normal lg:px-5"
											>
												<span className="flex flex-wrap items-center gap-2 text-lg text-public-ink">
													{entry.name}
												</span>
												<span className="mt-2 block text-3xl font-light tracking-[-0.02em] text-public-ink">{header.price}</span>
												<span className="mt-2 block min-h-10 text-[13px] font-light text-public-muted">{header.note}</span>
												{header.action}
											</th>
										);
									})}
								</tr>
							</thead>
							{sections.map((section, sectionIndex) => {
								const isFolded = folded.has(section.title);
								const rowsId = `compare-rows-${sectionIndex}`;
								return (
									<tbody key={section.title} id={rowsId}>
										<tr>
											<th scope="rowgroup" colSpan={shown.length + 1} className="pt-6 pb-2 text-left font-normal">
												<button
													type="button"
													aria-expanded={!isFolded}
													aria-controls={rowsId}
													onClick={() => toggle(section.title)}
													className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#f5f6f8] px-4 py-3 text-left text-public-ink transition-colors hover:bg-[#eef0f3] focus-visible:outline-2 focus-visible:outline-public-blue"
												>
													<span className="inline-flex flex-wrap items-center gap-2 text-lg">
														{section.title}
														{section.capability && <CapabilityTag id={section.capability} />}
													</span>
													<CaretDownIcon className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', !isFolded && 'rotate-180')} aria-hidden />
												</button>
											</th>
										</tr>
										{section.rows.map((row) => (
											<Row
												key={row.id}
												label={row.label}
												description={row.description}
												note={statusNote(section.capability)}
												hidden={isFolded}
												plans={shown}
												cells={row.id === 'aiCredits' ? { ...row.cells, ...(credits.pro !== undefined ? { pro: `${formatCredits(credits.pro)}/mo` } : {}), ...(credits.premium !== undefined ? { premium: `${formatCredits(credits.premium)}/mo` } : {}) } : row.cells}
											/>
										))}
										{section.details && (
											<tr hidden={isFolded}>
												<td colSpan={shown.length + 1} className="px-4 py-4 text-sm text-public-muted">
													<Link to={section.details.href} className="underline underline-offset-4 hover:text-public-blue">{section.details.label} →</Link>
												</td>
											</tr>
										)}
									</tbody>
								);
							})}
						</table>
					</div>
				</div>
			</section>
		</TooltipProvider>
	);
}
