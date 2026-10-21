import React from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
	Badge,
	Button,
	cn,
	Empty,
	Input,
	InputArea,
	LayerCard,
	Loader,
	Tabs,
	Text,
} from '@cloudflare/kumo';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PayoutsCard } from '@/components/payments/PayoutsCard';
import { PaidListingsList } from '@/components/publishing/PaidListingsList';
import {
	CalendarBlank,
	Code,
	EnvelopeSimple,
	Eye,
	Gear,
	Globe,
	GithubLogo,
	Lightning,
	PencilSimple,
	Pulse,
	ShieldCheck,
	Star,
	Trophy,
	X,
} from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';
import { capitalizeFirstLetter, getInitials } from '@/lib/utils';
import { formatNumber } from '@/utils/analytics';
import { formatLongDate, formatShortDate, formatShortDateTime } from '@/lib/format-date';
import { getLocale, msg, t, T } from '@/lib/i18n';
import { visibilityLabel } from '@/lib/visibility-label';
import { toast } from 'sonner';
import { useUserStats, useUserActivity } from '@/hooks/use-stats';
import { useUpdateProfile } from '@/hooks/use-profile';
import { useApps } from '@/hooks/use-apps';
import { pageTitle } from '@/brand';

const STATS = [
	{
		key: 'appCount' as const,
		label: msg('Total apps'),
		icon: Code,
		iconClass: 'text-kumo-brand',
	},
	{
		key: 'publicAppCount' as const,
		label: msg('Public apps'),
		icon: Globe,
		iconClass: 'text-teal-500',
	},
	{
		key: 'totalViewsReceived' as const,
		label: msg('Total views'),
		icon: Eye,
		iconClass: 'text-purple-500',
	},
	{
		key: 'totalLikesReceived' as const,
		label: msg('Total likes'),
		icon: Star,
		iconClass: 'text-amber-500',
	},
] as const;

// Each label is translated where it is shown.
const PROFILE_TABS = [
	{ value: 'about', label: msg('About') },
	{ value: 'apps', label: msg('Apps') },
	{ value: 'paid', label: msg('Paid listings') },
	{ value: 'achievements', label: msg('Achievements') },
	{ value: 'activity', label: msg('Activity') },
] as const;

const ACTIVITY_VERB_CLASS = 'font-medium';
const ACTIVITY_TITLE_CLASS = 'text-kumo-subtle';

/** What the seller did and to what, such as "Created Lucia Candles"; each sentence is whole so the verb can change with the language. */
function ActivityLine({ type, title }: { type: string; title: string }) {
	const components = {
		verb: (children: React.ReactNode) => <span className={ACTIVITY_VERB_CLASS}>{children}</span>,
		title: (children: React.ReactNode) => <span className={ACTIVITY_TITLE_CLASS}>{children}</span>,
	};
	switch (type) {
		case 'created':
			return <T text="<verb>Created</verb> <title>{title}</title>" values={{ title }} components={components} />;
		case 'updated':
			return <T text="<verb>Updated</verb> <title>{title}</title>" values={{ title }} components={components} />;
		case 'favorited':
			return <T text="<verb>Favorited</verb> <title>{title}</title>" values={{ title }} components={components} />;
		default:
			return <span className={ACTIVITY_TITLE_CLASS}>{title}</span>;
	}
}

/** The tab named by `?tab=`, so Stripe's return URL opens Paid listings. */
function tabFromSearch(value: string | null): string {
	return PROFILE_TABS.find((tab) => tab.value === value)?.value ?? 'about';
}

