import { t } from '@/lib/i18n';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { useFitZoom } from '@/hooks/use-fit-zoom';
import { cn } from '@/lib/utils';

/**
 * A picture drawn `width` by `height` and zoomed to its container's width, so it scales like an image instead
 * of reflowing; the bottom is cut off by the container's edge. Decorative: the text beside it carries the meaning.
 */
export function ArtCanvas({ width, height, className, children }: { width: number; height: number; className?: string; children: ReactNode }) {
	const [ref, zoom] = useFitZoom<HTMLDivElement>(width);
	return (
		// Inline-size containment keeps the drawing's width out of the container's minimum width, so a grid column can still shrink to a phone.
		<div ref={ref} aria-hidden className={cn('overflow-hidden [contain:inline-size]', className)} style={{ height: height * zoom }}>
			<div className="mx-auto" style={{ width, zoom }}>
				{children}
			</div>
		</div>
	);
}

/** The root of a picture whose story plays while it is on screen. */
export function StoryFrame({ storyRef, className, children }: { storyRef: Ref<HTMLDivElement>; className?: string; children: ReactNode }) {
	return (
		<div ref={storyRef} className={cn('pt-2 text-left text-[#1d1d21]', className)}>
			{children}
		</div>
	);
}

export function Photo({ src, className, style }: { src: string; className?: string; style?: CSSProperties }) {
	return <img src={src} alt="" loading="lazy" decoding="async" className={cn('shrink-0 object-cover', className)} style={style} />;
}

/** A labeled row in a field group, as in a 1Password item. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="px-5 py-3">
			<p className="text-[14px] text-public-blue">{t(label)}</p>
			<div className="mt-0.5 text-[17px]">{children}</div>
		</div>
	);
}

/** The green ring 1Password draws beside a strong password; drawn in when it appears. */
export function GreenRing() {
	return (
		<svg viewBox="0 0 24 24" className="size-6 shrink-0">
			<circle cx="12" cy="12" r="9" fill="none" stroke="#17a317" strokeWidth="3.5" pathLength={1} strokeDasharray="1" className="animate-public-draw" />
		</svg>
	);
}
