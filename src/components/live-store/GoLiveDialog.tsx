import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, LinkButton, Loader } from '@cloudflare/kumo';
import { Copy } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
	useAddStoreDomain,
	useCheckStoreDomain,
	useLiveStore,
	usePublishLiveStore,
	useRemoveStoreDomain,
	useTakeLiveStoreOffline,
} from '@/hooks/use-live-store';
import { SLUG_MAX_LENGTH, slugProblem, type LiveStoreView, type StoreDomainRecord, type StoreDomainView } from '@/api-types';
import { publishAction } from './publish-action';

interface GoLiveDialogProps {
	appId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const PURPOSE_LABELS: Readonly<Record<StoreDomainRecord['purpose'], string>> = {
	routing: 'Sends your domain to your store',
	ownership: 'Proves you own the domain',
	certificate: 'Lets the secure certificate be issued',
};

function copy(value: string) {
	navigator.clipboard.writeText(value).then(
		() => toast.success('Copied'),
		() => toast.error("Couldn't copy. Select the text and copy it instead."),
	);
}

/** The store's address and status, publishing, and the seller's own domain. */
export function GoLiveDialog({ appId, open, onOpenChange }: GoLiveDialogProps) {
	const live = useLiveStore(appId, open);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Your store's address</DialogTitle>
					<DialogDescription>Publish your store so shoppers can visit it and buy. Changes you make later go live when you publish again.</DialogDescription>
				</DialogHeader>
				{live.isLoading && (
					<div className="flex justify-center py-8">
						<Loader />
					</div>
				)}
				{live.error && <p className="text-sm text-kumo-danger">{live.error.message}</p>}
				{live.data && <GoLiveBody appId={appId} view={live.data} />}
			</DialogContent>
		</Dialog>
	);
}

function StatusBadge({ view }: { view: LiveStoreView }) {
	if (view.status === 'live') return <Badge variant="success">Live</Badge>;
	if (view.status === 'offline') return <Badge variant="secondary">Offline</Badge>;
	return <Badge variant="outline">Not published</Badge>;
}

function GoLiveBody({ appId, view }: { appId: string; view: LiveStoreView }) {
	const publish = usePublishLiveStore(appId);
	const offline = useTakeLiveStoreOffline(appId);
	const [slug, setSlug] = useState(view.slug ?? view.suggestedSlug);
	useEffect(() => setSlug(view.slug ?? view.suggestedSlug), [view.slug, view.suggestedSlug]);

	if (!view.available) {
		return <p className="text-sm text-kumo-subtle">Store addresses aren't set up yet. You can keep building your store in the preview.</p>;
	}
	const problem = slugProblem(slug);
	const action = publishAction(view, slug);
	const onPublish = () =>
		publish.mutate(slug, {
			onSuccess: (next) => toast.success(next.url ? `Your store is live at ${next.url}` : 'Your store is live'),
			onError: (error) => toast.error(error.message),
		});

	return (
		<div className="grid gap-6">
			<section className="grid gap-3">
				<div className="flex items-center justify-between gap-3">
					<label htmlFor="live-store-slug" className="text-sm font-medium">
						Address
					</label>
					<StatusBadge view={view} />
				</div>
				<div className="flex items-center gap-2">
					<Input
						id="live-store-slug"
						value={slug}
						maxLength={SLUG_MAX_LENGTH}
						onChange={(event) => setSlug(event.target.value.trim().toLowerCase())}
						aria-invalid={problem !== null}
						aria-describedby="live-store-slug-help"
					/>
					<span className="shrink-0 text-sm text-kumo-subtle">.{view.storesDomain}</span>
				</div>
				<p id="live-store-slug-help" className={problem ? 'text-sm text-kumo-danger' : 'text-sm text-kumo-subtle'}>
					{problem ?? 'Lowercase letters, numbers and hyphens. Changing it moves your store to the new address.'}
				</p>
				{view.status === 'live' && view.hasChanges && <p className="text-sm text-kumo-subtle">Your preview has changes that aren't live yet.</p>}
				{view.status !== 'unpublished' && !view.checkoutConnected && (
					<p className="text-sm text-kumo-danger">This store's checkout isn't connected to payments: its store file has no products.</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button variant="primary" size="sm" onClick={onPublish} disabled={problem !== null || action.disabled || publish.isPending} loading={publish.isPending}>
						{action.label}
					</Button>
					{view.status === 'live' && view.url && (
						<LinkButton size="sm" variant="secondary" href={view.url} target="_blank" rel="noopener noreferrer">
							Open store
						</LinkButton>
					)}
					{view.status === 'live' && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => offline.mutate(undefined, { onSuccess: () => toast.success('Your store is offline'), onError: (error) => toast.error(error.message) })}
							disabled={offline.isPending}
							loading={offline.isPending}
						>
							Take offline
						</Button>
					)}
				</div>
				{view.url && view.status === 'live' && <p className="text-sm break-all">{view.url}</p>}
			</section>
			<DomainSection appId={appId} view={view} />
		</div>
	);
}

function DomainSection({ appId, view }: { appId: string; view: LiveStoreView }) {
	const add = useAddStoreDomain(appId);
	const [hostname, setHostname] = useState('');
	return (
		<section className="grid gap-3 border-t border-kumo-line pt-5">
			<h3 className="text-sm font-medium">Your own domain</h3>
			{!view.domainsAvailable && !view.domain && <p className="text-sm text-kumo-subtle">Custom domains aren't set up yet.</p>}
			{view.domainsAvailable && !view.domain && (
				<form
					className="grid gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						add.mutate(hostname, { onSuccess: () => setHostname(''), onError: (error) => toast.error(error.message) });
					}}
				>
					<label htmlFor="live-store-domain" className="text-sm text-kumo-subtle">
						Use a domain you own, such as shop.yourstore.com. You'll add a few DNS records where you bought it.
					</label>
					<div className="flex gap-2">
						<Input id="live-store-domain" value={hostname} placeholder="shop.yourstore.com" onChange={(event) => setHostname(event.target.value)} />
						<Button type="submit" variant="secondary" size="sm" disabled={hostname.trim() === '' || add.isPending} loading={add.isPending}>
							Add domain
						</Button>
					</div>
				</form>
			)}
			{view.domain && <DomainDetails appId={appId} domain={view.domain} />}
		</section>
	);
}

