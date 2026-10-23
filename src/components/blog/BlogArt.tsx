import { t } from '@/lib/i18n';
import { formatUsd } from '@/lib/i18n/public-pricing';
import type { ReactElement } from 'react';
import type { BlogArtId } from '@/content/blog';
import { cn } from '@/lib/utils';

/** Discover: a store in a browser window on the blue Estori field, with its listing card beside it. */
function DiscoverArt() {
	return (
		<>
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.28),transparent_45%)]" />
			<div className="absolute top-[14%] left-[8%] w-[70%] overflow-hidden rounded-[2.2cqw] bg-white shadow-[0_3cqw_6cqw_rgba(5,18,60,0.45)]">
				<div className="flex items-center gap-[0.8cqw] bg-[#eef1f6] px-[1.6cqw] py-[1.2cqw]">
					<span className="size-[1.1cqw] rounded-full bg-[#ff6b5f]" />
					<span className="size-[1.1cqw] rounded-full bg-[#ffbd2e]" />
					<span className="size-[1.1cqw] rounded-full bg-[#28c840]" />
				</div>
				<img src="/marketing/hero-store.jpg" alt="" className="block w-full" />
			</div>
			<div className="absolute right-[6%] bottom-[12%] w-[30%] rounded-[2cqw] bg-white p-[2.2cqw] shadow-[0_2.4cqw_5cqw_rgba(5,18,60,0.4)]">
				<p className="text-[1.5cqw] tracking-[0.08em] text-public-muted uppercase">{t('In Discover')}</p>
				<p className="mt-[0.8cqw] text-[2.4cqw] leading-tight text-public-ink">North Ridge Coffee</p>
				<div className="mt-[1.6cqw] flex items-center justify-between gap-[1cqw]">
					<span className="text-[2.6cqw] font-light text-public-ink">{formatUsd(2900)}</span>
					<span className="rounded-full bg-public-blue px-[1.6cqw] py-[0.8cqw] text-[1.5cqw] text-white">{t('Use this store')}</span>
				</div>
			</div>
		</>
	);
}

const ART: Readonly<Record<BlogArtId, () => ReactElement>> = { discover: DiscoverArt };

/** A post's drawing, filling the box it's given; sizes inside follow the box's width, so cards and heroes match. */
export function BlogArt({ id, className }: { id: BlogArtId; className?: string }) {
	const Art = ART[id];
	return (
		<div aria-hidden className={cn('@container relative overflow-hidden bg-[linear-gradient(135deg,#1f5bff_0%,#143fae_55%,#0b1f5c_100%)]', className)}>
			<Art />
		</div>
	);
}
