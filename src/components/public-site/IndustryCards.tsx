import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { INDUSTRIES_PATH, industryPath, industryPhotoSrcSet, type Industry } from '@/content/industries';
import { cn } from '@/lib/utils';
import { GROUP_UNDERLINE_GROW } from './primitives';

const CARD = 'group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-public-blue focus-visible:ring-offset-2';
const NAME = 'text-[17px] text-public-ink group-hover:text-public-blue';

/** Industry photo cards, two across on phones and four on wide screens; `showAll` ends the grid with a link to every industry. */
export function IndustryCards({ industries, showAll = false }: { industries: readonly Industry[]; showAll?: boolean }) {
	return (
		<ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
			{industries.map((industry) => (
				<li key={industry.slug}>
					<Link to={industryPath(industry.slug)} className={CARD}>
						<span className="block overflow-hidden rounded-2xl bg-[#f4f6fb]">
							<img
								src={industry.photo.src}
								srcSet={industryPhotoSrcSet(industry.photo)}
								sizes="(min-width: 1024px) 300px, 50vw"
								width={1200}
								height={800}
								loading="lazy"
								alt=""
								className="aspect-[3/2] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
							/>
						</span>
						<span className="mt-3 block">
							<span className={cn(NAME, GROUP_UNDERLINE_GROW)}>{industry.name}</span>
						</span>
					</Link>
				</li>
			))}
			{showAll && (
				<li>
					<Link to={INDUSTRIES_PATH} className={CARD}>
						<span className="flex aspect-[3/2] items-center justify-center rounded-2xl bg-[#f4f6fb] text-public-ink transition-colors group-hover:text-public-blue">
							<ArrowRightIcon className="size-8" aria-hidden />
						</span>
						<span className="mt-3 block">
							<span className={cn(NAME, GROUP_UNDERLINE_GROW)}>All industries</span>
						</span>
					</Link>
				</li>
			)}
		</ul>
	);
}