function DomainDetails({ appId, domain }: { appId: string; domain: StoreDomainView }) {
	const check = useCheckStoreDomain(appId);
	const remove = useRemoveStoreDomain(appId);
	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm font-medium break-all">{domain.hostname}</span>
				{domain.status === 'active' && <Badge variant="success">Connected</Badge>}
				{domain.status === 'pending' && <Badge variant="info">Waiting for DNS</Badge>}
				{domain.status === 'failed' && <Badge variant="outline">Not connected</Badge>}
			</div>
			{domain.lastError && <p className="text-sm text-kumo-danger">{domain.lastError}</p>}
			{domain.status !== 'active' && (
				<div className="grid gap-2">
					<p className="text-sm text-kumo-subtle">Add these records at your domain's DNS provider. It can take a few minutes, sometimes hours, before they're seen.</p>
					<div className="overflow-x-auto rounded-md border border-kumo-line">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="text-kumo-subtle">
									<th className="px-3 py-2 font-medium">Type</th>
									<th className="px-3 py-2 font-medium">Name</th>
									<th className="px-3 py-2 font-medium">Value</th>
								</tr>
							</thead>
							<tbody>
								{domain.records.map((record) => (
									<tr key={`${record.type}-${record.name}`} className="border-t border-kumo-line align-top">
										<td className="px-3 py-2">
											{record.type}
											<div className="text-xs text-kumo-subtle">{PURPOSE_LABELS[record.purpose]}</div>
										</td>
										<td className="px-3 py-2">
											<RecordValue value={record.name} />
										</td>
										<td className="px-3 py-2">
											<RecordValue value={record.value} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
			{domain.status === 'active' && <p className="text-sm break-all">Your store is also at {domain.url}</p>}
			<div className="flex flex-wrap gap-2">
				{domain.status !== 'active' && (
					<Button variant="secondary" size="sm" onClick={() => check.mutate(undefined, { onError: (error) => toast.error(error.message) })} disabled={check.isPending} loading={check.isPending}>
						Check now
					</Button>
				)}
				{domain.status === 'active' && (
					<LinkButton size="sm" variant="secondary" href={domain.url} target="_blank" rel="noopener noreferrer">
						Open {domain.hostname}
					</LinkButton>
				)}
				<Button variant="ghost" size="sm" onClick={() => remove.mutate(undefined, { onError: (error) => toast.error(error.message) })} disabled={remove.isPending} loading={remove.isPending}>
					Remove domain
				</Button>
			</div>
		</div>
	);
}

function RecordValue({ value }: { value: string }) {
	return (
		<span className="inline-flex items-start gap-1">
			<code className="break-all">{value}</code>
			<button type="button" className="shrink-0 text-kumo-subtle hover:text-kumo-default" aria-label={`Copy ${value}`} onClick={() => copy(value)}>
				<Copy className="size-3.5" />
			</button>
		</span>
	);
}
