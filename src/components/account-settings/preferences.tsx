import { useState } from 'react';
import { Button, Select, Switch, buttonVariants } from '@cloudflare/kumo';
import {
	DesktopIcon,
	MoonIcon,
	SunIcon,
	ArrowUpRightIcon,
} from '@phosphor-icons/react';
import { Link } from 'react-router';
import {
	BILLING_PATH,
	GPC_ANALYTICS_MESSAGE,
	LEGAL_CONTACT,
	LOCALES,
	LOCALE_NAMES,
	isLocale,
	planName,
} from '@/api-types';
import { useTheme } from '@/contexts/theme-context';
import { useUpdateProfile } from '@/hooks/use-profile';
import {
	useAnalyticsPreference,
	useSetAnalyticsPreference,
} from '@/hooks/use-telemetry';
import { useBilling } from '@/hooks/use-billing';
import { chooseLocale } from '@/lib/i18n/choose-locale';
import { useI18n, t } from '@/lib/i18n';
import {
	SettingsError,
	SettingsIntro,
	SettingsLoading,
	SettingsRow,
} from './shared';

export function AppearanceSettings() {
	const { theme, setTheme } = useTheme();
	const { locale } = useI18n();
	const update = useUpdateProfile();
	const [languageSaving, setLanguageSaving] = useState(false);
	const chooseTheme = async (next: typeof theme) => {
		if (update.isPending) return;
		try {
			await update.mutateAsync({ theme: next });
			setTheme(next);
		} catch {
			/* Show the actual save error. */
		}
	};
	const changeLanguage = async (value: string | null) => {
		if (!isLocale(value) || languageSaving) return;
		setLanguageSaving(true);
		try {
			await chooseLocale(value);
		} finally {
			setLanguageSaving(false);
		}
	};
	const options = [
		{ value: 'light' as const, label: t('Light'), Icon: SunIcon },
		{ value: 'dark' as const, label: t('Dark'), Icon: MoonIcon },
		{ value: 'system' as const, label: t('System'), Icon: DesktopIcon },
	];
	return (
		<>
			<SettingsIntro
				title={t('Appearance and language')}
				description={t('Make Estori feel like home.')}
			/>
			<div className="space-y-6">
				<div>
					<h3 className="mb-3 text-sm font-medium">{t('Theme')}</h3>
					<div
						className="grid grid-cols-3 gap-2 sm:gap-3"
						role="group"
						aria-label={t('Theme')}
					>
						{options.map(({ value, label, Icon }) => (
							<Button
								key={value}
								variant={
									theme === value ? 'primary' : 'secondary'
								}
								aria-pressed={theme === value}
								disabled={update.isPending}
								onClick={() => void chooseTheme(value)}
								className="h-24 w-full min-w-0 justify-center rounded-xl px-1"
							>
								<span className="flex flex-col items-center gap-2 text-sm">
									<Icon className="size-6" weight="duotone" />
									{label}
								</span>
							</Button>
						))}
					</div>
				</div>
				<SettingsError error={update.error} />
				<SettingsRow
					title={t('Language')}
					description={t(
						'Choose the language for menus, messages, and emails.',
					)}
				>
					<Select
						aria-label={t('Choose your language')}
						value={locale}
						items={Object.fromEntries(
							LOCALES.map((code) => [code, LOCALE_NAMES[code]]),
						)}
						onValueChange={(value) => void changeLanguage(value)}
						disabled={languageSaving}
						className="min-w-40"
					/>
				</SettingsRow>
			</div>
		</>
	);
}

export function PrivacySettings() {
	const preference = useAnalyticsPreference();
	const update = useSetAnalyticsPreference();
	const data = preference.data;
	return (
		<>
			<SettingsIntro
				title={t('Privacy')}
				description={t('Choose how your account data is used.')}
			/>
			<div className="space-y-4">
				{preference.isLoading && <SettingsLoading />}
				<SettingsError
					error={preference.error}
					retry={() => void preference.refetch()}
				/>
				<SettingsRow
					title={t('Share usage analytics with {brand}', {
						brand: 'Estori',
					})}
					description={t(
						"{brand} uses the pages you visit, where you click, recordings of some sessions that show layouts and clicks but not what's written, and error reports to fix problems and improve the product. Your email and name are never shared.",
						{ brand: 'Estori' },
					)}
				>
					<Switch
						aria-label={t('Share usage analytics with {brand}', {
							brand: 'Estori',
						})}
						checked={!!data && !data.optedOut}
						disabled={!data || data.gpc || update.isPending}
						onCheckedChange={(checked) => update.mutate(!checked)}
					/>
				</SettingsRow>
				{data?.gpc && (
					<p className="text-sm leading-6 text-kumo-subtle">
						{t(GPC_ANALYTICS_MESSAGE)}
					</p>
				)}
				<SettingsError error={update.error} />
				<SettingsRow
					title={t('Your data')}
					description={t(
						'Contact us to request a copy of your data or delete your account.',
					)}
				>
					<a
						className={buttonVariants({
							variant: 'secondary',
							size: 'sm',
						})}
						href={`mailto:${LEGAL_CONTACT.privacy}`}
					>
						{t('Contact privacy support')}
					</a>
				</SettingsRow>
			</div>
		</>
	);
}

export function BillingSettings({ close }: { close: () => void }) {
	const billing = useBilling();
	return (
		<>
			<SettingsIntro
				title={t('Plan and billing')}
				description={t(
					'Manage your subscription, credits, and invoices.',
				)}
			/>
			{billing.isLoading && <SettingsLoading />}
			<SettingsError
				error={billing.error}
				retry={() => void billing.refetch()}
			/>
			{billing.data && (
				<SettingsRow
					title={t('Your plan')}
					description={planName(billing.data.plan)}
				>
					<Link
						to={BILLING_PATH}
						onClick={close}
						className={buttonVariants({
							variant: 'primary',
							size: 'sm',
						})}
					>
						{t('Plan, credits and billing')}
						<ArrowUpRightIcon className="ml-2 size-4" />
					</Link>
				</SettingsRow>
			)}
		</>
	);
}
