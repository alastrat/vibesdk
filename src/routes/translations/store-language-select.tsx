import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from '@/api-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** The language a store is written in, each named in itself. */
export function StoreLanguageSelect({ value, onChange, label, disabled = false }: { value: Locale; onChange: (locale: Locale) => void; label: string; disabled?: boolean }) {
	return (
		<Select
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (isLocale(next)) onChange(next);
			}}
		>
			<SelectTrigger aria-label={label} className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{LOCALES.map((code) => (
					<SelectItem key={code} value={code}>
						<span lang={code}>{LOCALE_NAMES[code]}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
