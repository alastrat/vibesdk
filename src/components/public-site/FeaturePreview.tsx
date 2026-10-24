import { t, getLocale } from '@/lib/i18n';
import { formatUsd } from '@/lib/plans';
import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react';
import type { StorePreview } from '@/content/industries';
import { cn } from '@/lib/utils';

const ROW = 'flex items-center justify-between gap-4 border-t border-public-line py-2.5 first:border-t-0 first:pt-0 last:pb-0';
const CHIP = 'rounded-full px-3 py-1.5 text-[13px] ring-1 ring-inset';

function PreviewBody({ preview }: { preview: StorePreview }) {
	switch (preview.kind) {
		case 'swatches':
			return (
				<>
					<div className="flex flex-wrap gap-2">
						{preview.swatches.map((color, index) => (
							<span
								key={color}
								className={cn('size-7 rounded-full ring-1 ring-black/10', index === preview.selected && 'ring-2 ring-public-ink ring-offset-2')}
								style={{ backgroundColor: color }}
							/>
						))}
					</div>
					<p className="mt-3 text-[13px] text-public-muted">{t(preview.caption)}</p>
				</>
			);
		case 'options':
			return (
				<>
					<div className="flex flex-wrap gap-2">
						{preview.options.map((option, index) => (
							<span
								key={option}
								className={cn(CHIP, index === preview.selected ? 'bg-public-ink text-white ring-public-ink' : 'text-public-ink ring-public-line')}
							>
								{t(option)}
							</span>
						))}
					</div>
					{preview.caption && <p className="mt-3 text-[13px] text-public-muted">{t(preview.caption)}</p>}
				</>
			);
		case 'table':
			return (
				<dl className="text-[14px]">
					{preview.rows.map(([label, value]) => (
						<div key={label} className={ROW}>
							<dt className="text-public-muted">{t(label)}</dt>
							<dd className="text-right">{t(value)}</dd>
						</div>
					))}
				</dl>
			);
		case 'list':
			return (
				<ul className="text-[14px]">
					{preview.items.map((item, index) => (
						<li key={item} className={cn(ROW, 'justify-start gap-3')}>
							{preview.style === 'steps' && (
								<span className="grid size-6 shrink-0 place-items-center rounded-full bg-public-ink text-[12px] text-white">{index + 1}</span>
							)}
							{preview.style === 'checks' && (
								<span className="grid size-5 shrink-0 place-items-center rounded-md bg-public-blue text-white">
									<CheckIcon weight="bold" className="size-3" />
								</span>
							)}
							{preview.style === 'plain' && <span className="size-8 shrink-0 rounded-lg bg-[#efedea]" />}
							<span className="min-w-0 flex-1">{t(item)}</span>
							{preview.style === 'plain' && <CaretRightIcon className="size-4 text-public-muted" />}
						</li>
					))}
				</ul>
			);
		case 'bundle':
			return (
				<>
					<ul className="grid gap-2 text-[14px]">
						{preview.items.map((item) => (
							<li key={item} className="flex items-center gap-2.5">
								<CheckIcon weight="bold" className="size-3.5 text-public-blue" />
								{t(item)}
							</li>
						))}
					</ul>
					<div className="mt-4 flex items-center justify-between gap-3">
						<span className="text-[14px] font-medium">{/^\$[\d.]+$/.test(preview.price) ? formatUsd(Math.round(Number(preview.price.slice(1)) * 100), getLocale()) : t(preview.price)}</span>
						<span className="rounded-full bg-public-blue px-4 py-2 text-[13px] text-white">{t("Add set to cart")}</span>
					</div>
				</>
			);
	}
}

/**
 * What a feature adds to a store, drawn as a small white card over the feature's photo: a shade picker, size options, a
 * table, a list or a bundle. Decorative: the panel beside it carries the meaning.
 */
export function FeaturePreview({ preview }: { preview: StorePreview }) {
	return (
		<div aria-hidden className="w-full max-w-[17rem] rounded-2xl bg-white p-5 text-left text-public-ink shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
			<p className="text-[15px] font-medium">{t(preview.title)}</p>
			<div className="mt-3">
				<PreviewBody preview={preview} />
			</div>
		</div>
	);
}
