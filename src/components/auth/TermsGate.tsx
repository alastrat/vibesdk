import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { isMessage, useI18n } from '@/lib/i18n';
import { RESET_PASSWORD_PATH, TERMS_OUTDATED_MESSAGE, TERMS_VERSION, VERIFY_EMAIL_PATH } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';
import { TermsAgreementLabel } from './TermsAgreementLabel';

/** Where the window must not appear: the documents it asks the user to read, and the pages opened from account emails. */
const GATE_FREE_PATHS: ReadonlySet<string> = new Set([
	...LEGAL_LINKS.map((link) => link.path),
	RESET_PASSWORD_PATH,
	VERIFY_EMAIL_PATH,
]);

/** One-time agreement for signed-in users who haven't agreed to the current terms version. */
export function TermsGate() {
	const { user } = useAuth();
	const { pathname } = useLocation();

	const open = !!user && !user.isAnonymous && user.termsAccepted === false && !GATE_FREE_PATHS.has(pathname);
	if (!open) return null;

	return <TermsDialog key={user.id} />;
}

/** Owns the agreement state, so it starts unticked for each person. */
function TermsDialog() {
	const { t } = useI18n();
	const { refreshUser, logout } = useAuth();
	const [agreed, setAgreed] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const accept = async () => {
		setPending(true);
		setError(null);
		const failed = t("Couldn't record your agreement");
		try {
			const response = await apiClient.acceptTerms(TERMS_VERSION);
			if (!response.success) throw new Error(response.error?.message || failed);
			await refreshUser();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : failed);
		} finally {
			setPending(false);
		}
	};

	return (
		<Dialog open onOpenChange={() => undefined}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("We've published our Terms of Service and Privacy Policy")}</DialogTitle>
					<DialogDescription>
						{t('Please read and agree to them to keep using Estori.')}
					</DialogDescription>
				</DialogHeader>
				<label className="flex items-start gap-2 text-sm text-kumo-default">
					<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
					<TermsAgreementLabel />
				</label>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={() => void logout()} disabled={pending}>
						{t('Sign out')}
					</Button>
					{/* Terms updated since this page loaded: only a reload fetches the new version. */}
					{error !== null && isMessage(error, TERMS_OUTDATED_MESSAGE) ? (
						<Button variant="primary" onClick={() => window.location.reload()}>
							{t('Reload')}
						</Button>
					) : (
						<Button variant="primary" onClick={() => void accept()} disabled={!agreed} loading={pending}>
							{error ? t('Try again') : t('Continue')}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
