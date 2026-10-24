/**
 * Auth Button
 * Account menu for authenticated users
 */

import { Loader2, LucideGlobeLock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn, Button, DropdownMenu } from '@cloudflare/kumo';
import { useAuth } from '../../contexts/auth-context';
import { getInitials } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import {
	useUsageLimitsBadgeState,
	type UsageLimitsBadgeState,
} from '../usage-limits-badge';
import {
	CaretRightIcon,
	DesktopIcon,
	GearIcon,
	MoonIcon,
	QuestionIcon,
	ReceiptIcon,
	SignOutIcon,
	SunIcon,
	TranslateIcon,
	UserIcon,
	FileTextIcon,
} from '@phosphor-icons/react';
import { useAccountSettings } from '@/components/account-settings';
import { useTheme } from '@/contexts/theme-context';
import { useUpdateProfile } from '@/hooks/use-profile';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';
import { legalLinkLabel } from '@/lib/legal-link-label';
import { toast } from 'sonner';

interface AuthButtonProps {
	className?: string;
	display?: 'icon' | 'sidebar';
}

function getLimitsStatusText(limits: UsageLimitsBadgeState) {
	if (limits.loading) return t('Checking credits...');
	if (limits.billing)
		return limits.isExhausted ? t('Out of AI credits') : limits.usageText;
	if (limits.needsConfiguration) return t('Configure AI Gateway');
	if (limits.showCredits) return limits.creditsText;
	if (limits.isExhausted && !limits.hasUserToken)
		return t('Free limit exhausted');
	if (limits.showUsage && !limits.isExhausted) return limits.usageText;
	return t('Connect Cloudflare');
}

function getLimitsDetailText(limits: UsageLimitsBadgeState) {
	if (limits.loading) return t('Loading your usage status');
	if (limits.billing) return t("This month's AI credits");
	if (limits.needsConfiguration) return t('Select an account and AI Gateway');
	if (limits.showCredits && limits.showUsage && !limits.isExhausted)
		return limits.usageText;
	if (limits.showCredits) return t('Connected to AI Gateway');
	if (limits.isExhausted && !limits.hasUserToken)
		return t('Connect Cloudflare to continue building');
	if (limits.showUsage && !limits.isExhausted) return t('Free tier usage');
	return t('Use your Cloudflare AI Gateway credits');
}

