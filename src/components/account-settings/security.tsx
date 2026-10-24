import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@cloudflare/kumo';
import {
	CheckIcon,
	CopyIcon,
	DesktopIcon,
	KeyIcon,
	PlusIcon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { getLocale, t } from '@/lib/i18n';
import { formatNumericDate } from '@/lib/format-date';
import {
	ConfirmAction,
	fieldClass,
	SettingsError,
	SettingsIntro,
	SettingsLoading,
} from './shared';

export function SecuritySettings() {
	const { user } = useAuth();
	const client = useQueryClient();
	const [confirmSession, setConfirmSession] = useState<string | null>(null);
	const [confirmKey, setConfirmKey] = useState<string | null>(null);
	const [keyName, setKeyName] = useState('');
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const copy = useCopyToClipboard();
	const sessions = useQuery({
		queryKey: queryKeys.account.settings.activeSessions(user?.id),
		queryFn: () =>
			unwrap(
				apiClient.getActiveSessions(),
				t('Failed to load active sessions'),
			),
		enabled: !!user,
	});
	const keys = useQuery({
		queryKey: queryKeys.account.settings.apiKeys(user?.id),
		queryFn: () =>
			unwrap(apiClient.getApiKeys(), t('Failed to load API keys')),
		enabled: !!user,
	});
	const revokeSession = useMutation({
		mutationFn: (id: string) =>
			unwrap(apiClient.revokeSession(id), t('Failed to revoke session')),
		onSuccess: async () => {
			setConfirmSession(null);
			await client.invalidateQueries({
				queryKey: queryKeys.account.settings.activeSessions(user?.id),
			});
			toast.success(t('Session revoked successfully'));
		},
	});
	const revokeKey = useMutation({
		mutationFn: (id: string) =>
			unwrap(apiClient.revokeApiKey(id), t('Failed to revoke API key')),
		onSuccess: async () => {
			setConfirmKey(null);
			await client.invalidateQueries({
				queryKey: queryKeys.account.settings.apiKeys(user?.id),
			});
			toast.success(t('API key revoked'));
		},
	});
	const createKey = useMutation({
		mutationFn: (name: string) =>
			unwrap(
				apiClient.createApiKey({ name }),
				t('Failed to create API key'),
			),
		onSuccess: async (data) => {
			setCreatedKey(data.key);
			setKeyName('');
			copy.reset();
			await client.invalidateQueries({
				queryKey: queryKeys.account.settings.apiKeys(user?.id),
			});
		},
	});
	const submitKey = (event: FormEvent) => {
		event.preventDefault();
		if (keyName.trim() && !createKey.isPending)
			createKey.mutate(keyName.trim());
	};
	return (
		<>
			<SettingsIntro
				title={t('Security')}
				description={t('Manage devices and access to your account.')}
			/>
			<div className="space-y-7">
				<section className="space-y-3">
					<h3 className="text-sm font-semibold">
						{t('Active sessions')}
					</h3>
					{sessions.isLoading && <SettingsLoading />}
					<SettingsError
						error={sessions.error}
						retry={() => void sessions.refetch()}
					/>
					{sessions.data?.sessions.map((session) => (
						<div key={session.id} className="space-y-2">
							<div className="flex items-center gap-3 rounded-xl bg-kumo-recessed p-4">
								<DesktopIcon className="size-5 shrink-0 text-kumo-subtle" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium">
										{session.isCurrent
											? t('Current session')
											: t('Other session')}
									</p>
									<p className="mt-1 break-all text-xs text-kumo-subtle">
										{session.ipAddress ??
											t('Unknown location')}{' '}
										·{' '}
										{formatNumericDate(
											new Date(session.lastActivity),
											getLocale(),
										)}
									</p>
								</div>
								{session.isCurrent ? (
									<span className="rounded-md bg-kumo-base px-2 py-1 text-xs text-kumo-subtle">
										{t('This device')}
									</span>
								) : (
									<Button
										variant="secondary"
										size="sm"
										disabled={revokeSession.isPending}
										onClick={() => {
											revokeSession.reset();
											setConfirmSession(session.id);
										}}
									>
										{t('Revoke')}
									</Button>
								)}
							</div>
							{confirmSession === session.id && (
								<ConfirmAction
									message={t(
										'Sign out this device? It will need to sign in again.',
									)}
									pending={revokeSession.isPending}
									error={revokeSession.error}
									confirm={() =>
										revokeSession.mutate(session.id)
									}
									cancel={() => setConfirmSession(null)}
									label={t('Revoke')}
								/>
							)}
						</div>
					))}
					{sessions.data?.sessions.length === 0 && (
						<p className="text-sm text-kumo-subtle">
							{t('No active sessions found.')}
						</p>
					)}
				</section>
				<section className="space-y-3 border-t border-kumo-line pt-6">
					<div className="flex items-center justify-between gap-3">
						<h3 className="text-sm font-semibold">
							{t('API keys')}
						</h3>
						{!showCreate && (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									createKey.reset();
									setShowCreate(true);
								}}
							>
								<PlusIcon className="mr-1 size-4" />
								{t('Create key')}
							</Button>
						)}
					</div>
					{showCreate && (
						<div className="space-y-3 rounded-xl border border-kumo-line p-4">
							{createdKey ? (
								<>
									<p className="text-sm text-kumo-subtle">
										{t(
											'Copy this key now. You will not be able to see it again.',
										)}
									</p>
									<Input
										aria-label={t('API key')}
										value={createdKey}
										readOnly
										className={`${fieldClass} font-mono text-xs`}
									/>
									<div className="flex justify-end gap-2">
										<Button
											variant="secondary"
											size="sm"
											onClick={() =>
												void copy.copy(createdKey)
											}
										>
											{copy.copied ? (
												<CheckIcon className="mr-1 size-4" />
											) : (
												<CopyIcon className="mr-1 size-4" />
											)}
											{copy.copied
												? t('Copied')
												: t('Copy API key')}
										</Button>
										<Button
											variant="primary"
											size="sm"
											onClick={() => {
												setCreatedKey(null);
												setShowCreate(false);
											}}
										>
											{t('Done')}
										</Button>
									</div>
								</>
							) : (
								<form
									onSubmit={submitKey}
									className="space-y-3"
								>
									<Input
										label={t('Key name')}
										value={keyName}
										onChange={(event) =>
											setKeyName(event.target.value)
										}
										required
										maxLength={100}
										disabled={createKey.isPending}
										className={fieldClass}
									/>
									<p className="text-xs leading-5 text-kumo-subtle">
										{t(
											'Treat this like a password. Anyone with this key can act as your {brand} account.',
											{ brand: 'Estori' },
										)}
									</p>
									<SettingsError error={createKey.error} />
									<div className="flex justify-end gap-2">
										<Button
											variant="secondary"
											size="sm"
											disabled={createKey.isPending}
											onClick={() => setShowCreate(false)}
										>
											{t('Cancel')}
										</Button>
										<Button
											variant="primary"
											type="submit"
											size="sm"
											loading={createKey.isPending}
											disabled={
												createKey.isPending ||
												!keyName.trim()
											}
										>
											{t('Create')}
										</Button>
									</div>
								</form>
							)}
						</div>
					)}
					{keys.isLoading && <SettingsLoading />}
					<SettingsError
						error={keys.error}
						retry={() => void keys.refetch()}
					/>
					{keys.data?.keys.length === 0 && (
						<p className="rounded-xl bg-kumo-recessed p-4 text-sm text-kumo-subtle">
							{t('No API keys yet')}
						</p>
					)}
					{keys.data?.keys.map((key) => (
						<div key={key.id} className="space-y-2">
							<div className="flex items-center gap-3 rounded-xl bg-kumo-recessed p-4">
								<KeyIcon className="size-5 shrink-0 text-kumo-subtle" />
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">
										{key.name}
									</p>
									<p className="mt-1 font-mono text-xs text-kumo-subtle">
										{key.keyPreview}
									</p>
								</div>
								{key.isActive ? (
									<Button
										variant="secondary"
										size="sm"
										disabled={revokeKey.isPending}
										onClick={() => {
											revokeKey.reset();
											setConfirmKey(key.id);
										}}
									>
										{t('Revoke')}
									</Button>
								) : (
									<span className="text-xs text-kumo-subtle">
										{t('Revoked')}
									</span>
								)}
							</div>
							{confirmKey === key.id && (
								<ConfirmAction
									message={t(
										'Revoke this API key? Apps using it will lose access immediately.',
									)}
									pending={revokeKey.isPending}
									error={revokeKey.error}
									confirm={() => revokeKey.mutate(key.id)}
									cancel={() => setConfirmKey(null)}
									label={t('Revoke API key')}
								/>
							)}
						</div>
					))}
				</section>
			</div>
		</>
	);
}
