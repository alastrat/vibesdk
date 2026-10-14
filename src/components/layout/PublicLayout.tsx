import { useEffect, useRef, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();

	// This container stays mounted across public routes, so each page starts at the top.
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [pathname]);

	return (
		<div ref={scrollRef} className="h-svh overflow-y-auto bg-kumo-canvas text-kumo-default">
			<PublicTopBar />
			<main>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
