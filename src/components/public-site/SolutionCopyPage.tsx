import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { isEarlyAccessCapability } from '@/api-types';
import type { SolutionCopy } from '@/content/solution-pages';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import type { PageHead } from '@/lib/page-head';
import { cn } from '@/lib/utils';
import { ClosingPanel } from '@/routes/landing/sections';
import { EarlyAccessButton } from './EarlyAccessButton';
import { PillLink, UNDERLINE_FILL } from './primitives';
import { PublicFaq } from './PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from './solution-page';
import { StartBuildingButton } from './StartBuildingButton';

/**
 * A solution or platform page laid out from its copy: the dark hero with the capability's status, its two sections of
 * cards, how it works, its questions and the closing panel. An early-access capability takes requests in the hero and
 * after a sign-in that reloads the page; any other sends visitors to sales.
 */
export function SolutionCopyPage({ head, copy }: { head: PageHead; copy: SolutionCopy }) {
	useEarlyAccessFromUrl();
	const lastSection = copy.sections.length - 1;
	return (
		<div>
			<PageMeta {...head} />
			<SolutionHero
				eyebrow={copy.eyebrow}
				title={copy.title}
				lead={copy.lead}
				tag={copy.capability}
				actions={
					<>
						<StartBuildingButton variant="white" />
						{isEarlyAccessCapability(copy.capability) ? (
							<EarlyAccessButton capability={copy.capability} variant="outline-on-dark" listedClassName="text-white" />
						) : (
							<PillLink to="/contact" variant="outline-on-dark">
								Talk to sales
							</PillLink>
						)}
					</>
				}
			/>
			{copy.sections.map((section, index) => (
				<CardSection key={section.title} eyebrow={section.eyebrow} tag={copy.capability} title={section.title} cards={section.cards}>
					{index === lastSection && copy.more && (
						<Link to={copy.more.to} className={cn('inline-flex items-center gap-2 text-[17px] text-public-ink', UNDERLINE_FILL)}>
							{copy.more.label}
							<ArrowRightIcon className="size-4" aria-hidden />
						</Link>
					)}
				</CardSection>
			))}
			<HowItWorks steps={copy.steps} />
			<PublicFaq items={copy.faq} />
			<ClosingPanel />
		</div>
	);
}
