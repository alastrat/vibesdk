import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { SELLER_CARRIER_NAMES, SELLER_CARRIERS, SELLER_ORDERS_PATH, type SellerCarrier, type SellerOrderDetail, type SellerOrderLine } from '@/api-types';
import { ConfirmButton } from '@/components/confirm-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useRefundSellerOrder, useSellerOrder, useSellerOrderShipment } from '@/hooks/use-seller-orders';
import { formatCents } from '@/lib/pricing';
import { CATALOG_PROGRESS_LABELS, PAYMENT_LABELS, customerLabel, moneySplit, shipToLines, storeLabel } from './order-format';

export default function SellerOrderPage() {
	const { id = '' } = useParams();
	const detail = useSellerOrder(id);

	return (
		<div className="size-full">
			<title>{pageTitle('Order')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<Link to={SELLER_ORDERS_PATH} className="w-fit text-sm text-kumo-default underline underline-offset-2">
					Orders
				</Link>
				{detail.data ? (
					<OrderDetail order={detail.data} />
				) : detail.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : (
					<Empty title="Couldn't load the order" description={detail.error?.message} />
				)}
			</div>
		</div>
	);
}

function OrderDetail({ order }: { order: SellerOrderDetail }) {
	const own = order.items.filter((item) => item.kind === 'own');
	const catalog = order.items.filter((item) => item.kind === 'catalog');
	const money = moneySplit(order);
	const address = shipToLines(order.shipTo);

	const copyAddress = () => {
		void navigator.clipboard.writeText(address.join('\n')).then(
			() => toast.success('Address copied'),
			() => toast.error("Couldn't copy the address"),
		);
	};

	return (
		<div className="grid gap-8">
			<section className="grid gap-2">
				<h1 className="text-3xl font-semibold text-kumo-strong">
					Order #{order.orderNumber} at {storeLabel(order.storeTitle)}
				</h1>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'disputed' || order.paymentStatus === 'dispute_lost' ? 'error' : 'secondary'}>{PAYMENT_LABELS[order.paymentStatus]}</Badge>
					{order.mode === 'test' && <Badge variant="outline">Test</Badge>}
					<span className="text-sm text-kumo-subtle">{new Date(order.createdAt).toLocaleString()}</span>
				</div>
				{order.needsAttention && (
					<p role="status" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">
						Check this order before you ship: {order.needsAttention}
					</p>
				)}
				{order.paymentStatus === 'disputed' && order.dispute && (
					<p role="alert" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">
						The shopper's bank is reviewing this payment ({formatCents(order.dispute.amountCents)}).
					</p>
				)}
				{order.paymentStatus === 'dispute_lost' && (
					<p role="alert" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">
						The shopper's bank sided with them. The amount and Stripe's dispute fee came out of your sales.
					</p>
				)}
			</section>

			<div className="grid gap-8 md:grid-cols-2">
				<Section title="Customer">
					<p className="text-sm">{customerLabel(order.customerName, order.customerEmail)}</p>
					{order.customerEmail && (
						<a href={`mailto:${order.customerEmail}`} className="w-fit text-sm break-all underline underline-offset-2">
							{order.customerEmail}
						</a>
					)}
					{order.customerPhone && <p className="text-sm">{order.customerPhone}</p>}
				</Section>
				<Section title="Ship to">
					<address className="text-sm not-italic leading-6">
						{address.map((line, index) => (
							<span key={index} className="block">
								{line}
							</span>
						))}
					</address>
					{order.shipTo && (
						<Button variant="secondary" size="sm" className="w-fit" onClick={copyAddress}>
							Copy address
						</Button>
					)}
				</Section>
			</div>

			{order.note && (
				<Section title="Note">
					<p className="text-sm whitespace-pre-wrap">{order.note}</p>
				</Section>
			)}

			{own.length > 0 && (
				<Section title="You ship">
					<Lines lines={own} />
					<ShipmentPanel order={order} />
				</Section>
			)}

			{catalog.length > 0 && (
				<Section title="Estori ships">
					<ul className="grid gap-2 text-sm">
						{catalog.map((item) => {
							const progress = order.catalogItems.find((entry) => entry.catalogVariantId === item.catalogVariantId);
							return (
								<li key={item.lineNo} className="flex flex-wrap justify-between gap-2 border-t border-kumo-line pt-2">
									<span>
										{item.quantity} × {item.name}
										<span className="block text-xs text-kumo-subtle">
											{item.refunded ? 'Refunded' : progress ? CATALOG_PROGRESS_LABELS[progress.status] : 'Preparing'}
											{progress?.trackingNumber && ` · ${progress.carrier ? `${progress.carrier} ` : ''}${progress.trackingNumber}`}
										</span>
									</span>
									<span>{formatCents(item.unitPriceCents * item.quantity)}</span>
								</li>
							);
						})}
					</ul>
				</Section>
			)}

			<Section title="Money">
				<dl className="grid max-w-sm grid-cols-[1fr_max-content] gap-y-1 text-sm">
					<dt className="text-kumo-subtle">Paid by the shopper</dt>
					<dd className="text-right">{formatCents(money.paidCents)}</dd>
					<dt className="text-kumo-subtle">Estori's fee</dt>
					<dd className="text-right">{formatCents(money.feeCents)}</dd>
					<dt className="text-kumo-subtle">Refunded</dt>
					<dd className="text-right">{formatCents(money.refundedCents)}</dd>
					<dt className="font-medium">Your share</dt>
					<dd className="text-right font-medium">{formatCents(money.shareCents)}</dd>
				</dl>
				<p className="text-xs text-kumo-subtle">Payouts follow your payout schedule.</p>
				<RefundButton order={order} />
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-medium text-kumo-strong">{title}</h2>
			{children}
		</section>
	);
}

