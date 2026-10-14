/** "Coming soon" badge for the public pages, in fixed colors since those pages ignore the app theme. */
export function ComingSoon({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
	return (
		<span
			className={
				tone === 'dark'
					? 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/85 ring ring-white/40'
					: 'inline-flex items-center rounded-full bg-[#f4f4f5] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-public-muted ring ring-public-line'
			}
		>
			Coming soon
		</span>
	);
}
