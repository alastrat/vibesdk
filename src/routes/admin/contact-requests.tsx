import { Empty, Loader } from '@cloudflare/kumo';
import { t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminTablePanel, Table } from './admin-layout';
import { contactTopicLabel, type ContactAdminData } from '@/api-types';
import { useAdminContactRequests } from '@/hooks/use-contact';
import { formatCredits } from '@/lib/plans';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminContactRequestsPage() {
	useI18n();
	const requests = useAdminContactRequests();

	return (
		<AdminPage
			section="contact-requests"
			title={t('Contact requests')}
			description={t(
				'Messages from the contact sales page, newest first. Reply to each by email.',
			)}
			refreshing={requests.isFetching}
			onRefresh={() => void requests.refetch()}
		>
			{requests.data ? (
				<ContactRequests data={requests.data} />
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
					title={t("Couldn't load contact requests")}
					description={requests.error?.message}
				/>
			)}
		</AdminPage>
	);
}

function ContactRequests({ data }: { data: ContactAdminData }) {
	if (data.requests.length === 0) {
		return (
			<Empty
				title={t('No requests yet')}
				description={t(
					'Messages from the contact sales page show up here.',
				)}
			/>
		);
	}
	return (
		<AdminTablePanel title={t('Messages')} count={data.requests.length}>
			<Table className="w-full text-left text-sm">
				<caption className="sr-only">
					{t('Contact requests, newest first')}
				</caption>
				<Table.Header className="text-kumo-subtle">
					<Table.Row>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('From')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Company')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('About')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Message')}
						</th>
						<th scope="col" className="py-2 font-normal">
							{t('Received')}
						</th>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{data.requests.map((request) => (
						<Table.Row
							key={request.id}
							className="border-t border-kumo-line align-top text-kumo-default"
						>
							<Table.Cell className="py-2.5 pr-4">
								<span className="block">{request.name}</span>
								<a
									href={`mailto:${request.email}`}
									className="text-kumo-subtle underline underline-offset-2"
								>
									{request.email}
								</a>
							</Table.Cell>
							<Table.Cell className="py-2.5 pr-4">
								<span className="block">{request.company}</span>
								<span className="text-kumo-subtle">
									{request.companySize}
								</span>
							</Table.Cell>
							<Table.Cell className="py-2.5 pr-4">
								{contactTopicLabel(request.topic)}
								{request.premiumCredits !== null && (
									<span className="block text-kumo-subtle">
										{t('{credits} credits', {
											credits: formatCredits(
												request.premiumCredits,
											),
										})}
									</span>
								)}
							</Table.Cell>
							<Table.Cell className="max-w-xs py-2.5 pr-4 whitespace-pre-wrap">
								{request.message ?? '—'}
							</Table.Cell>
							<Table.Cell className="py-2.5">
								{new Date(
									request.receivedAt,
								).toLocaleDateString()}
							</Table.Cell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</AdminTablePanel>
	);
}
