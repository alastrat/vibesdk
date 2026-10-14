import { Loader } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { AppLayout } from '@/components/layout/app-layout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { useOAuthErrorToast } from '@/hooks/use-oauth-error-toast';
import Home from './home';
import { LandingPage } from './landing/LandingPage';

/** `/`: the builder home for signed-in users, the landing page for everyone else. */
export default function RootIndex() {
	const { isAuthenticated, isLoading, user } = useAuth();
	useOAuthErrorToast();

	if (isLoading) {
		return (
			<div className="flex h-svh items-center justify-center bg-kumo-canvas">
				<Loader />
			</div>
		);
	}
	if (isAuthenticated && user && !user.isAnonymous) {
		return (
			<AppLayout>
				<Home />
			</AppLayout>
		);
	}
	return (
		<PublicLayout>
			<LandingPage />
		</PublicLayout>
	);
}
