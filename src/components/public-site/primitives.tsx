import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/** The public pages' type scale, after 1Password: light weights and slightly tight tracking. */
export const HEADING_HERO = 'text-[44px] leading-[1.1] font-light tracking-[-0.02em] sm:text-[88px]';
export const HEADING_SECTION = 'text-4xl leading-[1.1] font-light tracking-[-0.02em] sm:text-[64px]';
export const HEADING_CARD = 'text-2xl leading-[1.12] font-light tracking-[-0.015em] sm:text-[30px]';
export const LEAD = 'text-lg leading-normal font-light sm:text-xl';

/** Smooth scrolling, except for people who asked their system for reduced motion. */
export function preferredScrollBehavior(): ScrollBehavior {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export type PillVariant = 'blue' | 'white' | 'charcoal' | 'outline-on-dark' | 'outline-on-light';

const PILL_BASE =
	'inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-base font-normal whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

const PILL_VARIANTS: Record<PillVariant, string> = {
	blue: 'bg-public-blue text-white hover:bg-public-blue-hover focus-visible:outline-public-blue',
	white: 'bg-white text-public-blue hover:bg-white/90 focus-visible:outline-white',
	charcoal: 'bg-public-charcoal text-white hover:bg-black focus-visible:outline-white',
	'outline-on-dark': 'text-white ring ring-inset ring-white/85 hover:bg-white/10 focus-visible:outline-white',
	'outline-on-light': 'text-public-charcoal ring ring-inset ring-public-charcoal hover:bg-public-charcoal/5 focus-visible:outline-public-charcoal',
};

export function pillClass(variant: PillVariant, className?: string): string {
	return cn(PILL_BASE, PILL_VARIANTS[variant], className);
}

export function PillLink({ to, variant, className, children }: { to: string; variant: PillVariant; className?: string; children: ReactNode }) {
	return (
		<Link to={to} className={pillClass(variant, className)}>
			{children}
		</Link>
	);
}

export function TextLink({ to, tone = 'light', className, children }: { to: string; tone?: 'light' | 'dark'; className?: string; children: ReactNode }) {
	return (
		<Link
			to={to}
			className={cn(
				'inline-block text-[15px] underline decoration-1 underline-offset-[5px] hover:decoration-2',
				tone === 'dark' ? 'text-white' : 'text-public-ink',
				className,
			)}
		>
			{children}
		</Link>
	);
}

export function Eyebrow({ tone = 'light', className, children }: { tone?: 'light' | 'dark'; className?: string; children: ReactNode }) {
	return (
		<p className={cn('text-xs font-normal uppercase tracking-[0.02em]', tone === 'dark' ? 'text-white/80' : 'text-public-ink/80', className)}>
			{children}
		</p>
	);
}

/** Fades the ends of a full-width marquee into the charcoal background; hidden while a link in its `group/edges` wrapper has focus. */
export function EdgeFades() {
	return (
		<>
			<span
				aria-hidden
				className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-public-charcoal to-transparent transition-opacity group-focus-within/edges:opacity-0 sm:w-32"
			/>
			<span
				aria-hidden
				className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-public-charcoal to-transparent transition-opacity group-focus-within/edges:opacity-0 sm:w-32"
			/>
		</>
	);
}
