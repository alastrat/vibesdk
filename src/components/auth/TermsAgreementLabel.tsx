import type { ReactNode } from 'react';
import { DEFAULT_LOCALE } from '@/api-types';
import { T, useI18n } from '@/lib/i18n';

const LINK_CLASS = 'underline hover:text-kumo-strong';

/** A link to a legal document. The documents stay in English, so outside English the link says so. */
function LegalLink({ href, children }: { href: string; children: ReactNode }) {
	const { locale, t } = useI18n();
	return (
		<>
			<a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
				{children}
			</a>
			{locale !== DEFAULT_LOCALE && ` ${t('(in English)')}`}
		</>
	);
}

/** The agreement wording shown next to the terms checkbox. */
export function TermsAgreementLabel() {
	return (
		<span>
			<T
				text="I'm 18 or older and agree to the <terms>Terms of Service</terms> and <privacy>Privacy Policy</privacy>"
				components={{
					terms: (children) => <LegalLink href="/terms">{children}</LegalLink>,
					privacy: (children) => <LegalLink href="/privacy">{children}</LegalLink>,
				}}
			/>
		</span>
	);
}
