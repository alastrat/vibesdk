import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@cloudflare/kumo';
import {
	CloudIcon,
	GithubLogoIcon,
	GoogleLogoIcon,
	LinkIcon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { OAuthProvider } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { t } from '@/lib/i18n';
import {
	ConfirmAction,
	SettingsError,
	SettingsIntro,
	SettingsLoading,
} from './shared';

const providers = [
	// i18n-ignore: provider brand names
	{ id: 'github', name: 'GitHub', Icon: GithubLogoIcon },
	{ id: 'google', name: 'Google', Icon: GoogleLogoIcon },
	{ id: 'cloudflare', name: 'Cloudflare', Icon: CloudIcon },
] as const;

export function ConnectionSettings() {
	const { user, authProviders } = useAuth();
	const client = useQueryClient();
	const [unlinking, setUnlinking] = useState<OAuthProvider | null>(null);
	const [linking, setLinking] = useState<OAuthProvider | null>(null);
	const identities = useQuery({
		queryKey: queryKeys.account.settings.identities(user?.id),
		queryFn: () =>
			unwrap(
				apiClient.getLinkedIdentities(),
				t('Failed to load connected accounts'),
			),
		enabled: !!user,
	});
	const unlink = useMutation({
		mutationFn: (provider: OAuthProvider) =>
			unwrap(
				apiClient.unlinkProvider(provider),
				t('Failed to unlink provider'),
			),
		onSuccess: async () => {
			setUnlinking(null);
			await Promise.all([
				client.invalidateQueries({
					queryKey: queryKeys.account.settings.identities(user?.id),
				}),
				client.invalidateQueries({
					queryKey: queryKeys.auth.session(),
				}),
			]);
			toast.success(t('Account disconnected'));
		},
	});
	const linked = identities.data?.identities ?? [];
	const visible = providers.filter(
		(provider) =>
			authProviders?.[provider.id] ||
			linked.some((identity) => identity.provider === provider.id),
	);
	return (
		<>
			<SettingsIntro
				title={t('Connected accounts')}
				description={t(
					'Link multiple sign-in providers to your account. You can use any linked provider to sign in.',
				)}
			/>
			<div className="space-y-3">
				{identities.isLoading && <SettingsLoading />}
				<SettingsError
					error={identities.error}
					retry={() => void identities.refetch()}
				/>
				{identities.data &&
					visible.map(({ id, name, Icon }) => {
						const identity = linked.find(
							(item) => item.provider === id,
						);
						return (
							<div key={id} className="space-y-3">
								<div className="flex items-center gap-3 rounded-xl bg-kumo-recessed p-4">
									<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-kumo-base">
										<Icon className="size-5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold">
											{name}
										</p>
										<p className="truncate text-sm text-kumo-subtle">
											{identity
												? identity.email || t('Linked')
												: t('Not connected')}
										</p>
									</div>
									{identity ? (
										<Button
											variant="secondary"
											size="sm"
											disabled={
												linked.length <= 1 ||
												unlink.isPending
											}
											title={
												linked.length <= 1
													? t(
															'You must keep at least one sign-in method',
														)
													: undefined
											}
											onClick={() => {
												unlink.reset();
												setUnlinking(id);
											}}
										>
											{t('Disconnect')}
										</Button>
									) : (
										<Button
											variant="secondary"
											size="sm"
											disabled={!!linking}
											loading={linking === id}
											onClick={() => {
												setLinking(id);
												apiClient.initiateProviderLink(
													id,
												);
											}}
										>
											<LinkIcon className="mr-1 size-4" />
											{t('Connect')}
										</Button>
									)}
								</div>
								{unlinking === id && (
									<ConfirmAction
										message={t(
											'You will no longer be able to sign in with your {provider} account. You can re-link it at any time.',
											{ provider: name },
										)}
										pending={unlink.isPending}
										error={unlink.error}
										confirm={() => unlink.mutate(id)}
										cancel={() => setUnlinking(null)}
										label={t('Disconnect')}
									/>
								)}
							</div>
						);
					})}
				{identities.data && visible.length === 0 && (
					<p className="rounded-xl bg-kumo-recessed p-4 text-sm text-kumo-subtle">
						{t(
							'No connected providers are available for this account.',
						)}
					</p>
				)}
			</div>
		</>
	);
}
