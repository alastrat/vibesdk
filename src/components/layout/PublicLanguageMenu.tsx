import { DropdownMenu } from '@cloudflare/kumo';
import { CaretDownIcon, CheckIcon, GlobeHemisphereWestIcon } from '@phosphor-icons/react';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/api-types';
import { useI18n } from '@/lib/i18n';
import { chooseLocale } from '@/lib/i18n/choose-locale';
import { cn } from '@/lib/utils';

/** Public visitors choose their language before signing in or creating an account. */
export function PublicLanguageMenu() {
	const { locale, t } = useI18n();
	const choose = (value: unknown) => {
		if (isLocale(value)) void chooseLocale(value);
	};

	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<button
						type="button"
						aria-label={`${t('Language')}: ${LOCALE_NAMES[locale]}`}
						className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-public-charcoal transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue data-[popup-open]:bg-white data-[popup-open]:text-public-charcoal"
					>
						<GlobeHemisphereWestIcon aria-hidden className="size-[18px] shrink-0" />
						<span lang={locale}>{LOCALE_NAMES[locale]}</span>
						<CaretDownIcon aria-hidden className="size-3 transition-transform in-data-[popup-open]:rotate-180" />
					</button>
				}
			/>
			<DropdownMenu.Content
				align="end"
				sideOffset={8}
				data-mode="light"
				className="z-50 w-64 rounded-xl border border-public-line bg-white p-2 font-public text-public-charcoal shadow-xl"
			>
				<DropdownMenu.RadioGroup value={locale} onValueChange={choose}>
					{LOCALES.map((code) => (
						<DropdownMenu.RadioItem
							key={code}
							value={code}
							closeOnClick
							className={cn(
								'my-1 flex min-h-11 items-center justify-between rounded-lg px-3 text-[15px]',
								locale === code
									? 'bg-public-charcoal text-white data-highlighted:bg-public-charcoal data-highlighted:text-white'
									: 'text-public-charcoal data-highlighted:bg-[#f4f4f5] data-highlighted:text-public-charcoal',
							)}
						>
							<span lang={code}>{LOCALE_NAMES[code]}</span>
							{locale === code && <CheckIcon aria-hidden className="size-4" />}
						</DropdownMenu.RadioItem>
					))}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