export function AuthButton({ className, display = 'icon' }: AuthButtonProps) {
	const { user, isAuthenticated, isLoading, logout } = useAuth();

	const navigate = useNavigate();
	const { openSettings } = useAccountSettings();
	const { theme, setTheme } = useTheme();
	const profileUpdate = useUpdateProfile();
	const usageLimits = useUsageLimitsBadgeState();
	const showLimitsState = !usageLimits.hidden;
	const limitsStatusText = getLimitsStatusText(usageLimits);
	const limitsDetailText = getLimitsDetailText(usageLimits);
	const limitsStatusClassName = cn(
		'text-kumo-subtle',
		usageLimits.needsConfiguration && 'text-amber-500',
		usageLimits.isExhausted && !usageLimits.hasUserToken && 'text-red-500',
	);

	if (isLoading) {
		return <Skeleton className="w-10 h-10 rounded-full" />;
	}

	if (!isAuthenticated || !user) {
		return null;
	}

	const initials = getInitials(user.displayName, user.email);

	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					display === 'sidebar' ? (
						<Button
							data-account-menu-trigger
							variant="ghost"
							size="base"
							className={cn(
								'h-auto min-h-10 min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-kumo-default',
								className,
							)}
						>
							<Avatar className="h-7 w-7 shrink-0">
								<AvatarImage
									src={user.avatarUrl}
									alt={user.displayName || user.email}
								/>
								<AvatarFallback className="bg-kumo-elevated text-xs font-semibold text-kumo-default">
									{initials}
								</AvatarFallback>
							</Avatar>
							<span className="min-w-0 flex-1 flex-col group-data-[state=collapsed]/sidebar:hidden">
								<span className="block truncate text-sm font-medium text-kumo-default">
									{user.displayName || t('User')}
								</span>
								{showLimitsState && (
									<span
										className={cn(
											'block truncate text-xs font-normal',
											limitsStatusClassName,
										)}
									>
										{limitsStatusText}
									</span>
								)}
							</span>
						</Button>
					) : (
						<Button
							data-account-menu-trigger
							variant="ghost"
							size="base"
							shape="circle"
							aria-label={t('Account menu')}
							className={cn(
								'relative rounded-full transition-all hover:ring-2 hover:ring-kumo-brand/20',
								className,
							)}
						>
							<Avatar className="h-9 w-9">
								<AvatarImage
									src={user.avatarUrl}
									alt={user.displayName || user.email}
								/>
								<AvatarFallback className="bg-kumo-elevated font-semibold text-kumo-default">
									{initials}
								</AvatarFallback>
							</Avatar>
						</Button>
					)
				}
			/>

			<DropdownMenu.Content
				align={display === 'sidebar' ? 'start' : 'end'}
				className="workspace-account-menu w-80 max-w-[calc(100vw-24px)]"
			>
				<DropdownMenu.Item
					className="account-identity"
					onClick={() => navigate('/profile')}
				>
					<Avatar className="size-12 shrink-0">
						<AvatarImage src={user.avatarUrl} alt="" />
						<AvatarFallback>{initials}</AvatarFallback>
					</Avatar>
					<span className="min-w-0">
						<strong className="block truncate text-base">
							{user.displayName || user.email}
						</strong>
						<span className="text-sm text-kumo-subtle">
							{t('View profile')}
						</span>
					</span>
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				{showLimitsState && (
					<div className="border-b border-kumo-line p-3 mb-2">
						<div className="flex items-start gap-2">
							{usageLimits.loading ? (
								<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-kumo-subtle" />
							) : (
								<LucideGlobeLock
									className={cn(
										'mt-0.5 size-4 shrink-0',
										limitsStatusClassName,
									)}
								/>
							)}
							<div className="min-w-0">
								<p
									className={cn(
										'truncate text-sm font-medium text-kumo-default',
										limitsStatusClassName,
									)}
								>
									{limitsStatusText}
								</p>
								<p className="mt-0.5 text-xs text-kumo-subtle">
									{limitsDetailText}
								</p>
							</div>
						</div>
					</div>
				)}

				<DropdownMenu.Group>
					{showLimitsState &&
						!usageLimits.loading &&
						usageLimits.needsConfiguration && (
							<DropdownMenu.Item
								onClick={() => navigate('/settings')}
								icon={LucideGlobeLock}
							>
								{t('Configure AI Gateway')}
							</DropdownMenu.Item>
						)}
					{showLimitsState &&
						!usageLimits.loading &&
						usageLimits.showCredits && (
							<DropdownMenu.Item
								onClick={() => navigate('/settings')}
								icon={LucideGlobeLock}
							>
								{t('Manage AI Gateway')}
							</DropdownMenu.Item>
						)}
					<DropdownMenu.Item
						onClick={() => openSettings('profile')}
						icon={UserIcon}
					>
						{t('Profile')}
					</DropdownMenu.Item>
					<DropdownMenu.Item
						onClick={() => openSettings()}
						icon={GearIcon}
					>
						{t('Settings')}
					</DropdownMenu.Item>
				</DropdownMenu.Group>

				<DropdownMenu.Item
					icon={ReceiptIcon}
					onClick={() => navigate('/orders')}
				>
					{t('Orders')}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					icon={QuestionIcon}
					onClick={() => navigate('/contact')}
				>
					{t('Help and support')}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					icon={TranslateIcon}
					onClick={() => openSettings('appearance')}
				>
					{t('Language')}
					<CaretRightIcon className="ml-auto size-4" />
				</DropdownMenu.Item>
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger icon={FileTextIcon}>
						{t('Legal')}
					</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						{LEGAL_LINKS.map((link) => (
							<DropdownMenu.Item
								key={link.slug}
								onClick={() => navigate(link.path)}
							>
								{legalLinkLabel(link.slug)}
							</DropdownMenu.Item>
						))}
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
				<DropdownMenu.Item
					onClick={() => logout()}
					icon={SignOutIcon}
					variant="danger"
				>
					{t('Sign Out')}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<div
					className="account-appearance"
					role="group"
					aria-label={t('Appearance')}
				>
					{(
						[
							{
								value: 'system',
								label: t('System'),
								Icon: DesktopIcon,
							},
							{
								value: 'light',
								label: t('Light'),
								Icon: SunIcon,
							},
							{ value: 'dark', label: t('Dark'), Icon: MoonIcon },
						] as const
					).map(({ value, label, Icon }) => (
						<Button
							key={value}
							variant="ghost"
							aria-label={label}
							title={label}
							aria-pressed={theme === value}
							disabled={profileUpdate.isPending}
							onClick={async () => {
								try {
									await profileUpdate.mutateAsync({
										theme: value,
									});
									setTheme(value);
								} catch {
									toast.error(
										t(
											'Could not save your appearance. Please try again.',
										),
									);
								}
							}}
						>
							<Icon className="size-5" />
						</Button>
					))}
				</div>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
