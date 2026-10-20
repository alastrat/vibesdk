import { Link } from 'react-router';
import { Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import type { AdminFlagRow, AdminFlagsData } from '@/api-types';
import { useAdminFlags } from '@/hooks/use-telemetry';
import { isForbiddenError } from '@/lib/security-error';

const SOURCE_NOTES: Partial<Record<AdminFlagsData['source'], string>> = {
	off: "PostHog isn't set up on this deployment, so every flag is off: nothing is rolled out or paused.",
	defaults: "PostHog didn't answer, so every flag is off: nothing is rolled out or paused.",
};

export default function AdminFlagsPage() {
	const flags = useAdminFlags();

	return (
		<div className="size-full">
			<title>{pageTitle('Feature flags')}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<Link to="/admin/reviews" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Reviews
					</Link>
					<h1 className="text-3xl font-semibold text-kumo-strong">Feature flags</h1>
				</div>
				{flags.data ? (
					<Flags data={flags.data} />
				) : flags.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(flags.error) ? (
					<Empty title="Admins only" description={flags.error?.message} />
				) : (
					<Empty title="Couldn't load flags" description={flags.error?.message} />
				)}
			</div>
		</div>
	);
}

function valueLabel(row: AdminFlagRow): string {
	if (row.kind === 'pause') return row.value ? 'Paused' : 'Not paused';
	return row.value ? 'On' : 'Off';
}

function Flags({ data }: { data: AdminFlagsData }) {
	const sourceNote = SOURCE_NOTES[data.source];
	const rolloutsHidden = data.flags.every((row) => row.rolloutPercent === null);

	return (
		<>
			<div className="grid gap-2 text-kumo-subtle">
				<p>
					Each flag's value for you. Change flags in PostHog.
					{data.posthogFlagsUrl ? (
						<>
							{' '}
							<a href={data.posthogFlagsUrl} target="_blank" rel="noopener noreferrer" className="text-kumo-default underline underline-offset-2">
								Open flags in PostHog
							</a>
						</>
					) : null}
				</p>
				{sourceNote ? <p>{sourceNote}</p> : null}
				<p className="text-sm">Every flag is off unless PostHog turns it on. Pause something by raising its pause flag to 100%.</p>
				{rolloutsHidden ? <p className="text-sm">Rollouts show once a PostHog personal API key is added.</p> : null}
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<caption className="sr-only">Feature flags for you</caption>
					<thead className="text-kumo-subtle">
						<tr>
							<th scope="col" className="py-2 pr-4 font-normal">Flag</th>
							<th scope="col" className="py-2 pr-4 font-normal">What it does</th>
							<th scope="col" className="py-2 pr-4 font-normal">Kind</th>
							<th scope="col" className="py-2 pr-4 font-normal">In the browser</th>
							<th scope="col" className="py-2 pr-4 font-normal">Value</th>
							<th scope="col" className="py-2 pr-4 font-normal">Rollout</th>
							<th scope="col" className="py-2 font-normal">In PostHog</th>
						</tr>
					</thead>
					<tbody>
						{data.flags.map((row) => (
							<tr key={row.key} className="border-t border-kumo-line align-top text-kumo-default">
								<td className="py-2.5 pr-4 font-mono">{row.key}</td>
								<td className="py-2.5 pr-4">{row.description}</td>
								<td className="py-2.5 pr-4">{row.kind === 'pause' ? 'Pause' : 'Rollout'}</td>
								<td className="py-2.5 pr-4">{row.clientVisible ? 'Yes' : 'No'}</td>
								<td className="py-2.5 pr-4">{valueLabel(row)}</td>
								<td className="py-2.5 pr-4">{row.rolloutPercent === null ? 'Not shown' : `${row.rolloutPercent}%`}</td>
								<td className="py-2.5">{row.inPostHog ? 'Yes' : 'No, so off'}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
