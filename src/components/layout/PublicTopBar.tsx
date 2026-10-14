import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { pillClass } from '@/components/public-site/primitives';
import { AnnouncementBar } from './AnnouncementBar';

const NAV_LINKS = [
	{ to: '/discover', label: 'Discover' },
	{ to: '/pricing', label: 'Pricing' },
	{ to: '/#creators', label: 'For creators' },
] as const;

/** Top of every public page: the gold announcement, then a white bar with the brand, links, sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname, hash } = useLocation();
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		setMenuOpen(false);
	}, [pathname, hash]);

	const startBuilding = () => {
		setMenuOpen(false);
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header className="sticky top-0 z-40">
			<AnnouncementBar />
			<div className="border-b border-public-line bg-white">
				<div className="mx-auto flex h-16 max-w-[1248px] items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
					<div className="flex items-center gap-8">
						<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-public-brand">
							<EstoriLogo className="h-7 w-auto" />
						</Link>
						<nav aria-label="Main" className="hidden sm:flex items-center gap-6 text-[15px] text-public-charcoal">
							{NAV_LINKS.map((link) => (
								<Link key={link.to} to={link.to} className="underline-offset-4 hover:underline">
									{link.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-4">
						{isAuthenticated ? (
							<Link to="/" className="text-[15px] text-public-charcoal underline-offset-4 hover:underline">
								Open app
							</Link>
						) : (
							<button type="button" onClick={() => showAuthModal()} className="text-[15px] text-public-charcoal underline-offset-4 hover:underline">
								Sign in
							</button>
						)}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'hidden sm:inline-flex')}>
							Start building free
						</button>
						<button
							type="button"
							className="rounded-full p-2 text-public-charcoal sm:hidden"
							aria-expanded={menuOpen}
							aria-controls="public-menu"
							aria-label={menuOpen ? 'Close menu' : 'Open menu'}
							onClick={() => setMenuOpen((open) => !open)}
						>
							{menuOpen ? <XIcon className="size-6" aria-hidden /> : <ListIcon className="size-6" aria-hidden />}
						</button>
					</div>
				</div>
				{menuOpen && (
					<nav id="public-menu" aria-label="Main" className="grid gap-1 border-t border-public-line px-4 py-4 sm:hidden">
						{NAV_LINKS.map((link) => (
							<Link key={link.to} to={link.to} className="py-2 text-lg text-public-charcoal">
								{link.label}
							</Link>
						))}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'mt-3 w-full')}>
							Start building free
						</button>
					</nav>
				)}
			</div>
		</header>
	);
}
