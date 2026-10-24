import { Empty, Loader } from '@cloudflare/kumo';
import { t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminTablePanel, Table } from './admin-layout';
import {
	EARLY_ACCESS_CAPABILITIES,
	type EarlyAccessAdminData,
} from '@/api-types';
import { useAdminEarlyAccess } from '@/hooks/use-early-access';
import { CAPABILITIES } from '@/lib/capabilities';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminEarlyAccessPage() {
	useI18n();
	const requests = useAdminEarlyAccess();

	return (
		<AdminPage
			section="early-access"
			title={t('Early access')}
			description={t(
				'Who asked to join each upcoming program, newest first.',
			)}
			refreshing={requests.isFetching}
			onRefresh={() => void requests.refetch()}
		>
			{requests.data ? (
				<EarlyAccessRequests data={requests.data} />
			) : requests.isLoading ? (
				<div className="flex justify-center py-16">
					<Loader />
				</div>
			) : isForbiddenError(requests.error) ? (
				<Empty
					title={t('Admins only')}
					description={requests.error?.message}
				/>
			) : (
				<Empty
					title={t("Couldn't load early access requests")}
					description={requests.error?.message}
				/>
			)}
		</AdminPage>
	);
}

function EarlyAccessRequests({ data }: { data: EarlyAccessAdminData }) {
	return (
		<>
			<div className="admin-metric-grid">
				{EARLY_ACCESS_CAPABILITIES.map((id) => (
					<div className="admin-metric" key={id}>
						<p className="text-sm text-kumo-subtle">
							{t(CAPABILITIES[id].name)}
						</p>
						<p className="mt-1 text-3xl font-semibold text-kumo-strong">
							{data.counts[id]}
						</p>
					</div>
				))}
			</div>
			{data.requests.length === 0 ? (
				<Empty
					title={t('No requests yet')}
					description={t(
						'Requests from the Digital businesses and Content creators pages show up here.',
					)}
				/>
			) : (
				<AdminTablePanel
					title={t('Requests')}
					count={data.requests.length}
				>
					<Table className="w-full text-left text-sm">
						<caption className="sr-only">
							{t('Early access requests, newest first')}
						</caption>
						<Table.Header className="text-kumo-subtle">
							<Table.Row>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Program')}
								</th>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Name')}
								</th>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Email')}
								</th>
								<th
									scope="col"
									className="py-2 font-normal"
								>
									{t('Requested')}
								</th>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{data.requests.map((request) => (
								<Table.Row
									key={`${request.capability}:${request.email}`}
									className="border-t border-kumo-line text-kumo-default"
								>
									<Table.Cell className="py-2.5 pr-4">
										{t(
											CAPABILITIES[request.capability]
												.name,
										)}
									</Table.Cell>
									<Table.Cell className="py-2.5 pr-4">
										{request.displayName}
									</Table.Cell>
									<Table.Cell className="py-2.5 pr-4">
										{request.email}
									</Table.Cell>
									<Table.Cell className="py-2.5">
										{new Date(
											request.requestedAt,
										).toLocaleDateString()}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</AdminTablePanel>
			)}
		</>
	);
}
