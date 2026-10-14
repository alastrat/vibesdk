import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CaretDownIcon, ListIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { pillClass, preferredScrollBehavior } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';
import { AnnouncementBar } from './AnnouncementBar';
import { MenuPanel, MobileMenuGroups, type MenuId } from './NavMenu';

const MENUS: ReadonlyArray<{ id: MenuId; label: string }> = [
	{ id: 'solutions', label: 'Solutions' },
	{ id: 'creators', label: 'For creators' },
];

const NAV_LINKS = [
	{ to: '/discover', label: 'Discover' },
	{ to: '/pricing', label: 'Pricing' },
] as const;

/** Top of every public page: the gold announcement, then a white bar with the brand, the menus, sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname, hash, key } = useLocation();
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(false);
	const [openPanel, setOpenPanel] = useState<MenuId | null>(null);
	const headerRef = useRef<HTMLElement>(null);
	const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});

	useEffect(() => {
		setMenuOpen(false);
		setOpenPanel(null);
	}, [pathname, hash, key]);

	// An open panel closes on Escape, returning focus to its trigger, and on a click outside the header.
	useEffect(() => {
		if (!openPanel) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			setOpenPanel(null);
			triggerRefs.current[openPanel]?.focus();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && headerRef.current?.contains(event.target)) return;
			setOpenPanel(null);
		};
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown);
		};
	}, [openPanel]);

	const startBuilding = () => {
		setMenuOpen(false);
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header ref={headerRef} className="sticky top-0 z-40">
			<AnnouncementBar />
			<div className="relative border-b border-public-line bg-white">
				<div className="mx-auto flex h-16 max-w-[1248px] items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
					<div className="flex items-center gap-8">
						<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-public-brand">
							<EstoriLogo className="h-7 w-auto" />
						</Link>
						<nav aria-label="Main" className="hidden lg:flex items-center gap-6 whitespace-nowrap text-[15px] text-public-charcoal">
							{MENUS.map((menu) => (
								<div
									key={menu.id}
									// Keyboard focus leaving the trigger and its panel closes it; clicks elsewhere are the document listener's.
									onBlur={(event) => {
										if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
											setOpenPanel((open) => (open === menu.id ? null : open));
										}
									}}
								>
									<button
										ref={(node) => {
											triggerRefs.current[menu.id] = node;
										}}
										type="button"
										aria-expanded={openPanel === menu.id}
										aria-controls={`menu-${menu.id}`}
										onClick={() => setOpenPanel((open) => (open === menu.id ? null : menu.id))}
										className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
									>
										{menu.label}
										<CaretDownIcon
											className={cn('size-3.5 transition-transform motion-reduce:transition-none', openPanel === menu.id && 'rotate-180')}
											aria-hidden
										/>
									</button>
									{openPanel === menu.id && <MenuPanel id={menu.id} />}
								</div>
							))}
							{NAV_LINKS.map((link) => (
								<Link key={link.to} to={link.to} className="underline-offset-4 hover:underline">
									{link.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-4 whitespace-nowrap">
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
							className="rounded-full p-2 text-public-charcoal lg:hidden"
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
					<nav
						id="public-menu"
						aria-label="Main"
						className="grid max-h-[calc(100dvh-7.5rem)] gap-1 overflow-y-auto border-t border-public-line px-4 py-4 sm:px-6 lg:hidden"
					>
						<MobileMenuGroups />
						{NAV_LINKS.map((link) => (
							<Link key={link.to} to={link.to} className="py-2 text-lg text-public-charcoal">
								{link.label}
							</Link>
						))}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'mt-3 w-full sm:hidden')}>
							Start building free
						</button>
					</nav>
				)}
			</div>
		</header>
	);
}
