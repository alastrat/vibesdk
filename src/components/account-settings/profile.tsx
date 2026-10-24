import { useState, type FormEvent } from 'react';
import { Button, Input } from '@cloudflare/kumo';
import { UserCircleIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { AuthUser } from '@/api-types';
import { useUpdateProfile } from '@/hooks/use-profile';
import { t } from '@/lib/i18n';
import { fieldClass, SettingsError, SettingsIntro } from './shared';

export function ProfileSettings({ user }: { user: AuthUser }) {
	const [draft, setDraft] = useState({
		displayName: user.displayName ?? '',
		username: user.username ?? '',
		bio: user.bio ?? '',
		timezone: user.timezone ?? 'UTC',
	});
	const [saved, setSaved] = useState(draft);
	const update = useUpdateProfile();
	const dirty = Object.keys(draft).some(
		(key) =>
			draft[key as keyof typeof draft] !==
			saved[key as keyof typeof saved],
	);
	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (update.isPending || !dirty) return;
		const submitted = {
			...draft,
			displayName: draft.displayName.trim(),
			username: draft.username.trim(),
			timezone: draft.timezone.trim(),
		};
		try {
			await update.mutateAsync(submitted);
			setSaved(submitted);
			setDraft(submitted);
			toast.success(t('Profile updated successfully'));
		} catch {
			/* The mutation error stays beside the form. */
		}
	};
	return (
		<>
			<SettingsIntro
				title={t('Profile')}
				description={t('Manage how you appear across Estori.')}
			/>
			<div className="relative mb-7 flex items-end gap-4 overflow-hidden rounded-2xl bg-kumo-recessed px-6 pt-20 pb-6 before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-linear-to-r before:from-public-brand before:to-public-blue">
				<div className="relative z-10 ring-4 ring-kumo-base flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-kumo-recessed text-kumo-subtle">
					{user.avatarUrl ? (
						<img
							src={user.avatarUrl}
							alt=""
							className="size-full object-cover"
						/>
					) : (
						<UserCircleIcon className="size-10" weight="duotone" />
					)}
				</div>
				<div className="relative z-10 min-w-0 pt-6">
					<p className="truncate font-semibold text-kumo-default">
						{user.displayName || user.username || user.email}
					</p>
					<p className="truncate text-sm text-kumo-subtle">
						{user.email}
					</p>
				</div>
			</div>
			<form
				onSubmit={(event) => void submit(event)}
				className="space-y-5"
			>
				<fieldset disabled={update.isPending} className="space-y-5">
					<Input
						label={t('Full name')}
						value={draft.displayName}
						required
						maxLength={100}
						autoComplete="name"
						onChange={(event) =>
							setDraft({
								...draft,
								displayName: event.target.value,
							})
						}
						className={fieldClass}
					/>
					<Input
						label={t('Username')}
						value={draft.username}
						minLength={3}
						maxLength={30}
						pattern="[a-zA-Z0-9_-]+"
						autoComplete="username"
						description={t(
							'Use 3–30 letters, numbers, underscores, or hyphens.',
						)}
						onChange={(event) =>
							setDraft({ ...draft, username: event.target.value })
						}
						className={fieldClass}
					/>
					<Input
						label={t('Email address')}
						value={user.email}
						readOnly
						type="email"
						description={t(
							'Your email is managed by your sign-in provider.',
						)}
						className={fieldClass}
					/>
					<label
						className="block text-sm font-medium text-kumo-default"
						htmlFor="account-bio"
					>
						{t('Bio')}
						<textarea
							id="account-bio"
							value={draft.bio}
							maxLength={500}
							rows={3}
							onChange={(event) =>
								setDraft({ ...draft, bio: event.target.value })
							}
							className="mt-2 block w-full resize-y rounded-xl border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-kumo-focus"
						/>
					</label>
					<Input
						label={t('Time zone')}
						value={draft.timezone}
						required
						description={t(
							'Use an IANA time zone, such as America/Bogota or Europe/London.',
						)}
						onChange={(event) =>
							setDraft({ ...draft, timezone: event.target.value })
						}
						className={fieldClass}
					/>
				</fieldset>
				<SettingsError error={update.error} />
				<div className="flex justify-end border-t border-kumo-line pt-5">
					<Button
						type="submit"
						variant="primary"
						disabled={!dirty || update.isPending}
						loading={update.isPending}
					>
						{t('Save changes')}
					</Button>
				</div>
			</form>
		</>
	);
}
