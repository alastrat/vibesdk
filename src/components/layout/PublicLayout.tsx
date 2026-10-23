import { useEffect, useRef, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { Outlet, useLocation } from 'react-router';
import { preferredScrollBehavior } from '@/components/public-site/primitives';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** DM Sans for the public pages; the signed-in app never downloads it. */
export const PUBLIC_FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2';

/** How long an anchor stays in place while the content above it settles. */
const ANCHOR_HOLD_MS = 2000;
/** Input that means the visitor is scrolling on their own. */
const SCROLL_INTENT_EVENTS = ['wheel', 'touchstart', 'keydown'] as const;

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	preload(PUBLIC_FONT_URL, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
	const scrollRef = useRef<HTMLDivElement>(null);
	const mainRef = useRef<HTMLElement>(null);
	const { pathname, hash, key } = useLocation();
	const previousLocation = useRef<{ pathname: string; hash: string } | null>(null);

	// This container stays mounted across public routes: go to the anchor a link names (again on a repeat click), else to the top.
	useEffect(() => {
		const previous = previousLocation.current;
		previousLocation.current = { pathname, hash };
		// Discover filters and dialogs live in the query string; keep the visitor at their card.
		if (pathname === '/discover' && previous?.pathname === pathname && !hash && !previous.hash) return;
		const target = hash ? document.getElementById(hash.slice(1)) : null;
		if (!target) {
			scrollRef.current?.scrollTo({ top: 0 });
			return;
		}
		target.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });

		// Late Discover data and the web font swap change the height above the target: keep it anchored until the visitor scrolls.
		const container = scrollRef.current;
		const main = mainRef.current;
		if (!container || !main) return;
		let height = main.offsetHeight;
		const observer = new ResizeObserver(() => {
			if (main.offsetHeight === height) return;
			height = main.offsetHeight;
			target.scrollIntoView({ block: 'start' });
		});
		const release = () => {
			observer.disconnect();
			clearTimeout(timer);
			for (const event of SCROLL_INTENT_EVENTS) container.removeEventListener(event, release);
		};
		const timer = setTimeout(release, ANCHOR_HOLD_MS);
		observer.observe(main);
		for (const event of SCROLL_INTENT_EVENTS) container.addEventListener(event, release, { passive: true });
		return release;
	}, [pathname, hash, key]);

	return (
		<div ref={scrollRef} className="public-site h-svh overflow-y-auto">
			<PublicTopBar />
			<main ref={mainRef}>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
