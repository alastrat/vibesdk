import { ChatCircleTextIcon, CoinsIcon, RobotIcon, SparkleIcon, StorefrontIcon, type Icon } from '@phosphor-icons/react';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { useModelRates } from '@/hooks/use-model-rates';
import { CREDIT_ACTIONS, actionCreditsRange, type CreditAction, type UsageCategory } from '@/lib/credits';
import { formatCredits } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { Coin } from './Coin';

const ICONS: Readonly<Record<UsageCategory, Icon>> = {
	build: StorefrontIcon,
	change: ChatCircleTextIcon,
	assistant: RobotIcon,
	personalization: SparkleIcon,
};

/** "about 480 to 13,350 credits per store" across the models, or the steps while the models load. */
function costLabel(action: CreditAction, rates: readonly number[]): string {
	if (action.steps !== undefined && rates.length === 0) return `${action.steps} AI steps per ${action.unit}`;
	const { min, max } = actionCreditsRange(action, rates);
	const amount = min === max ? formatCredits(min) : `${formatCredits(min)} to ${formatCredits(max)}`;
	return `about ${amount} credits per ${action.unit}`;
}

function CreditCard({ action, rates }: { action: CreditAction; rates: readonly number[] }) {
	const Glyph = ICONS[action.id];
	return (
		<li className="relative">
			{/* The dashed branch from the trunk to this card, ending in a dot. */}
			<span aria-hidden className="absolute top-1/2 -left-12 hidden w-12 border-t-2 border-dashed border-[#c5cad3] lg:block" />
			<span aria-hidden className="absolute top-1/2 -left-[5px] hidden size-2.5 -translate-y-1/2 rounded-full bg-[#9aa3b2] lg:block" />
			<div className="flex gap-4 rounded-[16px] bg-[#f5f6f8] px-5 py-4">
				<Glyph className="mt-0.5 size-6 shrink-0 text-public-ink" aria-hidden />
				<div className="min-w-0">
					<p className="flex flex-wrap items-center gap-2">
						<span className="text-lg text-public-ink">{action.name}</span>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[13px] text-public-muted ring-1 ring-public-line">
							<CoinsIcon className="size-3.5" aria-hidden />
							{costLabel(action, rates)}
						</span>
						{action.capability && <CapabilityTag id={action.capability} />}
					</p>
					<p className="mt-1.5 text-[15px] font-light text-public-muted">{action.description}</p>
				</div>
			</div>
		</li>
	);
}

/** Apollo's credits explainer: what credits are on the left, a coin, and what each action costs, joined by dashed lines. */
export function CreditsExplainer() {
	const { rates } = useModelRates();
	return (
		<section id="credits" aria-labelledby="credits-title" className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,7fr)] lg:gap-0">
				<div className="lg:pr-10">
					<h2 id="credits-title" className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>
						What are Estori credits?
					</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>
						Credits pay for the AI's work: building your stores, changing them by chatting, and soon the assistants and personalization that help run them.
					</p>
					<PillLink to="/pricing/calculator" variant="charcoal" className="mt-8">
						Calculate my credit needs
					</PillLink>
				</div>
				<div className="relative hidden lg:block">
					<Coin className="mx-auto w-[150px]" />
					{/* From the coin to the trunk of the list. */}
					<span aria-hidden className="absolute top-1/2 right-0 w-8 border-t-2 border-dashed border-[#c5cad3]" />
				</div>
				<div className="relative lg:pl-12">
					{/* The trunk joining every card's branch. */}
					<span aria-hidden className="absolute top-10 bottom-10 left-0 hidden border-l-2 border-dashed border-[#c5cad3] lg:block" />
					<ol className="grid gap-3">
						{CREDIT_ACTIONS.map((action) => (
							<CreditCard key={action.id} action={action} rates={rates} />
						))}
					</ol>
				</div>
			</div>
			<p className="mx-auto mt-10 max-w-[1248px] text-xs text-public-muted">
				Estimates. Each AI step is charged from the work it does, at the price of the model you pick; bigger stores and longer requests take more steps.
			</p>
		</section>
	);
}
