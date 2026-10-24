import { useLocale, t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { PillLink, UNDERLINE_GROW } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { cn } from '@/lib/utils';
import { AnnouncementBar } from './AnnouncementBar';
import { PublicUtilityBar } from './PublicUtilityBar';
import { MenuPanel, MobileMenuSection, type MenuId } from './NavMenu';

const MENUS: ReadonlyArray<{ id: MenuId; label: string }> = [
	{ id: 'solutions', label: marketingCopy.navigation.solutions },
	{ id: 'creators', label: marketingCopy.common.forCreators },
];

const PAGE_LINKS = [
	{ to: '/discover', label: marketingCopy.common.discover },
	{ to: '/pricing', label: marketingCopy.common.pricing },
] as const;

/** A main-bar action and a button at the foot of the phone menu. */
const SALES_LINK = { to: '/contact', label: marketingCopy.common.talkToSales } as const;

/** An underline that draws in from the left under a hovered link, and stays under the open menu's trigger. */
const NAV_ITEM =
	'bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_2px] bg-[position:0_100%] bg-no-repeat pt-1.5 pb-2 transition-[background-size] duration-300 ease-out hover:bg-[length:100%_2px] focus-visible:bg-[length:100%_2px] motion-reduce:transition-none';
const SHEET_BUTTON = 'grid size-10 place-items-center rounded-full text-public-charcoal hover:bg-[#f4f4f5] focus-visible:outline-2 focus-visible:outline-public-blue';
const SHEET_ROW = 'flex w-full items-center justify-between py-3.5 text-left text-[22px] text-public-charcoal';
/** One line of the menu button; the three fold into a cross while the menu is open. */
const BURGER_LINE = 'absolute left-0 h-0.5 w-6 rounded-full bg-current transition-[top,rotate,opacity] duration-200 ease-out motion-reduce:transition-none';
/** Each row of the phone menu arrives a moment after the one above it. */
const ROW_STAGGER_MS = 40;

/** Top of every public page: the gold announcement, gray utility row, then the white navigation and build action. */
export function PublicTopBar() {
	useLocale();
	const { isAuthenticated } = useAuth();
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
			<PublicUtilityBar />
			<div className="relative border-b border-public-line bg-white">
				<div className="mx-auto flex h-16 max-w-[1296px] items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
					<div className="flex items-center gap-8">
						<Link to="/" aria-label={t('{brand} home', { brand: BRAND.name })} className="flex items-center text-public-brand">
							<EstoriLogo className="h-7 w-auto" />
						</Link>
						<nav aria-label={t(marketingCopy.navigation.accessibility.main)} className="hidden lg:flex items-center gap-6 whitespace-nowrap text-[15px] text-public-charcoal">
							{MENUS.map((menu) => (
								<div
									key={menu.id}
									className={cn(menu.id === 'creators' && 'hidden')}
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
										className={cn('inline-flex items-center gap-1 aria-expanded:bg-[length:100%_2px]', NAV_ITEM)}
									>
										{t(menu.label)}
										<CaretDownIcon
											className={cn('size-3.5 transition-transform motion-reduce:transition-none', openPanel === menu.id && 'rotate-180')}
											aria-hidden
										/>
									</button>
									{openPanel === menu.id && <MenuPanel id={menu.id} />}
								</div>
							))}
							{PAGE_LINKS.map((link) => (
								<Link key={link.to} to={link.to} className={NAV_ITEM}>
									{t(link.label)}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-4 whitespace-nowrap">
						<Link to={SALES_LINK.to} className={cn('text-[15px] text-public-charcoal', UNDERLINE_GROW)}>
							{t(SALES_LINK.label)}
						</Link>
						<StartBuildingButton className="hidden sm:inline-flex" />
						<button
							type="button"
							className="rounded-full p-2 text-public-charcoal lg:hidden"
							aria-expanded={menuOpen}
							aria-controls="public-menu"
							aria-label={t(marketingCopy.navigation.accessibility.openMenu)}
							onClick={() => setMenuOpen(true)}
						>
							<span aria-hidden className="relative block h-4 w-6">
								<span className={cn(BURGER_LINE, 'top-0', menuOpen && 'top-[7px] rotate-45')} />
								<span className={cn(BURGER_LINE, 'top-[7px]', menuOpen && 'opacity-0')} />
								<span className={cn(BURGER_LINE, 'top-[14px]', menuOpen && 'top-[7px] -rotate-45')} />
							</span>
						</button>
					</div>
				</div>
				{/* The phone menu, as on 1Password: a full-screen sheet with the menus as pages, and the actions at the foot. */}
				<dialog
					ref={sheetRef}
					id="public-menu"
					aria-label={t(marketingCopy.navigation.accessibility.menu)}
					onClose={() => {
						setMenuOpen(false);
						setMobileSection(null);
					}}
					// Fades and slides in when it opens and back out when it closes, from the dialog's own open state.
					className="m-0 h-full max-h-none w-full max-w-none -translate-y-2 border-0 bg-white p-0 text-public-charcoal opacity-0 transition-[opacity,translate,display,overlay] duration-200 ease-out transition-discrete backdrop:bg-transparent open:translate-y-0 open:opacity-100 starting:open:-translate-y-2 starting:open:opacity-0 motion-reduce:transition-none lg:hidden"
				>
					<div className="flex h-full flex-col">
						<div className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-public-line px-4 sm:h-[72px] sm:px-6">
							{mobileSection ? (
								<>
									<button type="button" aria-label={t(marketingCopy.navigation.accessibility.back)} onClick={() => setMobileSection(null)} className={cn(SHEET_BUTTON, '-ml-2')}>
										<CaretLeftIcon className="size-6" aria-hidden />
									</button>
									<p className="text-xl">{t(MENUS.find((menu) => menu.id === mobileSection)?.label ?? '')}</p>
								</>
							) : (
								<Link to="/" aria-label={t('{brand} home', { brand: BRAND.name })} className="w-fit text-public-brand">
									<EstoriLogo className="h-7 w-auto" />
								</Link>
							)}
							<button
								type="button"
								aria-label={t(marketingCopy.navigation.accessibility.close)}
								onClick={() => setMenuOpen(false)}
								className={cn(SHEET_BUTTON, '-mr-2 justify-self-end', !mobileSection && 'col-start-3')}
							>
								<XIcon className="size-6" aria-hidden />
							</button>
						</div>

						<div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
							{mobileSection ? (
								<div key={mobileSection} className="motion-safe:animate-public-menu-item">
									<MobileMenuSection id={mobileSection} />
								</div>
							) : (
								<ul>
									{MENUS.map((menu, index) => (
										<li key={menu.id} className={cn('motion-safe:animate-public-menu-item', menu.id === 'creators' && 'hidden')} style={{ animationDelay: `${index * ROW_STAGGER_MS}ms` }}>
											<button type="button" onClick={() => setMobileSection(menu.id)} className={SHEET_ROW}>
												{t(menu.label)}
												<CaretRightIcon className="size-6" aria-hidden />
											</button>
										</li>
									))}
									{PAGE_LINKS.map((link, index) => (
										<li
											key={link.to}
											className="motion-safe:animate-public-menu-item"
											style={{ animationDelay: `${(MENUS.length + index) * ROW_STAGGER_MS}ms` }}
										>
											<Link to={link.to} className={SHEET_ROW}>
												{t(link.label)}
											</Link>
										</li>
									))}
								</ul>
							)}
						</div>

						{!mobileSection && (
							<div className="shrink-0 border-t border-public-line px-4 py-5 sm:px-6">
								{isAuthenticated && (
									<Link to="/" className="text-[17px] text-public-charcoal">
										{t(marketingCopy.navigation.openApp)}</Link>
								)}
								<div className={cn('grid grid-cols-2 gap-3', isAuthenticated && 'mt-4')}>
									<PillLink to={SALES_LINK.to} variant="outline-on-light" className="w-full px-3 text-[15px]">
										{t(SALES_LINK.label)}
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
