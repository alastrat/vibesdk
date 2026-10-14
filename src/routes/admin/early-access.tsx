import { Link } from 'react-router';
import { Empty, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { EARLY_ACCESS_CAPABILITIES, type EarlyAccessAdminData } from '@/api-types';
import { useAdminEarlyAccess } from '@/hooks/use-early-access';
import { CAPABILITIES } from '@/lib/capabilities';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminEarlyAccessPage() {
	const requests = useAdminEarlyAccess();

	return (
		<div className="size-full">
			<title>{pageTitle('Early access')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<Link to="/admin/reviews" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Reviews
					</Link>
					<h1 className="text-3xl font-semibold text-kumo-strong">Early access</h1>
					<p className="text-kumo-subtle">Who asked to join each upcoming program, newest first.</p>
				</div>
				{requests.data ? (
					<EarlyAccessRequests data={requests.data} />
				) : requests.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(requests.error) ? (
					<Empty title="Admins only" description={requests.error?.message} />
				) : (
					<Empty title="Couldn't load early access requests" description={requests.error?.message} />
				)}
			</div>
		</div>
	);
}

function EarlyAccessRequests({ data }: { data: EarlyAccessAdminData }) {
	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2">
				{EARLY_ACCESS_CAPABILITIES.map((id) => (
					<LayerCard key={id}>
						<LayerCard.Primary>
							<p className="text-sm text-kumo-subtle">{CAPABILITIES[id].name}</p>
							<p className="mt-1 text-3xl font-semibold text-kumo-strong">{data.counts[id]}</p>
						</LayerCard.Primary>
					</LayerCard>
				))}
			</div>
			{data.requests.length === 0 ? (
				<Empty title="No requests yet" description="Requests from the Digital businesses and Content creators pages show up here." />
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<caption className="sr-only">Early access requests, newest first</caption>
						<thead className="text-kumo-subtle">
							<tr>
								<th scope="col" className="py-2 pr-4 font-normal">Program</th>
								<th scope="col" className="py-2 pr-4 font-normal">Name</th>
								<th scope="col" className="py-2 pr-4 font-normal">Email</th>
								<th scope="col" className="py-2 font-normal">Requested</th>
							</tr>
						</thead>
						<tbody>
							{data.requests.map((request) => (
								<tr key={`${request.capability}:${request.email}`} className="border-t border-kumo-line text-kumo-default">
									<td className="py-2.5 pr-4">{CAPABILITIES[request.capability].name}</td>
									<td className="py-2.5 pr-4">{request.displayName}</td>
									<td className="py-2.5 pr-4">{request.email}</td>
									<td className="py-2.5">{new Date(request.requestedAt).toLocaleDateString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
