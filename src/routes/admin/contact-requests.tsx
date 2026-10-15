import { Link } from 'react-router';
import { Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { contactTopicLabel, type ContactAdminData } from '@/api-types';
import { useAdminContactRequests } from '@/hooks/use-contact';
import { formatCredits } from '@/lib/plans';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminContactRequestsPage() {
	const requests = useAdminContactRequests();

	return (
		<div className="size-full">
			<title>{pageTitle('Contact requests')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<Link to="/admin/reviews" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Reviews
					</Link>
					<h1 className="text-3xl font-semibold text-kumo-strong">Contact requests</h1>
					<p className="text-kumo-subtle">Messages from the contact sales page, newest first. Reply to each by email.</p>
				</div>
				{requests.data ? (
					<ContactRequests data={requests.data} />
				) : requests.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(requests.error) ? (
					<Empty title="Admins only" description={requests.error?.message} />
				) : (
					<Empty title="Couldn't load contact requests" description={requests.error?.message} />
				)}
			</div>
		</div>
	);
}

function ContactRequests({ data }: { data: ContactAdminData }) {
	if (data.requests.length === 0) {
		return <Empty title="No requests yet" description="Messages from the contact sales page show up here." />;
	}
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-sm">
				<caption className="sr-only">Contact requests, newest first</caption>
				<thead className="text-kumo-subtle">
					<tr>
						<th scope="col" className="py-2 pr-4 font-normal">From</th>
						<th scope="col" className="py-2 pr-4 font-normal">Company</th>
						<th scope="col" className="py-2 pr-4 font-normal">About</th>
						<th scope="col" className="py-2 pr-4 font-normal">Message</th>
						<th scope="col" className="py-2 font-normal">Received</th>
					</tr>
				</thead>
				<tbody>
					{data.requests.map((request) => (
						<tr key={request.id} className="border-t border-kumo-line align-top text-kumo-default">
							<td className="py-2.5 pr-4">
								<span className="block">{request.name}</span>
								<a href={`mailto:${request.email}`} className="text-kumo-subtle underline underline-offset-2">
									{request.email}
								</a>
							</td>
							<td className="py-2.5 pr-4">
								<span className="block">{request.company}</span>
								<span className="text-kumo-subtle">{request.companySize}</span>
							</td>
							<td className="py-2.5 pr-4">
								{contactTopicLabel(request.topic)}
								{request.premiumCredits !== null && <span className="block text-kumo-subtle">{formatCredits(request.premiumCredits)} credits</span>}
							</td>
							<td className="max-w-xs py-2.5 pr-4 whitespace-pre-wrap">{request.message ?? '—'}</td>
							<td className="py-2.5">{new Date(request.receivedAt).toLocaleDateString()}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
