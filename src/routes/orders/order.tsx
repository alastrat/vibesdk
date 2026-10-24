import { INTL_LOCALE } from 'shared/i18n/locales';
import { getLocale, t, useI18n } from '@/lib/i18n';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { SELLER_CARRIER_NAMES, SELLER_CARRIERS, SELLER_ORDERS_PATH, type SellerCarrier, type SellerOrderDetail, type SellerOrderLine } from '@/api-types';
import { useBilling } from '@/hooks/use-billing';
import { PlanButton } from '@/components/billing/PlanButton';
import { ConfirmButton } from '@/components/confirm-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useRefundSellerOrder, useSellerOrder, useSellerOrderShipment } from '@/hooks/use-seller-orders';
import { formatCents as centsInLocale } from '@/lib/pricing';
const formatCents = (cents: number) => centsInLocale(cents, getLocale());
import './orders.css';
import { CATALOG_PROGRESS_LABELS, PAYMENT_LABELS, carrierChoice, customerLabel, moneySplit, shipToLines, storeLabel } from './order-format';

export default function SellerOrderPage() {
	useI18n();
	const { id = '', storeId } = useParams();
	const [params] = useSearchParams();
	const returnParams = new URLSearchParams(params);
	if (storeId) returnParams.set('section', 'payments');
	const returnPath = `${storeId ? `/stores/${encodeURIComponent(storeId)}` : SELLER_ORDERS_PATH}${returnParams.size ? `?${returnParams}` : ''}`;
	const detail = useSellerOrder(id);

	return (
		<div className="size-full seller-order-detail">
			<title>{pageTitle(t('Order'))}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-6">
				<Link to={returnPath} className="w-fit text-sm text-kumo-default underline underline-offset-2">{t("Orders")}</Link>
				{detail.data && (!storeId || detail.data.appId === storeId) ? (
					<OrderDetail order={detail.data} />
				) : detail.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : (
					<Empty title={t("Couldn't load the order")} description={detail.error?.message} />
				)}
			</div>
		</div>
	);
}

