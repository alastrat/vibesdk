import { Eyebrow, HEADING_SECTION } from '@/components/public-site/primitives';
import { LinkCard } from '@/components/public-site/solution-page';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION } from '@/lib/site-nav';
import { cn } from '@/lib/utils';

/** The other audiences, after the brand story: resellers and digital businesses, then the creator programs. */
export function SellersBand() {
	const sellers = AUDIENCES.filter((item) => item.to !== '/solutions/brands');
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow>Solutions</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>Estori for every kind of seller</h2>
				<div className="mt-12 grid gap-4 md:grid-cols-2">
					{sellers.map((item) => (
						<LinkCard key={item.to} item={item} />
					))}
				</div>
				<div className="mt-16">
					<Eyebrow>For creators</Eyebrow>
					<p className="mt-2 text-[15px] font-light text-public-muted">{CREATORS_CAPTION}</p>
				</div>
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					{CREATOR_ITEMS.map((item) => (
						<LinkCard key={item.to} item={item} />
					))}
				</div>
			</div>
		</section>
	);
}
