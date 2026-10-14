import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	return (
		<div className="h-svh overflow-y-auto bg-kumo-canvas text-kumo-default">
			<PublicTopBar />
			<main>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
