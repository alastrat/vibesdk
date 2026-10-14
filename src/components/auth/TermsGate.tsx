import { useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { TERMS_VERSION } from '@/api-types';

/** One-time agreement for signed-in users who haven't agreed to the current terms version. */
export function TermsGate() {
	const { user, refreshUser, logout } = useAuth();
	const [agreed, setAgreed] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const open = !!user && !user.isAnonymous && user.termsAccepted === false;
	if (!open) return null;

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
					<span>
						I'm 18 or older and agree to the{' '}
						<a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a> and{' '}
						<a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>
					</span>
				</label>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={() => void logout()} disabled={pending}>
						Sign out
					</Button>
					<Button variant="primary" onClick={() => void accept()} disabled={!agreed} loading={pending}>
						{error ? 'Try again' : 'Continue'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
