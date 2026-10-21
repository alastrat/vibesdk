import { cn } from '@cloudflare/kumo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ThinkModelOption } from '@/api-types';
import { t } from '@/lib/i18n';

interface ThinkModelPickerProps {
	options: ThinkModelOption[];
	/** Selected model id; an empty string shows the placeholder. */
	value: string;
	onChange: (modelId: string) => void;
	disabled?: boolean;
	className?: string;
}

/** Compact choice of the model that builds the app. */
export function ThinkModelPicker({ options, value, onChange, disabled = false, className }: ThinkModelPickerProps) {
	if (options.length === 0) return null;

	return (
		<Select value={value} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger
				aria-label={t('Model')}
				size="sm"
				className={cn('w-auto gap-1.5 border-none bg-transparent px-2 text-sm shadow-none', className)}
			>
				<SelectValue placeholder={t('Select model')} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
