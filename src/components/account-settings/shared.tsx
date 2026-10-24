import type { ReactNode } from 'react';
import { Button } from '@cloudflare/kumo';
import { CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { t } from '@/lib/i18n';

export const fieldClass = 'w-full rounded-xl bg-kumo-recessed shadow-none';

export function SettingsIntro({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="mb-7">
			<h2 className="text-xl font-semibold tracking-tight text-kumo-default">
				{title}
			</h2>
			<p className="mt-1.5 text-sm leading-6 text-kumo-subtle">
				{description}
			</p>
		</div>
	);
}

export function SettingsRow({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col items-start justify-between gap-4 rounded-xl bg-kumo-recessed p-4 sm:flex-row sm:items-center">
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-kumo-default">{title}</p>
				{description && (
					<p className="mt-1 text-sm leading-5 text-kumo-subtle">
						{description}
					</p>
				)}
			</div>
			{children}
		</div>
	);
}

export function SettingsError({
	error,
	retry,
}: {
	error: Error | null;
	retry?: () => void;
}) {
	if (!error) return null;
	return (
		<div
			role="alert"
			className="flex items-start gap-2 rounded-xl border border-kumo-danger/30 bg-kumo-recessed p-3 text-sm text-kumo-danger"
		>
			<WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
			<div className="flex-1">{t(error.message)}</div>
			{retry && (
				<Button size="sm" variant="secondary" onClick={retry}>
					{t('Try again')}
				</Button>
			)}
		</div>
	);
}

export function SettingsLoading() {
	return (
		<div
			role="status"
			className="flex items-center gap-2 py-6 text-sm text-kumo-subtle"
		>
			<CircleNotchIcon className="size-4 animate-spin" />
			{t('Loading…')}
		</div>
	);
}

export function ConfirmAction({
	message,
	pending,
	error,
	confirm,
	cancel,
	label,
}: {
	message: string;
	pending: boolean;
	error: Error | null;
	confirm: () => void;
	cancel: () => void;
	label: string;
}) {
	return (
		<div className="space-y-3 rounded-xl border border-kumo-line p-4">
			<p className="text-sm text-kumo-default">{message}</p>
			<SettingsError error={error} />
			<div className="flex justify-end gap-2">
				<Button
					variant="secondary"
					size="sm"
					onClick={cancel}
					disabled={pending}
				>
					{t('Cancel')}
				</Button>
				<Button
					variant="destructive"
					size="sm"
					loading={pending}
					disabled={pending}
					onClick={confirm}
				>
					{label}
				</Button>
			</div>
		</div>
	);
}
