import { t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import { ChatCircleTextIcon, ImageIcon, MagnifyingGlassIcon, PencilLineIcon, RobotIcon, SparkleIcon, StorefrontIcon, TranslateIcon, type Icon } from '@phosphor-icons/react';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import type { CapabilityId } from '@/lib/capabilities';
import { cn } from '@/lib/utils';
import { Coin } from './Coin';

interface CreditUseCard {
	id: keyof typeof marketingCopy.pricing.credits.cards;
	icon: Icon;
	capability?: CapabilityId;
	comingSoon?: boolean;
}

const CREDIT_CARDS: readonly CreditUseCard[] = [
	{ id: 'build', icon: StorefrontIcon },
	{ id: 'change', icon: ChatCircleTextIcon },
	{ id: 'content', icon: PencilLineIcon },
	{ id: 'translation', icon: TranslateIcon },
	{ id: 'images', icon: ImageIcon, comingSoon: true },
	{ id: 'assistant', icon: RobotIcon, capability: 'operations-agents' },
	{ id: 'research', icon: MagnifyingGlassIcon, comingSoon: true },
	{ id: 'optimization', icon: SparkleIcon, comingSoon: true },
];

function CreditCard({ card, first, last }: { card: CreditUseCard; first: boolean; last: boolean }) {
	const Glyph = card.icon;
	const copy = marketingCopy.pricing.credits.cards[card.id];
	return (
		<li className="relative">
			{/* Each row joins the trunk at its center, so different card heights stay connected. */}
			<span aria-hidden className={cn('pointer-events-none absolute -left-12 hidden border-l-2 border-dashed border-[#c5cad3] lg:block', first ? 'top-1/2' : '-top-3', last ? 'bottom-1/2' : '-bottom-3')} />
			<span aria-hidden className="pointer-events-none absolute top-1/2 -left-12 hidden w-12 border-t-2 border-dashed border-[#c5cad3] lg:block" />
			<span aria-hidden className="pointer-events-none absolute top-1/2 -left-[5px] hidden size-2.5 -translate-y-1/2 rounded-full bg-[#9aa3b2] lg:block" />
			<div className="flex gap-4 rounded-[16px] bg-[#f5f6f8] px-5 py-4">
				<Glyph className="mt-0.5 size-6 shrink-0 text-public-ink" aria-hidden />
				<div className="min-w-0">
					<p className="flex flex-wrap items-center gap-2">
						<span className="text-lg text-public-ink">{t(copy.title)}</span>
						{card.capability && <CapabilityTag id={card.capability} />}
						{card.comingSoon && <ComingSoon />}
					</p>
					<p className="mt-1.5 text-[15px] font-light text-public-muted">{t(copy.description)}</p>
				</div>
			</div>
		</li>
	);
}

/** A short overview of what credits power; the calculator carries detailed usage estimates. */
export function CreditsExplainer() {
	const copy = marketingCopy.pricing.credits;
	return (
		<section id="credits" aria-labelledby="credits-title" className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,7fr)] lg:gap-0">
				<div className="lg:pr-10">
					<h2 id="credits-title" className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>
						{t(copy.title)}
					</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{t(copy.description)}</p>
					<PillLink to="/pricing/calculator" variant="charcoal" className="mt-8">{t(copy.calculatorLink)}</PillLink>
					<p className="mt-4 max-w-sm text-xs leading-relaxed text-public-muted">{t(copy.usageNote)}</p>
				</div>
				<div className="relative hidden lg:block">
					<Coin className="mx-auto w-[150px]" />
					<span aria-hidden className="pointer-events-none absolute top-1/2 right-0 w-8 border-t-2 border-dashed border-[#c5cad3]" />
				</div>
				<div className="lg:pl-12">
					<ol className="grid gap-3">
						{CREDIT_CARDS.map((card, index) => <CreditCard key={card.id} card={card} first={index === 0} last={index === CREDIT_CARDS.length - 1} />)}
					</ol>
				</div>
			</div>
		</section>
	);
}
