import { useState, type ReactNode } from 'react';
import { CaretDownIcon, CheckIcon, MinusIcon } from '@phosphor-icons/react';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { HEADING_SECTION, PillLink } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePublicPlan } from '@/hooks/use-public-plan';
import { CAPABILITIES, STATUS_LABELS, type CapabilityId } from '@/lib/capabilities';
import { contactPath } from '@/lib/contact';
import { PLANS, PLAN_COMPARISON, PREMIUM_TIERS, formatCredits, formatUsd, type Plan, type PlanCell, type PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';

const SMALLEST = PREMIUM_TIERS[0];
const LARGEST = PREMIUM_TIERS[PREMIUM_TIERS.length - 1];

const ACTION = 'mt-4 w-full py-2 text-sm';

/** What each column header shows under the plan's name, and its button: sign up for Basic, contact sales otherwise. */
const HEADERS: Readonly<Record<PlanId, { price: string; note: string; action: ReactNode }>> = {
	basic: {
		price: '$0',
		note: 'Free forever',
		action: (
			<StartBuildingButton variant="blue" className={ACTION}>
				Start building
			</StartBuildingButton>
		),
	},
	premium: {
		price: `From ${formatUsd(SMALLEST.priceCents)}`,
		note: `${formatCredits(SMALLEST.credits)} to ${formatCredits(LARGEST.credits)} credits a month`,
		action: (
			<PillLink to={contactPath('premium')} variant="charcoal" className={ACTION}>
				Get Premium
			</PillLink>
		),
	},
	enterprise: {
		price: 'Custom',
		note: 'Volume credits and terms',
		action: (
			<PillLink to={contactPath('enterprise')} variant="outline-on-light" className={ACTION}>
				Talk to sales
			</PillLink>
		),
	},
};

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

function Row({
	label,
	note,
	plans,
	cells,
	hidden,
}: {
	label: string;
	note?: string;
	plans: readonly Plan[];
	cells: Readonly<Record<PlanId, PlanCell>>;
	hidden: boolean;
}) {
	return (
		<tr hidden={hidden}>
			<th scope="row" className="border-b border-public-line py-4 pr-4 pl-4 text-left font-light text-public-ink">
				{label}
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
export function ComparePlans() {
	const plan = usePublicPlan();
	const isPhone = useIsMobile();
	const [phonePlan, setPhonePlan] = useState<PlanId>('premium');
	const shown = isPhone ? PLANS.filter((entry) => entry.id === phonePlan) : PLANS;
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const freeCredits = plan.data?.aiCreditsPerDay == null ? 'A daily allowance' : `${formatCredits(plan.data.aiCreditsPerDay)} a day`;
	const toggle = (title: string) =>
		setFolded((current) => {
			const next = new Set(current);
			if (next.has(title)) next.delete(title);
			else next.add(title);
			return next;
		});

	return (
		<section id="compare" aria-labelledby="compare-title" className="scroll-mt-36 bg-white px-4 py-16 sm:px-6 sm:py-20">
			<div className="mx-auto max-w-[1248px]">
				<h2 id="compare-title" className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>
					Compare plans
				</h2>
				{/* No scrolling box around the table: it would stop the headers from pinning to the page. */}
				<div className="relative mt-10">
					<table className="w-full table-fixed border-separate border-spacing-0 text-[15px]">
						<caption className="sr-only">What each plan includes</caption>
						<thead>
							<tr>
								<td className="sticky top-[var(--public-header-h)] z-10 w-1/2 bg-white pr-3 pb-5 align-bottom md:w-[34%]">
									{isPhone && (
										<div className="relative">
											<select
												aria-label="Plan to compare"
												value={phonePlan}
												onChange={(event) => {
													const next = PLANS.find((entry) => entry.id === event.target.value);
													if (next) setPhonePlan(next.id);
												}}
												className="w-full cursor-pointer appearance-none rounded-xl bg-[#f5f6f8] py-2.5 pr-8 pl-3 text-sm text-public-ink outline-none focus-visible:ring-2 focus-visible:ring-public-blue"
											>
												{PLANS.map((entry) => (
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
									const header = HEADERS[entry.id];
									return (
										<th
											key={entry.id}
											scope="col"
											className="sticky top-[var(--public-header-h)] z-10 border-b border-l border-public-line bg-white px-3 pt-3 pb-5 text-left align-top font-normal lg:px-5"
										>
											<span className="block text-lg text-public-ink">{entry.name}</span>
											<span className="mt-2 block text-3xl font-light tracking-[-0.02em] text-public-ink">{header.price}</span>
											<span className="mt-2 block min-h-10 text-[13px] font-light text-public-muted">{header.note}</span>
											{header.action}
										</th>
									);
								})}
							</tr>
						</thead>
						{PLAN_COMPARISON.map((section, sectionIndex) => {
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
									{section.capability === 'store-builder' && (
										<Row
											label="AI credits"
											hidden={isFolded}
											plans={shown}
											cells={{
												basic: freeCredits,
												premium: `${formatCredits(SMALLEST.credits)} to ${formatCredits(LARGEST.credits)} a month`,
												enterprise: 'Custom',
											}}
										/>
									)}
									{section.rows.map((row) => (
										<Row
											key={row.label}
											label={row.label}
											note={statusNote(section.capability)}
											hidden={isFolded}
											plans={shown}
											cells={row.cells}
										/>
									))}
								</tbody>
							);
						})}
					</table>
				</div>
			</div>
		</section>
	);
}
