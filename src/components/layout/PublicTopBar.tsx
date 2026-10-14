import { Link, useLocation, useNavigate } from 'react-router';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';

/** Top bar for public pages: brand, Discover and Pricing, then sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname } = useLocation();
	const navigate = useNavigate();

	const startBuilding = () => {
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header className="sticky top-0 z-40 border-b border-kumo-line bg-kumo-canvas/85 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
				<div className="flex items-center gap-8">
					<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-kumo-strong">
						<EstoriLogo className="h-6 w-auto" />
					</Link>
					<nav className="hidden sm:flex items-center gap-6 text-sm text-kumo-default">
						<Link to="/discover" className="hover:text-kumo-strong">Discover</Link>
						<Link to="/pricing" className="hover:text-kumo-strong">Pricing</Link>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					{isAuthenticated ? (
						<Link to="/" className="text-sm text-kumo-default hover:text-kumo-strong">Open app</Link>
					) : (
						<button type="button" onClick={() => showAuthModal()} className="text-sm text-kumo-default hover:text-kumo-strong">
							Sign in
						</button>
					)}
					<button
						type="button"
						onClick={startBuilding}
						className="rounded-full bg-[var(--estori-action)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--estori-action-hover)]"
					>
						Start building
					</button>
				</div>
			</div>
		</header>
	);
}