export default function Profile() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const [isEditing, setIsEditing] = React.useState(false);
	const [profileData, setProfileData] = React.useState({
		displayName: user?.displayName || '',
		username: user?.username || '',
		bio: user?.bio || '',
		timezone: user?.timezone || 'UTC',
	});
	const [activeTab, setActiveTab] = React.useState(() => tabFromSearch(searchParams.get('tab')));

	// Back from Stripe onboarding: the payouts card fetches fresh status on mount, so drop the marker and keep the tab.
	React.useEffect(() => {
		const stripe = searchParams.get('stripe');
		if (stripe !== 'return' && stripe !== 'refresh') return;
		const next = new URLSearchParams(searchParams);
		next.delete('stripe');
		setSearchParams(next, { replace: true });
	}, [searchParams, setSearchParams]);

	// Sync the form from the cached user, but never while editing: a background
	// session refetch would otherwise overwrite unsaved input mid-edit.
	React.useEffect(() => {
		if (user && !isEditing) {
			setProfileData({
				displayName: user.displayName || '',
				username: user.username || '',
				bio: user.bio || '',
				timezone: user.timezone || 'UTC',
			});
		}
	}, [user, isEditing]);

	const { stats, loading: statsLoading } = useUserStats();
	const { activities, loading: activityLoading } = useUserActivity();
	const { apps: recentApps, loading: appsLoading } = useApps();
	const { mutateAsync: saveProfile, isPending: isSaving } =
		useUpdateProfile();

	const achievements = stats?.achievements || [];

	const handleEdit = () => {
		setActiveTab('about');
		setIsEditing(true);
	};

	const handleSave = async () => {
		if (isSaving) return;

		try {
			// The mutation invalidates the auth session, so `user` (and the
			// header/sidebar) pick up the new values.
			await saveProfile({
				displayName: profileData.displayName,
				username: profileData.username,
				bio: profileData.bio,
				timezone: profileData.timezone,
			});
			toast.success(t('Profile updated successfully'));
			setIsEditing(false);
		} catch (error) {
			console.error('Profile update error:', error);
			toast.error(t('Failed to update profile'));
		}
	};

	const handleCancel = () => {
		setProfileData({
			displayName: user?.displayName || '',
			username: user?.username || '',
			bio: user?.bio || '',
			timezone: user?.timezone || 'UTC',
		});
		setIsEditing(false);
	};

	const handleTabChange = (value: string) => {
		setActiveTab(value);
		if (value !== 'about' && isEditing) {
			handleCancel();
		}
	};

	const initials = getInitials(user?.displayName, user?.email);

	return (
		<div className="min-h-screen">
			<title>
				{pageTitle(
					user?.displayName ? t('{name} - Profile', { name: user.displayName }) : t('Profile'),
				)}
			</title>
			<main className="container mx-auto max-w-4xl px-4 py-12 pb-24">
				{/* Header */}
				<div className="mb-10 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
					<Avatar className="size-20 ring-2 ring-kumo-line shadow-md sm:size-24">
						<AvatarImage src={user?.avatarUrl} />
						<AvatarFallback className="bg-kumo-base text-3xl font-semibold">
							{initials}
						</AvatarFallback>
					</Avatar>

					<div className="min-w-0 flex-1 text-center sm:text-left">
						<div className="mb-1.5 flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap">
							<h1 className="font-funky-mono text-2xl font-semibold text-kumo-strong">
								{user?.displayName || t('Your profile')}
							</h1>
							<div className="flex flex-wrap items-center justify-center gap-1.5">
								<Badge variant="secondary" className="gap-1">
									{user?.provider === 'github' ? (
										<GithubLogo
											className="size-3"
											weight="fill"
										/>
									) : (
										<Globe className="size-3" />
									)}
									{capitalizeFirstLetter(
										user?.provider ?? '',
									)}
								</Badge>
								{user?.emailVerified && (
									<Badge variant="success" className="gap-1">
										<ShieldCheck
											className="size-3"
											weight="fill"
										/>
										{t('Verified')}
									</Badge>
								)}
							</div>
						</div>
						<Text variant="secondary" size="sm">
							{user?.email}
						</Text>
						{user?.bio && !isEditing && (
							<p className="mt-2 max-w-xl text-sm text-kumo-default">
								{user.bio}
							</p>
						)}
					</div>

					<div className="flex shrink-0 gap-2">
						{isEditing ? (
							<>
								<Button
									variant="primary"
									size="sm"
									onClick={handleSave}
									loading={isSaving}
								>
									{t('Save changes')}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={handleCancel}
									icon={<X className="size-4" />}
								>
									{t('Cancel')}
								</Button>
							</>
						) : (
							<>
								<Button
									variant="secondary"
									size="sm"
									onClick={handleEdit}
									icon={<PencilSimple className="size-4" />}
								>
									{t('Edit profile')}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => navigate('/settings')}
									icon={<Gear className="size-4" />}
								>
									{t('Settings')}
								</Button>
							</>
						)}
					</div>
				</div>

				{/* Stats */}
				<div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{STATS.map(({ key, label, icon: Icon, iconClass }) => (
						<div
							key={key}
							className="relative overflow-hidden rounded-xl px-4 py-4 bg-kumo-base ring ring-kumo-line/70"
						>
							<Icon
								className={cn(
									'pointer-events-none absolute -top-2 -right-5 size-24 rotate-12 opacity-10',
									iconClass,
								)}
								weight="duotone"
							/>
							<div className="relative grid gap-1">
								<p className="text-3xl font-semibold tabular-nums text-kumo-strong">
									{statsLoading
										? '–'
										: formatNumber(stats?.[key] ?? 0, getLocale())}
								</p>
								<p className="text-sm text-kumo-subtle">
									{t(label)}
								</p>
							</div>
						</div>
					))}
				</div>

				{/* Tabs + content */}
				<div className="flex flex-col gap-6">
					<Tabs
						value={activeTab}
						onValueChange={handleTabChange}
						className="w-fit"
						tabs={PROFILE_TABS.map((tab) => ({ value: tab.value, label: t(tab.label) }))}
					/>

					{activeTab === 'about' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								{t('Profile information')}
							</LayerCard.Secondary>
							<LayerCard.Primary>
								<div className="grid gap-6">
									<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
										{isEditing ? (
											<Input
												id="displayName"
												label={t('Display name')}
												value={profileData.displayName}
												onChange={(e) =>
													setProfileData({
														...profileData,
														displayName:
															e.target.value,
													})
												}
											/>
										) : (
											<div className="grid gap-1">
												<p className="text-sm text-kumo-subtle">
													{t('Display name')}
												</p>
												<p className="text-sm text-kumo-default">
													{user?.displayName || '—'}
												</p>
											</div>
										)}

										{isEditing ? (
											<Input
												id="username"
												label={t('Username')}
												value={profileData.username}
												onChange={(e) =>
													setProfileData({
														...profileData,
														username:
															e.target.value,
													})
												}
												// i18n-ignore: a username as typed
												placeholder="@username"
											/>
										) : (
											<div className="grid gap-1">
												<p className="text-sm text-kumo-subtle">
													{t('Username')}
												</p>
												<p className="text-sm text-kumo-default">
													{user?.username ||
														t('Not set')}
												</p>
											</div>
										)}

										<div className="grid gap-1">
											<p className="text-sm text-kumo-subtle">
												{t('Email')}
											</p>
											<p className="flex items-center gap-2 text-sm text-kumo-default">
												<span className="h-lh flex items-center text-kumo-subtle">
													<EnvelopeSimple className="size-4" />
												</span>
												{user?.email}
											</p>
										</div>

										<div className="grid gap-1">
											<p className="text-sm text-kumo-subtle">
												{t('Member since')}
											</p>
											<p className="flex items-center gap-2 text-sm text-kumo-default">
												<span className="h-lh flex items-center text-kumo-subtle">
													<CalendarBlank className="size-4" />
												</span>
												{user?.createdAt
													? formatLongDate(new Date(user.createdAt), getLocale())
													: t('Unknown')}
											</p>
										</div>
									</div>

									{isEditing ? (
										<InputArea
											id="bio"
											label={t('Bio')}
											value={profileData.bio}
											onChange={(e) =>
												setProfileData({
													...profileData,
													bio: e.target.value,
												})
											}
											placeholder={t('Tell us about yourself...')}
											rows={4}
										/>
									) : (
										<div className="grid gap-1">
											<p className="text-sm text-kumo-subtle">
												{t('Bio')}
											</p>
											<p className="text-sm text-kumo-default">
												{user?.bio ||
													t('No bio yet — hit edit to add one!')}
											</p>
										</div>
									)}
								</div>
							</LayerCard.Primary>
						</LayerCard>
					)}

					{activeTab === 'apps' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								{t('Recent apps')}
							</LayerCard.Secondary>
							<LayerCard.Primary>
								{appsLoading ? (
									<div className="flex justify-center py-10">
										<Loader />
									</div>
								) : recentApps && recentApps.length > 0 ? (
									<div className="grid gap-2">
										{recentApps.slice(0, 5).map((app) => (
											<button
												key={app.id}
												type="button"
												className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left ring ring-kumo-hairline hover:bg-kumo-tint"
												onClick={() =>
													navigate(`/app/${app.id}`)
												}
											>
												<div className="flex min-w-0 items-center gap-3">
													<span className="flex size-10 shrink-0 items-center justify-center rounded-lg text-kumo-subtle">
														<Code className="size-5" />
													</span>
													<div className="min-w-0">
														<p className="truncate text-sm font-medium text-kumo-default">
															{app.title}
														</p>
														<div className="mt-1 flex flex-wrap items-center gap-2">
															{app.framework && (
																<Badge
																	variant="neutral"
																	className="text-xs"
																>
																	{
																		app.framework
																	}
																</Badge>
															)}
															<span className="text-xs text-kumo-subtle">
																{app.createdAt
																	? formatShortDate(new Date(app.createdAt), getLocale())
																	: t('Recently')}
															</span>
														</div>
													</div>
												</div>
												<Badge
													variant={
														app.visibility ===
														'public'
															? 'success'
															: 'secondary'
													}
												>
													{visibilityLabel(app.visibility)}
												</Badge>
											</button>
										))}
									</div>
								) : (
									<Empty
										size="sm"
										icon={
											<Code
												size={40}
												className="text-kumo-inactive"
												weight="duotone"
											/>
										}
										title={t('No apps yet')}
										description={t('Build something fun — your first app is one prompt away.')}
										contents={
											<Button
												variant="primary"
												size="sm"
												onClick={() =>
													navigate('/chat')
												}
											>
												{t('Create your first app')}
											</Button>
										}
									/>
								)}
							</LayerCard.Primary>
						</LayerCard>
					)}

					{activeTab === 'paid' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								{t('Paid listings')}
							</LayerCard.Secondary>
							<LayerCard.Primary>
								<div className="grid gap-4">
									<PayoutsCard />
									<PaidListingsList />
								</div>
							</LayerCard.Primary>
						</LayerCard>
					)}

					{activeTab === 'achievements' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								{t('Achievements')}
							</LayerCard.Secondary>
							<LayerCard.Primary>
								{statsLoading ? (
									<div className="flex justify-center py-10">
										<Loader />
									</div>
								) : achievements && achievements.length > 0 ? (
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{achievements.map(
											(achievement, index) => (
												<div
													key={index}
													className="flex items-start gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline"
												>
													<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
														<Trophy
															className="size-5"
															weight="duotone"
														/>
													</span>
													<div className="min-w-0 grid gap-0.5">
														<p className="text-sm font-medium text-kumo-default">
															{achievement}
														</p>
														<p className="text-sm text-kumo-subtle">
															{t('Unlocked — nice work!')}
														</p>
													</div>
												</div>
											),
										)}
									</div>
								) : (
									<Empty
										size="sm"
										icon={
											<Trophy
												size={40}
												className="text-kumo-inactive"
												weight="duotone"
											/>
										}
										title={t('No achievements yet')}
										description={t('Create apps and share them to unlock badges.')}
									/>
								)}
							</LayerCard.Primary>
						</LayerCard>
					)}

					{activeTab === 'activity' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								{t('Activity')}
							</LayerCard.Secondary>
							<LayerCard.Primary>
								{activityLoading ? (
									<div className="flex justify-center py-10">
										<Loader />
									</div>
								) : activities && activities.length > 0 ? (
									<div className="grid gap-0">
										{activities.map((activity, index) => (
											<div
												key={index}
												className="flex items-start gap-3 border-b border-kumo-line/50 py-3 last:border-0 last:pb-0 first:pt-0"
											>
												<span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-kumo-subtle">
													{activity.type ===
														'created' && (
														<Lightning className="size-4" />
													)}
													{activity.type ===
														'updated' && (
														<PencilSimple className="size-4" />
													)}
													{activity.type ===
														'favorited' && (
														<Star className="size-4" />
													)}
												</span>
												<div className="min-w-0 flex-1 grid gap-0.5">
													<p className="text-sm text-kumo-default">
														<ActivityLine type={activity.type} title={activity.title} />
													</p>
													<p className="text-xs text-kumo-subtle">
														{activity.timestamp
															? formatShortDateTime(new Date(activity.timestamp), getLocale())
															: t('Recently')}
													</p>
												</div>
											</div>
										))}
									</div>
								) : (
									<Empty
										size="sm"
										icon={
											<Pulse
												size={40}
												className="text-kumo-inactive"
												weight="duotone"
											/>
										}
										title={t('No recent activity')}
										description={t('Your creations and updates will show up here.')}
									/>
								)}
							</LayerCard.Primary>
						</LayerCard>
					)}
				</div>
			</main>
		</div>
	);
}
