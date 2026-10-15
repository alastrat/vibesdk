import { useId } from 'react';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/** A number with minus and plus buttons, kept between `min` and `max`; `noun` names what is counted for the buttons. */
export function Stepper({
	label,
	noun,
	value,
	onChange,
	min = 0,
	max = 100_000,
	step = 1,
	className,
}: {
	label: string;
	noun: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	className?: string;
}) {
	const id = useId();
	const set = (next: number) => onChange(Math.min(max, Math.max(min, Number.isFinite(next) ? Math.round(next) : min)));
	const button = 'grid size-9 place-items-center text-public-ink transition-colors hover:bg-[#eef0f3] disabled:cursor-not-allowed disabled:opacity-40';
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
			<label htmlFor={id} className="text-[15px] text-public-ink">
				{label}
			</label>
			<div className="flex items-center overflow-hidden rounded-lg bg-white ring-1 ring-public-line focus-within:ring-2 focus-within:ring-public-blue">
				<button type="button" aria-label={`Fewer ${noun}`} disabled={value <= min} onClick={() => set(value - step)} className={button}>
					<MinusIcon className="size-4" aria-hidden />
				</button>
				<input
					id={id}
					type="number"
					inputMode="numeric"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(event) => set(Number(event.target.value))}
					className="h-9 w-20 border-x border-public-line text-center text-[15px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<button type="button" aria-label={`More ${noun}`} disabled={value >= max} onClick={() => set(value + step)} className={button}>
					<PlusIcon className="size-4" aria-hidden />
				</button>
			</div>
		</div>
	);
}
