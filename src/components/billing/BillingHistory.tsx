import { Badge, Button, Empty, LayerCard, Loader } from '@cloudflare/kumo';
import { DownloadSimpleIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useBillingHistory, useInvoiceDownload } from '@/hooks/use-billing';
import { HISTORY_EMPTY_MESSAGE, historyRowsFor, type HistoryRow } from './history-rows';
import { SectionTitle } from './SectionTitle';

function DownloadButton({ id, busy, disabled, onDownload }: { id: string; busy: boolean; disabled: boolean; onDownload: (id: string) => void }) {
	return (
		<Button variant="secondary" size="sm" loading={busy} disabled={disabled && !busy} icon={<DownloadSimpleIcon />} onClick={() => onDownload(id)}>
			Download
		</Button>
	);
}

function InvoiceRow({ row, busy, disabled, onDownload }: { row: HistoryRow; busy: boolean; disabled: boolean; onDownload: (id: string) => void }) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
			<div className="grid min-w-0 gap-0.5">
				<p className="truncate text-sm font-medium text-kumo-default">{row.description}</p>
				<p className="text-xs text-kumo-subtle">{row.date}</p>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<span className="text-sm text-kumo-default">{row.amount}</span>
				<Badge variant={row.status.tone}>{row.status.label}</Badge>
				<DownloadButton id={row.id} busy={busy} disabled={disabled} onDownload={onDownload} />
			</div>
		</li>
	);
}

/** The account's last 24 invoices, newest first, each with a PDF to save. The billing emails link here with `#history`. */
export function BillingHistory() {
	const history = useBillingHistory();
	const download = useInvoiceDownload();
	const rows = history.data ? historyRowsFor(history.data) : null;

	return (
		<LayerCard id="history" className="scroll-mt-4">
			<SectionTitle icon={<ReceiptIcon className="size-4" aria-hidden />}>Billing history</SectionTitle>
			<LayerCard.Primary>
				{rows === null ? (
					history.isError ? (
						<Empty
							size="sm"
							title="Couldn't load your invoices"
							description={history.error.message}
							contents={
								<Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
									Try again
								</Button>
							}
						/>
					) : (
						<div className="flex justify-center py-8">
							<Loader />
						</div>
					)
				) : rows.length === 0 ? (
					<p className="text-sm text-kumo-subtle">{HISTORY_EMPTY_MESSAGE}</p>
				) : (
					<ul className="divide-y divide-kumo-line">
						{rows.map((row) => (
							<InvoiceRow
								key={row.id}
								row={row}
								busy={download.isPending && download.variables === row.id}
								disabled={download.isPending}
								onDownload={download.mutate}
							/>
						))}
					</ul>
				)}
			</LayerCard.Primary>
		</LayerCard>
	);
}
