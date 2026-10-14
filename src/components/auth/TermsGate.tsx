import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';
import { TermsAgreementLabel } from './TermsAgreementLabel';

/** One-time agreement for signed-in users who haven't agreed to the current terms version. */
export function TermsGate() {
	const { user } = useAuth();
	const { pathname } = useLocation();

	// The window must not cover the documents it asks the user to read.
	const onLegalPage = LEGAL_LINKS.some((link) => link.path === pathname);
	const open = !!user && !user.isAnonymous && user.termsAccepted === false && !onLegalPage;
	if (!open) return null;

	return <TermsDialog key={user.id} />;
}

/** Owns the agreement state, so it starts unticked for each person. */
function TermsDialog() {
	const { refreshUser, logout } = useAuth();
	const [agreed, setAgreed] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const accept = async () => {
		setPending(true);
		setError(null);
		try {
			const response = await apiClient.acceptTerms(TERMS_VERSION);
			if (!response.success) throw new Error(response.error?.message || "Couldn't record your agreement");
			await refreshUser();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Couldn't record your agreement");
		} finally {
			setPending(false);
		}
	};

	return (
		<Dialog open onOpenChange={() => undefined}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>We've published our Terms of Service and Privacy Policy</DialogTitle>
					<DialogDescription>
						Please read and agree to them to keep using Estori.
					</DialogDescription>
				</DialogHeader>
				<label className="flex items-start gap-2 text-sm text-kumo-default">
					<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
					<TermsAgreementLabel />
				</label>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={() => void logout()} disabled={pending}>
						Sign out
					</Button>
					{/* Terms updated since this page loaded: only a reload fetches the new version. */}
					{error === TERMS_OUTDATED_MESSAGE ? (
						<Button variant="primary" onClick={() => window.location.reload()}>
							Reload
						</Button>
					) : (
						<Button variant="primary" onClick={() => void accept()} disabled={!agreed} loading={pending}>
							{error ? 'Try again' : 'Continue'}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
