import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, LinkButton, Loader } from '@cloudflare/kumo';
import { Copy } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmButton } from '@/components/confirm-button';
import { Input } from '@/components/ui/input';
import {
	useAddStoreDomain,
	useCheckStoreDomain,
	useLiveStore,
	usePublishLiveStore,
	useRemoveStoreDomain,
	useTakeLiveStoreOffline,
} from '@/hooks/use-live-store';
import { useFlag } from '@/hooks/use-flag';
import { CUSTOM_DOMAINS_PAUSED_MESSAGE, MAIN_DRAFT_ID, SLUG_MAX_LENGTH, STORE_PUBLISHING_PAUSED_MESSAGE, recordHost, slugProblem, type LiveStoreView, type StoreDomainRecord, type StoreDomainView } from '@/api-types';
import { publishAction } from './publish-action';
import { connectedDomainNote, domainNeedsRecords } from './domain-note';

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
	const publishingPaused = useFlag('store-publishing-paused');
	const [slug, setSlug] = useState(view.slug ?? view.suggestedSlug);
	useEffect(() => setSlug(view.slug ?? view.suggestedSlug), [view.slug, view.suggestedSlug]);

	if (!view.available) {
		return <p className="text-sm text-kumo-subtle">Store addresses aren't set up yet. You can keep building your store in the preview.</p>;
	}
	const problem = slugProblem(slug);
	const action = publishAction(view, slug);
	const onPublish = () =>
		publish.mutate({ slug, draftId: view.draft?.id }, {
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
				{view.status === 'live' && view.hasChanges && <p className="text-sm text-kumo-subtle">Your preview of '{view.draft?.name ?? 'Main'}' has changes that aren't live yet.</p>}
				{view.draft && view.draft.id !== MAIN_DRAFT_ID && action.disabled === false && (
					<p className="text-sm text-kumo-subtle">Main will be behind the live store until you bring these changes in.</p>
				)}
				{view.status !== 'unpublished' && !view.checkoutConnected && (
					<p className="text-sm text-kumo-danger">This store's checkout isn't connected to payments: its store file has no products.</p>
				)}
				{publishingPaused && <p className="text-sm text-kumo-subtle">{STORE_PUBLISHING_PAUSED_MESSAGE}</p>}
				<div className="flex flex-wrap gap-2">
					<Button variant="primary" size="sm" onClick={onPublish} disabled={publishingPaused || problem !== null || action.disabled || publish.isPending} loading={publish.isPending}>
						{action.label}
					</Button>
					{view.status === 'live' && view.url && (
						<LinkButton size="sm" variant="secondary" href={view.url} target="_blank" rel="noopener noreferrer">
							Open store
						</LinkButton>
					)}
					{view.status === 'live' && (
						<ConfirmButton
							label="Take offline"
							title="Take your store offline?"
							description="Shoppers will see that your store isn't open, and checkouts they have open are cancelled. Publish again to reopen it."
							pending={offline.isPending}
							onConfirm={() => offline.mutate(undefined, { onSuccess: () => toast.success('Your store is offline'), onError: (error) => toast.error(error.message) })}
						/>
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
	const domainsPaused = useFlag('custom-domains-paused');
	const [hostname, setHostname] = useState('');
	return (
		<section className="grid gap-3 border-t border-kumo-line pt-5">
			<h3 className="text-sm font-medium">Your own domain</h3>
			{!view.domainsAvailable && !view.domain && <p className="text-sm text-kumo-subtle">Custom domains aren't set up yet.</p>}
			{view.domainsAvailable && !view.domain && domainsPaused && <p className="text-sm text-kumo-subtle">{CUSTOM_DOMAINS_PAUSED_MESSAGE}</p>}
			{view.domainsAvailable && !view.domain && !domainsPaused && (
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
			{view.domain && <DomainDetails appId={appId} domain={view.domain} storeStatus={view.status} />}
		</section>
	);
}

function DomainDetails({ appId, domain, storeStatus }: { appId: string; domain: StoreDomainView; storeStatus: LiveStoreView['status'] }) {
	const check = useCheckStoreDomain(appId);
	const remove = useRemoveStoreDomain(appId);
	const connected = connectedDomainNote(storeStatus);
	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm font-medium break-all">{domain.hostname}</span>
				{domain.status === 'active' && (domain.lastError ? <Badge variant="warning">Check DNS</Badge> : <Badge variant="success">Connected</Badge>)}
				{domain.status === 'pending' && <Badge variant="info">Waiting for DNS</Badge>}
				{domain.status === 'failed' && <Badge variant="outline">Not connected</Badge>}
			</div>
			{domain.lastError && <p className="text-sm text-kumo-danger">{domain.lastError}</p>}
			{domainNeedsRecords(domain) && (
				<div className="grid gap-2">
					<p className="text-sm text-kumo-subtle">Add these records at your domain's DNS provider. It can take a few minutes, sometimes hours, before they're seen.</p>
					{domain.rootDomain && (
						<p className="text-sm text-kumo-subtle">
							Most DNS providers, such as GoDaddy, add {domain.rootDomain} to each name for you, so enter the name as shown. If yours asks for the full name, use the one under it.
						</p>
					)}
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
								{domain.records.map((record) => {
									const host = recordHost(record.name, domain.rootDomain);
									return (
										<tr key={`${record.type}-${record.name}`} className="border-t border-kumo-line align-top">
											<td className="px-3 py-2">
												{record.type}
												<div className="text-xs text-kumo-subtle">{PURPOSE_LABELS[record.purpose]}</div>
											</td>
											<td className="px-3 py-2">
												<RecordValue value={host} />
												{host !== record.name && <div className="text-xs break-all text-kumo-subtle">{record.name}</div>}
											</td>
											<td className="px-3 py-2">
												<RecordValue value={record.value} />
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
			{domain.status === 'active' && connected.showAddress && <p className="text-sm break-all">Your store is also at {domain.url}</p>}
			{domain.status === 'active' && connected.note && <p className="text-sm text-kumo-subtle">{connected.note}</p>}
			<div className="flex flex-wrap gap-2">
				{domainNeedsRecords(domain) && (
					<Button variant="secondary" size="sm" onClick={() => check.mutate(undefined, { onError: (error) => toast.error(error.message) })} disabled={check.isPending} loading={check.isPending}>
						Check now
					</Button>
				)}
				{domain.status === 'active' && connected.showAddress && (
					<LinkButton size="sm" variant="secondary" href={domain.url} target="_blank" rel="noopener noreferrer">
						Open {domain.hostname}
					</LinkButton>
				)}
				<ConfirmButton
					label="Remove domain"
					variant="ghost"
					title="Remove this domain?"
					description={`Your store stops answering on ${domain.hostname}. To connect it again, you'll add new DNS records.`}
					pending={remove.isPending}
					onConfirm={() => remove.mutate(undefined, { onError: (error) => toast.error(error.message) })}
				/>
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
