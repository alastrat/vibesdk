import React from 'react';
import './workspace-shell.css';
import { Outlet, useLocation } from 'react-router';
import { SidebarProvider, useSidebar } from '@cloudflare/kumo';
import { BillingBanner } from '@/components/billing/BillingBanner';
import { AppSidebar } from './app-sidebar';
import { GlobalHeader } from './global-header';
import { HeaderProvider } from './header-context';
import { EstoriTopBar } from './EstoriTopBar';
import { StoreRail } from './store-rail';
import { storeWorkspaceLocation } from './store-workspace-location';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/contexts/auth-context';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

interface AppLayoutProps {
	children?: React.ReactNode;
}

function SidebarKeyboardShortcut({ enabled }: { enabled: boolean }) {
	const { toggleSidebar } = useSidebar();

	React.useEffect(() => {
		if (!enabled) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				toggleSidebar();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [enabled, toggleSidebar]);

	return null;
}

function persistSidebarState(open: boolean) {
	document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
}

function getSidebarDefaultOpen(): boolean {
	if (typeof document === 'undefined') return true;
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`),
	);
	if (!match) return true;
	return match[1] === 'true';
}

export function AppLayout({ children }: AppLayoutProps) {
	const { user } = useAuth();
	return <WorkspaceFrame key={user?.id ?? 'anonymous'}>{children}</WorkspaceFrame>;
}

/** Account changes discard local form and editor state; same-account refreshes preserve it. */
function WorkspaceFrame({ children }: AppLayoutProps) {
	const { t } = useI18n();
	const { pathname, search } = useLocation();
	const store = storeWorkspaceLocation(pathname, search);
	const pageKind = store ? 'store' : /^\/(?:build|chat|app)(?:\/|$)/.test(pathname) ? 'builder' : /^\/settings\/billing\/(?:checkout|card)(?:\/|$)/.test(pathname) ? 'checkout' : /^\/(?:apps|profile|settings|catalog|orders|admin|discover|emails|translations)(?:\/|$)/.test(pathname) || pathname === '/' ? 'standard' : 'other';
	const defaultOpen = React.useMemo(() => getSidebarDefaultOpen(), []);

	return (
		<div className="estori-workspace flex h-svh flex-col">
			<a href="#workspace-content" className="workspace-skip-link">{t('Skip to workspace content')}</a>
			<EstoriTopBar storeWorkspace={Boolean(store)} />
			<SidebarProvider
				defaultOpen={defaultOpen}
				collapsible="icon"
				resizable={false}
				mobileBreakpoint={768}
				// peekable
				onOpenChange={persistSidebarState}
				contained
				className={`vibesdk-sidebar-wrapper min-h-0 flex-1 ${store ? 'workspace-store-shell' : ''}`}
			>
				<HeaderProvider>
					<SidebarKeyboardShortcut enabled={!store} />
					{store ? <StoreRail appId={store.appId} section={store.section} /> : <AppSidebar />}
					<main id="workspace-content" tabIndex={-1} className="workspace-canvas bg-kumo-canvas flex flex-col h-full relative flex-1 min-w-0 overflow-hidden">
						<GlobalHeader showSidebarTrigger={!store} />
						<BillingBanner />
						<div data-page-kind={pageKind} className="workspace-content flex-1 min-h-0 overflow-auto bg-kumo-canvas">
							{children || <Outlet />}
						</div>
					</main>
				</HeaderProvider>
			</SidebarProvider>
		</div>
	);
}
