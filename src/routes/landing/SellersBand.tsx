import { useEffect, useRef, useState } from 'react';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, TextLink } from '@/components/public-site/primitives';
import { SellerArt } from '@/components/public-site/seller-art';
import { SELLER_STORIES, type SellerStory } from '@/content/positioning';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION, type NavItem } from '@/lib/site-nav';
import { cn } from '@/lib/utils';

interface Seller extends SellerStory {
	/** The seller's entry in the menus: its name, description, status and page. */
	item: NavItem;
	forCreators: boolean;
}

const SELLERS: readonly Seller[] = SELLER_STORIES.flatMap((story) => {
	const creator = CREATOR_ITEMS.find((item) => item.to === story.to);
	const item = creator ?? AUDIENCES.find((audience) => audience.to === story.to);
	return item ? [{ ...story, item, forCreators: creator !== undefined }] : [];
});

function IndexEntry({ seller, active }: { seller: Seller; active: boolean }) {
	return (
		<li
			className={cn(
				'-ml-px border-l-2 py-1.5 pl-4 text-[15px] transition-colors duration-300 motion-reduce:transition-none',
				active ? 'border-public-ink text-public-ink' : 'border-transparent text-public-muted',
			)}
		>
			{seller.item.label}
		</li>
	);
}

/**
 * The sellers after brands, as on the scroll-led sections we like: the story of the card in view stays pinned
 * on the left while the cards scroll by on the right.
 */
export function SellersBand() {
	const listRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		// A card becomes the active one as it crosses the middle of the window.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) setActive(Number(entry.target.getAttribute('data-seller')));
				}
			},
			{ rootMargin: '-50% 0px -50% 0px' },
		);
		for (const card of list.querySelectorAll('[data-seller]')) observer.observe(card);
		return () => observer.disconnect();
	}, []);

	const current = SELLERS[active] ?? SELLERS[0];
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
				<div className="lg:sticky lg:top-[calc(var(--public-header-h)+3rem)] lg:self-start">
					<Eyebrow>Solutions</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Estori for every kind of seller</h2>
					{/* Marks the card in view; the cards carry the same names, so screen readers skip it. */}
					<div aria-hidden className="mt-10 hidden lg:block">
						<ol className="grid border-l border-public-line">
							{SELLERS.filter((seller) => !seller.forCreators).map((seller) => (
								<IndexEntry key={seller.id} seller={seller} active={seller === current} />
							))}
						</ol>
						<Eyebrow className="mt-6">For creators</Eyebrow>
						<p className="mt-1 text-[13px] font-light text-public-muted">{CREATORS_CAPTION}</p>
						<ol className="mt-3 grid border-l border-public-line">
							{SELLERS.filter((seller) => seller.forCreators).map((seller) => (
								<IndexEntry key={seller.id} seller={seller} active={seller === current} />
							))}
						</ol>
					</div>
				</div>
				<div ref={listRef} className="grid grid-cols-1 gap-16 lg:gap-28">
					{SELLERS.map((seller, index) => (
						<article
							key={seller.id}
							data-seller={index}
							className={cn('transition-opacity duration-500 motion-reduce:transition-none', index === active ? 'opacity-100' : 'lg:opacity-40')}
						>
							<SellerArt id={seller.id} />
							{seller.forCreators && <Eyebrow className="mt-7">For creators</Eyebrow>}
							<div className={cn('flex flex-wrap items-center gap-2', seller.forCreators ? 'mt-2' : 'mt-7')}>
								<h3 className={cn(HEADING_CARD, 'text-public-ink')}>{seller.item.label}</h3>
								{seller.item.capability && <CapabilityTag id={seller.item.capability} />}
							</div>
							<p className="mt-3 text-[17px] font-light text-public-muted">{seller.item.description}</p>
							{/* On phones nothing is pinned beside the card, so it tells its own story. */}
							<p className={cn(LEAD, 'mt-4 text-pretty text-public-muted lg:hidden')}>{seller.story}</p>
							<TextLink to={seller.item.to} className="mt-5">
								Learn more
							</TextLink>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
