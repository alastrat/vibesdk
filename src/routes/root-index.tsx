import { Loader } from '@cloudflare/kumo';
import { Outlet, useLocation } from 'react-router';
import { useAuth } from '@/contexts/auth-context';
import { AppLayout } from '@/components/layout/app-layout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { useOAuthErrorToast } from '@/hooks/use-oauth-error-toast';
import Home from './home';
import { LandingPage } from './landing/LandingPage';

type RootView = 'loading' | 'home' | 'landing';

function useRootView(): RootView {
	const { isAuthenticated, isLoading, user } = useAuth();
	if (isLoading) return 'loading';
	return isAuthenticated && user && !user.isAnonymous ? 'home' : 'landing';
}

/**
 * Layout for `/` and the app routes. One AppLayout instance serves them all, so the
 * sidebar keeps its state between them; signed-out visitors at `/` get the public layout.
 */
export function AppShell() {
	const { pathname } = useLocation();
	const view = useRootView();
	if (pathname !== '/' || view === 'home') return <AppLayout />;
	// The loader fills the screen by itself until the visitor is known.
	return view === 'loading' ? <Outlet /> : <PublicLayout />;
}

/** `/`: the builder home for signed-in users, the landing page for everyone else. */
export default function RootIndex() {
	const view = useRootView();
	useOAuthErrorToast();

	if (view === 'loading') {
		return (
			<div className="flex h-svh items-center justify-center bg-kumo-canvas">
				<Loader />
			</div>
		);
	}
	return view === 'home' ? <Home /> : <LandingPage />;
}
