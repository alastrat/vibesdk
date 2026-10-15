import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, ListIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { PillLink } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { cn } from '@/lib/utils';
import { AnnouncementBar } from './AnnouncementBar';
import { MenuPanel, MobileMenuSection, type MenuId } from './NavMenu';

const MENUS: ReadonlyArray<{ id: MenuId; label: string }> = [
	{ id: 'solutions', label: 'Solutions' },
	{ id: 'creators', label: 'For creators' },
];

const PAGE_LINKS = [
	{ to: '/discover', label: 'Discover' },
	{ to: '/pricing', label: 'Pricing' },
] as const;

/** Beside Pricing on wide screens; a button at the foot of the phone menu, as on 1Password. */
const SALES_LINK = { to: '/contact', label: 'Talk to sales' } as const;

/** An underline that marks a hovered link and the open menu's trigger. */
const NAV_ITEM = 'border-b-2 border-transparent py-1.5 transition-colors hover:border-public-ink';
const SHEET_BUTTON = 'grid size-10 place-items-center rounded-full text-public-charcoal hover:bg-[#f4f4f5] focus-visible:outline-2 focus-visible:outline-public-blue';
const SHEET_ROW = 'flex w-full items-center justify-between py-3.5 text-left text-[22px] text-public-charcoal';

/** Top of every public page: the gold announcement, then a white bar with the brand, the menus, sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname, hash, key } = useLocation();
	const [menuOpen, setMenuOpen] = useState(false);
	// The phone menu's page: the top list, or one menu's columns.
	const [mobileSection, setMobileSection] = useState<MenuId | null>(null);
	const [openPanel, setOpenPanel] = useState<MenuId | null>(null);
	const headerRef = useRef<HTMLElement>(null);
	const sheetRef = useRef<HTMLDialogElement>(null);
	const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});

	useEffect(() => {
		setMenuOpen(false);
		setMobileSection(null);
		setOpenPanel(null);
	}, [pathname, hash, key]);

	// The phone menu is a modal sheet: the browser traps focus in it, closes it on Escape and restores focus after.
	useEffect(() => {
		const dialog = sheetRef.current;
		if (!dialog) return;
		if (menuOpen && !dialog.open) dialog.showModal();
		if (!menuOpen && dialog.open) dialog.close();
	}, [menuOpen]);

	// A modal sheet left open while the window widens would keep the page inert, so it closes past lg.
	useEffect(() => {
		if (!menuOpen) return;
		const wide = window.matchMedia('(min-width: 1024px)');
		const onChange = () => {
			if (wide.matches) setMenuOpen(false);
		};
		wide.addEventListener('change', onChange);
		return () => wide.removeEventListener('change', onChange);
	}, [menuOpen]);

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
										className={cn('inline-flex items-center gap-1 aria-expanded:border-public-ink', NAV_ITEM)}
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
							{[...PAGE_LINKS, SALES_LINK].map((link) => (
								<Link key={link.to} to={link.to} className={NAV_ITEM}>
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
						<StartBuildingButton className="hidden sm:inline-flex" />
						<button
							type="button"
							className="rounded-full p-2 text-public-charcoal lg:hidden"
							aria-expanded={menuOpen}
							aria-controls="public-menu"
							aria-label="Open menu"
							onClick={() => setMenuOpen(true)}
						>
							<ListIcon className="size-6" aria-hidden />
						</button>
					</div>
				</div>
				{/* The phone menu, as on 1Password: a full-screen sheet with the menus as pages, and the actions at the foot. */}
				<dialog
					ref={sheetRef}
					id="public-menu"
					aria-label="Menu"
					onClose={() => {
						setMenuOpen(false);
						setMobileSection(null);
					}}
					className="m-0 h-full max-h-none w-full max-w-none border-0 bg-white p-0 text-public-charcoal backdrop:bg-transparent lg:hidden"
				>
					<div className="flex h-full flex-col">
						<div className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-public-line px-4 sm:h-[72px] sm:px-6">
							{mobileSection ? (
								<>
									<button type="button" aria-label="Back to menu" onClick={() => setMobileSection(null)} className={cn(SHEET_BUTTON, '-ml-2')}>
										<CaretLeftIcon className="size-6" aria-hidden />
									</button>
									<p className="text-xl">{MENUS.find((menu) => menu.id === mobileSection)?.label}</p>
								</>
							) : (
								<Link to="/" aria-label={`${BRAND.name} home`} className="w-fit text-public-brand">
									<EstoriLogo className="h-7 w-auto" />
								</Link>
							)}
							<button
								type="button"
								aria-label="Close menu"
								onClick={() => setMenuOpen(false)}
								className={cn(SHEET_BUTTON, '-mr-2 justify-self-end', !mobileSection && 'col-start-3')}
							>
								<XIcon className="size-6" aria-hidden />
							</button>
						</div>

						<div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
							{mobileSection ? (
								<MobileMenuSection id={mobileSection} />
							) : (
								<ul>
									{MENUS.map((menu) => (
										<li key={menu.id}>
											<button type="button" onClick={() => setMobileSection(menu.id)} className={SHEET_ROW}>
												{menu.label}
												<CaretRightIcon className="size-6" aria-hidden />
											</button>
										</li>
									))}
									{PAGE_LINKS.map((link) => (
										<li key={link.to}>
											<Link to={link.to} className={SHEET_ROW}>
												{link.label}
											</Link>
										</li>
									))}
								</ul>
							)}
						</div>

						{!mobileSection && (
							<div className="shrink-0 border-t border-public-line px-4 py-5 sm:px-6">
								{isAuthenticated ? (
									<Link to="/" className="text-[17px] text-public-charcoal">
										Open app
									</Link>
								) : (
									<button
										type="button"
										onClick={() => {
											setMenuOpen(false);
											showAuthModal();
										}}
										className="text-[17px] text-public-charcoal"
									>
										Sign in
									</button>
								)}
								<div className="mt-4 grid grid-cols-2 gap-3">
									<PillLink to={SALES_LINK.to} variant="outline-on-light" className="w-full px-3 text-[15px]">
										{SALES_LINK.label}
									</PillLink>
									<StartBuildingButton className="w-full px-3 text-[15px]" />
								</div>
							</div>
						)}
					</div>
				</dialog>
			</div>
		</header>
	);
}
