const LINK_CLASS = 'underline hover:text-kumo-strong';

/** The agreement wording shown next to the terms checkbox. */
export function TermsAgreementLabel() {
	return (
		<span>
			I'm 18 or older and agree to the{' '}
			<a href="/terms" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
				Terms of Service
			</a>{' '}
			and{' '}
			<a href="/privacy" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
				Privacy Policy
			</a>
		</span>
	);
}
