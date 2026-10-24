import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {
	Button,
	Dialog,
	DialogRoot,
	DialogTitle,
	DialogDescription,
	Input,
} from '@cloudflare/kumo';
import {
	CreditCardIcon,
	GearSixIcon,
	LinkIcon,
	LockKeyIcon,
	MagnifyingGlassIcon,
	PaintBrushIcon,
	ShieldCheckIcon,
	UserCircleIcon,
	XIcon,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/contexts/theme-context';
import { useI18n } from '@/lib/i18n';
import { ProfileSettings } from './profile';
import {
	AppearanceSettings,
	BillingSettings,
	PrivacySettings,
} from './preferences';
import { ConnectionSettings } from './connections';
import { SecuritySettings } from './security';
import { AccountSettingsContext, type AccountSettingsSection } from './context';
import { returnSettingsFocus, settingsOpener } from './focus-return';

function normalizeSection(section?: string): AccountSettingsSection {
	if (section === 'language' || section === 'theme') return 'appearance';
	if (section === 'api-keys' || section === 'sessions') return 'security';
	if (section === 'analytics') return 'privacy';
	if (section === 'connected-accounts') return 'connections';
	return section === 'appearance' ||
		section === 'connections' ||
		section === 'security' ||
		section === 'billing' ||
		section === 'privacy'
		? section
		: 'profile';
}

/** Mount inside AuthProvider, ThemeProvider, QueryClientProvider and the router. */
export function AccountSettingsProvider({ children }: { children: ReactNode }) {
	const { user } = useAuth();
	const { setTheme } = useTheme();
	useEffect(() => {
		if (user?.theme) setTheme(user.theme);
	}, [user?.id, user?.theme, setTheme]);
	const [openedFor, setOpenedFor] = useState<string | null>(null);
	const focusReturn = useRef<HTMLElement | null | undefined>(undefined);
	const [section, setSection] = useState<AccountSettingsSection>('profile');
	const [search, setSearch] = useState('');
	useEffect(() => {
		if (openedFor !== null && openedFor !== user?.id) setOpenedFor(null);
	}, [openedFor, user?.id]);
	const { t } = useI18n();
	// A dialog belongs to the identity that opened it; switching accounts cannot expose its forms or one-time keys.
	const isOpen = !!user && openedFor === user.id;
	const openSettings = useCallback(
		(next?: string) => {
			if (!user) return;
			if (openedFor !== user.id)
				focusReturn.current = settingsOpener(document);
			setSection(normalizeSection(next));
			setSearch('');
			setOpenedFor(user.id);
		},
		[user, openedFor],
	);
	const closeSettings = useCallback(() => setOpenedFor(null), []);
	const value = useMemo(
		() => ({ openSettings, closeSettings, isOpen }),
		[openSettings, closeSettings, isOpen],
	);
	const sections = [
		{ id: 'profile' as const, label: t('Profile'), Icon: UserCircleIcon },
		{
			id: 'appearance' as const,
			label: t('Appearance and language'),
			Icon: PaintBrushIcon,
		},
		{
			id: 'connections' as const,
			label: t('Connected accounts'),
			Icon: LinkIcon,
		},
		{ id: 'security' as const, label: t('Security'), Icon: LockKeyIcon },
		{
			id: 'billing' as const,
			label: t('Plan and billing'),
			Icon: CreditCardIcon,
		},
		{ id: 'privacy' as const, label: t('Privacy'), Icon: ShieldCheckIcon },
	];
	const visible = sections.filter((item) =>
		item.label
			.toLocaleLowerCase()
			.includes(search.trim().toLocaleLowerCase()),
	);
	return (
		<AccountSettingsContext.Provider value={value}>
			{children}
			<DialogRoot
				open={isOpen}
				onOpenChange={(open) => {
					if (!open) closeSettings();
				}}
				onOpenChangeComplete={(open) => {
					if (open || focusReturn.current === undefined) return;
					const opener = focusReturn.current;
					focusReturn.current = undefined;
					// Kumo does not expose Popup.finalFocus. Wait until its focus manager
					// finishes restoring focus before returning to the persistent opener.
					requestAnimationFrame(() => {
						if (focusReturn.current === undefined)
							returnSettingsFocus(opener, document);
					});
				}}
			>
				<Dialog
					size="xl"
					style={{
						width: 'min(960px, calc(100vw - 24px))',
						maxWidth: 'none',
					}}
					className="h-[min(760px,92dvh)] overflow-hidden rounded-2xl p-0 font-public sm:rounded-3xl"
				>
					{user && isOpen && (
						<div
							key={user.id}
							className="flex h-full min-h-0 flex-col md:flex-row"
						>
							<aside className="flex shrink-0 flex-col border-b border-kumo-line bg-kumo-recessed p-4 md:w-60 md:border-r md:border-b-0 md:p-5">
								<div className="mb-5 flex items-center gap-2 pr-8">
									<GearSixIcon className="size-5 text-kumo-subtle" />
									<DialogTitle className="text-base font-semibold">
										{t('Account settings')}
									</DialogTitle>
								</div>
								<DialogDescription className="sr-only">
									{t(
										'Manage your profile, preferences, security, and billing.',
									)}
								</DialogDescription>
								<div className="relative mb-4">
									<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-kumo-subtle" />
									<Input
										type="search"
										value={search}
										onChange={(event) =>
											setSearch(event.target.value)
										}
										aria-label={t('Search settings')}
										placeholder={t('Search settings')}
										className="w-full rounded-lg bg-kumo-base pl-9 shadow-none"
									/>
								</div>
								<nav
									aria-label={t('Account settings')}
									className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
								>
									{visible.map(({ id, label, Icon }) => (
										<button
											type="button"
											key={id}
											aria-current={
												section === id
													? 'page'
													: undefined
											}
											onClick={() => setSection(id)}
											className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-kumo-focus ${section === id ? 'bg-kumo-base font-semibold text-kumo-default shadow-sm' : 'text-kumo-subtle hover:bg-kumo-base/70 hover:text-kumo-default'}`}
										>
											<Icon
												className="size-[18px] shrink-0"
												weight={
													section === id
														? 'duotone'
														: 'regular'
												}
											/>
											{label}
										</button>
									))}
								</nav>
								{visible.length === 0 && (
									<p className="text-sm text-kumo-subtle">
										{t('No settings found.')}
									</p>
								)}
								<p className="mt-auto hidden truncate px-3 pt-6 text-xs text-kumo-subtle md:block">
									{user.email}
								</p>
							</aside>
							<main
								className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-7 md:px-10 md:py-10"
								aria-label={
									sections.find((item) => item.id === section)
										?.label
								}
							>
								{section === 'profile' && (
									<ProfileSettings user={user} />
								)}
								{section === 'appearance' && (
									<AppearanceSettings />
								)}
								{section === 'connections' && (
									<ConnectionSettings />
								)}
								{section === 'security' && <SecuritySettings />}
								{section === 'billing' && (
									<BillingSettings close={closeSettings} />
								)}
								{section === 'privacy' && <PrivacySettings />}
							</main>
							<Button
								variant="ghost"
								size="sm"
								shape="square"
								className="absolute top-3 right-3 rounded-full"
								aria-label={t('Close account settings')}
								icon={<XIcon className="size-4" />}
								onClick={closeSettings}
							/>
						</div>
					)}
				</Dialog>
			</DialogRoot>
		</AccountSettingsContext.Provider>
	);
}