function OrderDetail({ order }: { order: SellerOrderDetail }) {
	useI18n();
	const own = order.items.filter((item) => item.kind === 'own' && item.productType !== 'digital');
	const catalog = order.items.filter((item) => item.kind === 'catalog');
	const digital = order.items.filter((item) => item.productType === 'digital');
	const money = moneySplit(order);
	const address = shipToLines(order.shipTo);

	const copyAddress = () => {
		void navigator.clipboard.writeText(address.join('\n')).then(
			() => toast.success(t("Address copied")),
			() => toast.error(t("Couldn't copy the address")),
		);
	};

	return (
		<div className="order-detail-body grid gap-6">
			<section className="order-detail-heading grid gap-2">
				<h1 className="text-3xl font-semibold text-kumo-strong">{t('Order #{number} at {store}', { number: order.orderNumber, store: storeLabel(order.storeTitle) })}
				</h1>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'disputed' || order.paymentStatus === 'dispute_lost' ? 'error' : 'secondary'}>{t(PAYMENT_LABELS[order.paymentStatus])}</Badge>
					{order.mode === 'test' && <Badge variant="outline">{t("Test")}</Badge>}
					<span className="text-sm text-kumo-subtle">{new Date(order.createdAt).toLocaleString(INTL_LOCALE[getLocale()])}</span>
				</div>
				{order.needsAttention && (
					<p role="status" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">{t('Check this order before you ship: {reason}', { reason: order.needsAttention })}
					</p>
				)}
				{order.paymentStatus === 'disputed' && order.dispute && (
					<p role="alert" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">{t("The shopper's bank is reviewing this payment ({amount}).", { amount: formatCents(order.dispute.amountCents) })}
					</p>
				)}
				{order.paymentStatus === 'dispute_lost' && (
					<p role="alert" className="rounded-md border border-kumo-line px-3 py-2 text-sm text-kumo-danger">{t("The shopper's bank sided with them. The amount and Stripe's dispute fee came out of your sales.")}</p>
				)}
			</section>

			<div className="grid gap-8 md:grid-cols-2">
				<Section title={t("Customer")}>
					<p className="text-sm">{customerLabel(order.customerName, order.customerEmail)}</p>
					{order.customerEmail && (
						<a href={`mailto:${order.customerEmail}`} className="w-fit text-sm break-all underline underline-offset-2">
							{order.customerEmail}
						</a>
					)}
					{order.customerPhone && <p className="text-sm">{order.customerPhone}</p>}
				</Section>
				{(own.length > 0 || catalog.length > 0) && <Section title={t("Ship to")}>
					<address className="text-sm not-italic leading-6">
						{address.map((line, index) => (
							<span key={index} className="block">
								{line}
							</span>
						))}
					</address>
					{order.shipTo && (
						<Button variant="secondary" size="sm" className="w-fit" onClick={copyAddress}>{t("Copy address")}</Button>
					)}
				</Section>}
			</div>

			{order.note && (
				<Section title={t("Note")}>
					<p className="text-sm whitespace-pre-wrap">{order.note}</p>
				</Section>
			)}

			{digital.length > 0 && <Section title={t("Digital products")}><Lines lines={digital} /></Section>}

			{own.length > 0 && (
				<Section title={t("You ship")}>
					<Lines lines={own} />
					<ShipmentPanel order={order} />
				</Section>
			)}

			{catalog.length > 0 && (
				<Section title={t("Estori ships")}>
					<ul className="grid gap-2 text-sm">
						{catalog.map((item) => {
							const progress = order.catalogItems.find((entry) => entry.catalogVariantId === item.catalogVariantId);
							return (
								<li key={item.lineNo} className="flex flex-wrap justify-between gap-2 border-t border-kumo-line pt-2">
									<span>
										{item.quantity} × {item.name}
										<span className="block text-xs text-kumo-subtle">
											{item.refunded ? t("Refunded") : item.refundPending ? t("Refund pending") : progress ? t(CATALOG_PROGRESS_LABELS[progress.status]) : t("Preparing")}
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

			<Section title={t("Money")}>
				<dl className="grid max-w-sm grid-cols-[1fr_max-content] gap-y-1 text-sm">
					<dt className="text-kumo-subtle">{t("Paid by the shopper")}</dt>
					<dd className="text-right">{formatCents(money.paidCents)}</dd>
					<dt className="text-kumo-subtle">{t("Estori's fee")}</dt>
					<dd className="text-right">{formatCents(money.feeCents)}</dd>
					<dt className="text-kumo-subtle">{t("Refunded")}</dt>
					<dd className="text-right">{formatCents(money.refundedCents)}</dd>
					<dt className="font-medium">{t("Your share")}</dt>
					<dd className="text-right font-medium">{formatCents(money.shareCents)}</dd>
				</dl>
				<p className="text-xs text-kumo-subtle">{t("Payouts follow your payout schedule.")}</p>
				<RefundButton order={order} />
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="order-detail-section grid content-start gap-3">
			<h2 className="text-lg font-medium text-kumo-strong">{title}</h2>
			{children}
		</section>
	);
}

function Lines({ lines }: { lines: SellerOrderLine[] }) {
	useI18n();
	return (
		<ul className="grid gap-2 text-sm">
			{lines.map((item) => (
				<li key={item.lineNo} className="flex flex-wrap justify-between gap-2 border-t border-kumo-line pt-2">
					<span>
						{item.quantity} × {item.name}
						{item.refunded && <span className="block text-xs text-kumo-subtle">{t("Refunded")}</span>}
						{item.refundPending && <span className="block text-xs text-kumo-subtle">{t("Refund pending: refund it again to finish")}</span>}
					</span>
					<span>{formatCents(item.unitPriceCents * item.quantity)}</span>
				</li>
			))}
		</ul>
	);
}

/** Marks the order's own items shipped, with an optional carrier and tracking number; editing keeps the first shipped date. */
function ShipmentPanel({ order }: { order: SellerOrderDetail }) {
	useI18n();
	const billing = useBilling();
	const canTrack = billing.data?.enabled === false || billing.data?.limits.shipmentTracking === true;
	const shipment = useSellerOrderShipment(order.id);
	const shipped = order.fulfillmentStatus === 'fulfilled';
	const [editing, setEditing] = useState(false);
	const [carrier, setCarrier] = useState<SellerCarrier | ''>(() => carrierChoice(order.carrier).carrier);
	const [carrierName, setCarrierName] = useState(() => carrierChoice(order.carrier).carrierName);
	const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '');

	const submit = (event: FormEvent) => {
		event.preventDefault();
		shipment.mutate(
			{ shipped: true, carrier: canTrack ? carrier || null : null, ...(canTrack && carrier === 'other' ? { carrierName } : {}), trackingNumber: canTrack ? trackingNumber.trim() || null : null },
			{
				onSuccess: () => {
					toast.success(shipped ? t("Shipment saved") : t("Marked shipped"));
					setEditing(false);
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	if (shipped && !editing) {
		return (
			<div className="grid gap-2 rounded-md border border-kumo-line p-3 text-sm">
				<p>{t('Shipped on {date}', { date: order.shippedAt ? new Date(order.shippedAt).toLocaleDateString(INTL_LOCALE[getLocale()]) : t("an earlier date") })}
					{order.carrier && t(" with {value1}", { value1: order.carrier })}
					{order.trackingNumber && t(", tracking {value1}", { value1: order.trackingNumber })}.
				</p>
				<div className="flex flex-wrap gap-2">
					{canTrack && <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={shipment.isPending}>{t("Edit")}</Button>}
					<ConfirmButton
						label={t("Mark as not shipped")}
						title={t("Mark this order as not shipped?")}
						description={t("It goes back to your To ship list.")}
						pending={shipment.isPending}
						variant="ghost"
						onConfirm={() => shipment.mutate({ shipped: false }, { onSuccess: () => toast.success(t("Marked as not shipped")), onError: (error) => toast.error(error.message) })}
					/>
				</div>
			</div>
		);
	}

	return (
		<form className="grid max-w-md gap-3 rounded-md border border-kumo-line p-3 text-sm" onSubmit={submit}>
			{billing.data?.enabled && !canTrack && <PremiumOrderFeature text={t('Add shipment tracking with Premium. You can still mark orders as shipped.')} />}
			{canTrack && <>
			<label className="grid gap-1">
				<span className="text-kumo-subtle">{t("Carrier")}</span>
				<select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-kumo-default" value={carrier} onChange={(event) => setCarrier(event.target.value as SellerCarrier | '')}>
					<option value="">{t("No carrier")}</option>
					{SELLER_CARRIERS.map((option) => (
						<option key={option} value={option}>
							{option === 'other' ? t("Other") : SELLER_CARRIER_NAMES[option]}
						</option>
					))}
				</select>
			</label>
			{carrier === 'other' && (
				<label className="grid gap-1">
					<span className="text-kumo-subtle">{t("Carrier name")}</span>
					<Input value={carrierName} maxLength={40} onChange={(event) => setCarrierName(event.target.value)} required />
				</label>
			)}
			<label className="grid gap-1">
				<span className="text-kumo-subtle">{t("Tracking number (optional)")}</span>
				<Input value={trackingNumber} maxLength={64} onChange={(event) => setTrackingNumber(event.target.value)} />
			</label>
			</>}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={shipment.isPending} loading={shipment.isPending}>
					{shipped ? t("Save") : t("Mark shipped")}
				</Button>
				{editing && (
					<Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>{t("Cancel")}</Button>
				)}
			</div>
		</form>
	);
}

/** Refunds the lines the seller picks; the seller's Stripe balance pays, and the page says when it's short. */
function RefundButton({ order }: { order: SellerOrderDetail }) {
	useI18n();
	const billing = useBilling();
	const canRefund = billing.data?.enabled === false || billing.data?.limits.orderRefunds === true;
	const refund = useRefundSellerOrder(order.id);
	const [open, setOpen] = useState(false);
	const [chosen, setChosen] = useState<number[]>([]);
	const refundable = order.items.filter((item) => !item.refunded);
	// Stripe refuses refunds on a disputed charge, and a lost dispute already returned the money.
	if (order.paymentStatus === 'disputed' || order.paymentStatus === 'dispute_lost') {
		return (
			<p className="text-sm text-kumo-subtle">
				{order.paymentStatus === 'disputed' ? t("Refunds are paused while the shopper's bank reviews this payment.") : t("The shopper's bank already returned this payment, so there's nothing to refund.")}
			</p>
		);
	}
	if (refundable.length === 0 || order.paymentStatus === 'refunded') return null;
	if (!canRefund) return billing.data?.enabled ? <PremiumOrderFeature text={t('Issue refunds from Estori with Premium.')} /> : null;
	const total = refundable.filter((item) => chosen.includes(item.lineNo)).reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
	const toggle = (lineNo: number) => setChosen((current) => (current.includes(lineNo) ? current.filter((entry) => entry !== lineNo) : [...current, lineNo]));

	const confirm = () => {
		refund.mutate(
			{ lineNos: chosen, requestId: crypto.randomUUID() },
			{
				onSuccess: () => {
					toast.success(t("Refunded"));
					setOpen(false);
					setChosen([]);
				},
				onError: (error) => toast.error(error.message),
			},
		);
	};

	return (
		<>
			<Button variant="secondary" size="sm" className="w-fit" onClick={() => setOpen(true)}>{t("Refund items")}</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("Refund items")}</DialogTitle>
						<DialogDescription>{t("The shopper gets the chosen items' price back. Your Stripe balance pays for the refund.")}</DialogDescription>
					</DialogHeader>
					<ul className="grid gap-2 text-sm">
						{refundable.map((item) => (
							<li key={item.lineNo}>
								<label className="flex items-center justify-between gap-3">
									<span className="flex items-center gap-2">
										<input type="checkbox" checked={chosen.includes(item.lineNo)} onChange={() => toggle(item.lineNo)} />
										{item.quantity} × {item.name}
										{item.refundPending && <span className="text-xs text-kumo-subtle">{t("(Refund pending)")}</span>}
									</span>
									<span>{formatCents(item.unitPriceCents * item.quantity)}</span>
								</label>
							</li>
						))}
					</ul>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
						<Button size="sm" onClick={confirm} disabled={refund.isPending || chosen.length === 0} loading={refund.isPending}>{t('Refund {amount}', { amount: formatCents(total) })}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}


function PremiumOrderFeature({ text }: { text: string }) {
 const i18n = useI18n();
 return <div className="grid justify-items-start gap-2 rounded-md border border-kumo-line p-3 text-sm"><p className="text-kumo-subtle">{text}</p><PlanButton plan="premium" i18n={i18n} className="px-4 py-2 text-sm" /></div>;
}
