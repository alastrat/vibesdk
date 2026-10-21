import { useState } from 'react';
import { Button, Input } from '@cloudflare/kumo';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { EXTRA_CREDITS, formatCredits } from '@/api-types';
import { clampExtraCredits } from '@/routes/settings/billing-view';

/** Whole thousands of extra credits, typed or stepped; the field settles on the nearest amount when it's left. */
export function CreditsStepper({ value, onChange, disabled = false }: { value: number; onChange: (credits: number) => void; disabled?: boolean }) {
	const [draft, setDraft] = useState<string | null>(null);
	const step = (delta: number) => {
		setDraft(null);
		onChange(clampExtraCredits(value + delta));
	};
	return (
		<div className="flex items-center gap-2">
			<Button
				variant="secondary"
				shape="square"
				aria-label="Fewer credits"
				icon={<MinusIcon />}
				disabled={disabled || value <= EXTRA_CREDITS.minCredits}
				onClick={() => step(-EXTRA_CREDITS.creditsPerUnit)}
			/>
			<Input
				aria-label="Extra credits"
				inputMode="numeric"
				value={draft ?? formatCredits(value)}
				disabled={disabled}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (draft === null) return;
					onChange(clampExtraCredits(Number(draft.replace(/\D/g, ''))));
					setDraft(null);
				}}
				className="w-32 text-center"
			/>
			<Button
				variant="secondary"
				shape="square"
				aria-label="More credits"
				icon={<PlusIcon />}
				disabled={disabled || value >= EXTRA_CREDITS.maxCredits}
				onClick={() => step(EXTRA_CREDITS.creditsPerUnit)}
			/>
		</div>
	);
}
