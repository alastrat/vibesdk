import { STATUS_LABELS } from '@/lib/capabilities';
import { cn } from '@/lib/utils';

type Tone = 'light' | 'dark';

const BASE = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em]';

const STYLES = {
	'coming-soon': {
		light: 'bg-[#f4f4f5] text-public-muted ring ring-public-line',
		dark: 'text-white/85 ring ring-white/40',
	},
	'early-access': {
		light: 'bg-[#eaf1ff] text-public-blue ring ring-[#c9dbff]',
		dark: 'bg-white/10 text-white ring ring-white/60',
	},
} as const;

/** A status badge for the public pages, in fixed colors since those pages ignore the app theme. */
export function StatusBadge({ status, tone = 'light' }: { status: keyof typeof STYLES; tone?: Tone }) {
	return <span className={cn(BASE, STYLES[status][tone])}>{STATUS_LABELS[status]}</span>;
}

export function ComingSoon({ tone = 'light' }: { tone?: Tone }) {
	return <StatusBadge status="coming-soon" tone={tone} />;
}
