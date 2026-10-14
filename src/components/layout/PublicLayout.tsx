import { useEffect, useRef, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { Outlet, useLocation } from 'react-router';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** DM Sans for the public pages; the signed-in app never downloads it. */
export const PUBLIC_FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2';

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	preload(PUBLIC_FONT_URL, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
	const scrollRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();

	// This container stays mounted across public routes, so each page starts at the top.
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [pathname]);

	return (
		<div ref={scrollRef} className="public-site h-svh overflow-y-auto">
			<PublicTopBar />
			<main>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