function Lines({ lines }: { lines: SellerOrderLine[] }) {
	return (
		<ul className="grid gap-2 text-sm">
			{lines.map((item) => (
				<li key={item.lineNo} className="flex flex-wrap justify-between gap-2 border-t border-kumo-line pt-2">
					<span>
						{item.quantity} × {item.name}
						{item.refunded && <span className="block text-xs text-kumo-subtle">Refunded</span>}
					</span>
					<span>{formatCents(item.unitPriceCents * item.quantity)}</span>
				</li>
			))}
		</ul>
	);
}

/** Marks the order's own items shipped, with an optional carrier and tracking number; editing keeps the first shipped date. */
function ShipmentPanel({ order }: { order: SellerOrderDetail }) {
	const shipment = useSellerOrderShipment(order.id);
	const shipped = order.fulfillmentStatus === 'fulfilled';
	const [editing, setEditing] = useState(false);
	const [carrier, setCarrier] = useState<SellerCarrier | ''>('');
	const [carrierName, setCarrierName] = useState('');
	const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '');

	const submit = (event: FormEvent) => {
		event.preventDefault();
		shipment.mutate(
			{ shipped: true, carrier: carrier || null, ...(carrier === 'other' ? { carrierName } : {}), trackingNumber: trackingNumber.trim() || null },
			{
				onSuccess: () => {
					toast.success(shipped ? 'Shipment saved' : 'Marked shipped');
					setEditing(false);
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	if (shipped && !editing) {
		return (
			<div className="grid gap-2 rounded-md border border-kumo-line p-3 text-sm">
				<p>
					Shipped on {order.shippedAt ? new Date(order.shippedAt).toLocaleDateString() : 'an earlier date'}
					{order.carrier && ` with ${order.carrier}`}
					{order.trackingNumber && `, tracking ${order.trackingNumber}`}.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={shipment.isPending}>
						Edit
					</Button>
					<ConfirmButton
						label="Mark as not shipped"
						title="Mark this order as not shipped?"
						description="It goes back to your To ship list."
						pending={shipment.isPending}
						variant="ghost"
						onConfirm={() => shipment.mutate({ shipped: false }, { onSuccess: () => toast.success('Marked as not shipped'), onError: (error) => toast.error(error.message) })}
					/>
				</div>
			</div>
		);
	}

	return (
		<form className="grid max-w-md gap-3 rounded-md border border-kumo-line p-3 text-sm" onSubmit={submit}>
			<label className="grid gap-1">
				<span className="text-kumo-subtle">Carrier</span>
				<select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-kumo-default" value={carrier} onChange={(event) => setCarrier(event.target.value as SellerCarrier | '')}>
					<option value="">No carrier</option>
					{SELLER_CARRIERS.map((option) => (
						<option key={option} value={option}>
							{option === 'other' ? 'Other' : SELLER_CARRIER_NAMES[option]}
						</option>
					))}
				</select>
			</label>
			{carrier === 'other' && (
				<label className="grid gap-1">
					<span className="text-kumo-subtle">Carrier name</span>
					<Input value={carrierName} maxLength={40} onChange={(event) => setCarrierName(event.target.value)} required />
				</label>
			)}
			<label className="grid gap-1">
				<span className="text-kumo-subtle">Tracking number (optional)</span>
				<Input value={trackingNumber} maxLength={64} onChange={(event) => setTrackingNumber(event.target.value)} />
			</label>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={shipment.isPending} loading={shipment.isPending}>
					{shipped ? 'Save' : 'Mark shipped'}
				</Button>
				{editing && (
					<Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}

/** Refunds the lines the seller picks; the seller's Stripe balance pays, and the page says when it's short. */
function RefundButton({ order }: { order: SellerOrderDetail }) {
	const refund = useRefundSellerOrder(order.appId, order.id);
	const [open, setOpen] = useState(false);
	const [chosen, setChosen] = useState<number[]>([]);
	const refundable = order.items.filter((item) => !item.refunded);
	if (refundable.length === 0 || order.paymentStatus === 'refunded') return null;
	const total = refundable.filter((item) => chosen.includes(item.lineNo)).reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
	const toggle = (lineNo: number) => setChosen((current) => (current.includes(lineNo) ? current.filter((entry) => entry !== lineNo) : [...current, lineNo]));

	const confirm = () => {
		refund.mutate(
			{ lineNos: chosen, requestId: crypto.randomUUID() },
			{
				onSuccess: () => {
					toast.success('Refunded');
					setOpen(false);
					setChosen([]);
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	return (
		<>
			<Button variant="secondary" size="sm" className="w-fit" onClick={() => setOpen(true)}>
				Refund items
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Refund items</DialogTitle>
						<DialogDescription>The shopper gets the chosen items' price back. Your Stripe balance pays for the refund.</DialogDescription>
					</DialogHeader>
					<ul className="grid gap-2 text-sm">
						{refundable.map((item) => (
							<li key={item.lineNo}>
								<label className="flex items-center justify-between gap-3">
									<span className="flex items-center gap-2">
										<input type="checkbox" checked={chosen.includes(item.lineNo)} onChange={() => toggle(item.lineNo)} />
										{item.quantity} × {item.name}
									</span>
									<span>{formatCents(item.unitPriceCents * item.quantity)}</span>
								</label>
							</li>
						))}
					</ul>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button size="sm" onClick={confirm} disabled={refund.isPending || chosen.length === 0} loading={refund.isPending}>
							Refund {formatCents(total)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
