import { Empty, Loader } from '@cloudflare/kumo';
import { msg, t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminPanel, AdminTablePanel, Table } from './admin-layout';
import type { AdminFlagRow, AdminFlagsData } from '@/api-types';
import { useAdminFlags } from '@/hooks/use-telemetry';
import { isForbiddenError } from '@/lib/security-error';

const SOURCE_NOTES: Partial<Record<AdminFlagsData['source'], string>> = {
	off: msg(
		"PostHog isn't set up on this deployment, so its flags are off. Billing's own switches and any overrides still apply.",
	),
	defaults: msg(
		"PostHog didn't answer, so its flags are off for now. Billing's own switches and any overrides still apply.",
	),
};

export default function AdminFlagsPage() {
	useI18n();
	const flags = useAdminFlags();

	return (
		<AdminPage
			section="flags"
			title={t('Feature flags')}
			description={t(
				'Inspect feature availability and open PostHog to manage rollouts.',
			)}
			refreshing={flags.isFetching}
			onRefresh={() => void flags.refetch()}
		>
			{flags.data ? (
				<Flags data={flags.data} />
			) : flags.isLoading ? (
				<div className="flex justify-center py-16">
					<Loader />
				</div>
			) : isForbiddenError(flags.error) ? (
				<Empty
					title={t('Admins only')}
					description={flags.error?.message}
				/>
			) : (
				<Empty
					title={t("Couldn't load flags")}
					description={flags.error?.message}
				/>
			)}
		</AdminPage>
	);
}

function valueLabel(row: AdminFlagRow): string {
	if (row.kind === 'pause') return row.value ? t('Paused') : t('Not paused');
	return row.value ? t('On') : t('Off');
}

function Flags({ data }: { data: AdminFlagsData }) {
	const sourceNote = SOURCE_NOTES[data.source];
	const rolloutsHidden = data.flags.every(
		(row) => row.rolloutPercent === null,
	);

	return (
		<>
			<AdminPanel title={t('Flag configuration')}>
				<p>
					{t("Each flag's value for you. Change flags in PostHog.")}
					{data.posthogFlagsUrl ? (
						<>
							{' '}
							<a
								href={data.posthogFlagsUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-kumo-default underline underline-offset-2"
							>
								{t('Open flags in PostHog')}
							</a>
						</>
					) : null}
				</p>
				{sourceNote ? <p>{t(sourceNote)}</p> : null}
				<p className="text-sm">
					{t(
						"Flags are off unless PostHog turns them on; billing's own switches and any overrides still apply. Pause something by raising its pause flag to 100%.",
					)}
				</p>
				{rolloutsHidden ? (
					<p className="text-sm">
						{t(
							'Rollouts show once a PostHog personal API key is added.',
						)}
					</p>
				) : null}
			</AdminPanel>
			<AdminTablePanel
				title={t('Feature availability')}
				count={data.flags.length}
			>
				<Table className="w-full text-left text-sm">
					<caption className="sr-only">
						{t('Feature flags for you')}
					</caption>
					<Table.Header className="text-kumo-subtle">
						<Table.Row>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('Flag')}
							</th>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('What it does')}
							</th>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('Kind')}
							</th>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('In the browser')}
							</th>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('Value')}
							</th>
							<th
								scope="col"
								className="py-2 pr-4 font-normal"
							>
								{t('Rollout')}
							</th>
							<th
								scope="col"
								className="py-2 font-normal"
							>
								{t('In PostHog')}
							</th>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{data.flags.map((row) => (
							<Table.Row
								key={row.key}
								className="border-t border-kumo-line align-top text-kumo-default"
							>
								<Table.Cell className="py-2.5 pr-4 font-mono">
									{row.key}
								</Table.Cell>
								<Table.Cell className="py-2.5 pr-4">
									{row.description}
								</Table.Cell>
								<Table.Cell className="py-2.5 pr-4">
									{row.kind === 'pause'
										? t('Pause')
										: t('Rollout')}
								</Table.Cell>
								<Table.Cell className="py-2.5 pr-4">
									{row.clientVisible ? t('Yes') : t('No')}
								</Table.Cell>
								<Table.Cell className="py-2.5 pr-4">
									{valueLabel(row)}
								</Table.Cell>
								<Table.Cell className="py-2.5 pr-4">
									{row.rolloutPercent === null
										? t('Not shown')
										: `${row.rolloutPercent}%`}
								</Table.Cell>
								<Table.Cell className="py-2.5">
									{row.inPostHog ? t('Yes') : t('No')}
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</AdminTablePanel>
		</>
	);
}
