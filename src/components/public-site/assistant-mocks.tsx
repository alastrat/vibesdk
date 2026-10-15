import type { ReactNode } from 'react';
import type { AssistantId } from '@/content/positioning';

/** A small product window: a status chip above a light panel, cut off by the card's bottom edge. */
function MockWindow({ chip, title, label, children }: { chip: string; title: string; label: string; children: ReactNode }) {
	return (
		<div className="relative pt-4 text-left text-[#1e2a3b]">
			<span className="absolute top-0 left-3 z-10 rounded-md bg-public-blue px-2 py-1 text-[10px] leading-tight font-medium text-white shadow-lg">{chip}</span>
			<div className="rounded-t-xl bg-white px-4 pt-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.35)]">
				<div className="flex items-center justify-between text-[11px]">
					<span className="font-semibold">{title}</span>
					<span className="uppercase tracking-[0.08em] text-public-blue">{label}</span>
				</div>
				<div className="mt-3 grid gap-2.5 text-[11px]">{children}</div>
			</div>
		</div>
	);
}

const STOCK = [
	{ name: 'Ethiopia Guji', left: 6, share: 'w-[12%]', low: true },
	{ name: 'House blend', left: 48, share: 'w-[64%]', low: false },
	{ name: 'Cold brew kit', left: 31, share: 'w-[45%]', low: false },
] as const;

function InventoryMock() {
	return (
		<MockWindow chip="Reorder suggested · 40 bags" title="Inventory" label="Stock">
			{STOCK.map((item) => (
				<div key={item.name} className="grid grid-cols-[1fr_72px_28px] items-center gap-2">
					<span className="truncate">{item.name}</span>
					<span className="h-1.5 rounded-full bg-[#eef1f5]">
						<span className={`block h-full rounded-full ${item.share} ${item.low ? 'bg-[#d9534f]' : 'bg-public-blue'}`} />
					</span>
					<span className={`text-right ${item.low ? 'font-semibold text-[#d9534f]' : 'text-[#5b6576]'}`}>{item.left}</span>
				</div>
			))}
		</MockWindow>
	);
}

function SupportMock() {
	return (
		<MockWindow chip="Answered in 4 seconds" title="Customer chat" label="Live">
			<p className="justify-self-end rounded-lg rounded-br-sm bg-[#eef1f5] px-2.5 py-1.5">Can I return a size M?</p>
			<p className="max-w-[85%] rounded-lg rounded-bl-sm bg-[#eaf1ff] px-2.5 py-1.5">Yes, within 30 days. Here's your return link, and free shipping back.</p>
		</MockWindow>
	);
}

function MarketingMock() {
	return (
		<MockWindow chip="32 carts waiting" title="Cart reminder" label="Sent">
			<p className="rounded-lg bg-[#f7f8fa] px-2.5 py-1.5">Your cart is waiting. Free shipping until Sunday.</p>
			<div className="grid grid-cols-2 gap-2">
				<span className="rounded-lg bg-[#f7f8fa] px-2.5 py-1.5">
					<span className="block text-[9px] uppercase tracking-[0.08em] text-[#5b6576]">Sent</span>
					32
				</span>
				<span className="rounded-lg bg-[#f7f8fa] px-2.5 py-1.5">
					<span className="block text-[9px] uppercase tracking-[0.08em] text-[#5b6576]">Came back</span>9
				</span>
			</div>
		</MockWindow>
	);
}

const MOCKS: Readonly<Record<AssistantId, () => ReactNode>> = {
	inventory: InventoryMock,
	support: SupportMock,
	marketing: MarketingMock,
};

/** An assistant at work; the card's text carries the meaning, so the picture stays decorative. */
export function AssistantMock({ id }: { id: AssistantId }) {
	const Mock = MOCKS[id];
	return <Mock />;
}
