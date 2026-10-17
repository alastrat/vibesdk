import { useState } from 'react';
import { LinkButton } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useStripeConnectStatus } from '@/hooks/use-payments';
import { SELLER_SETUP_PATH } from '@/api-types';

const DISMISSED_KEY = 'estori:payments-setup-dismissed';

function readDismissed(): boolean {
	try {
		return window.localStorage.getItem(DISMISSED_KEY) === '1';
	} catch {
		return false;
	}
}

/** After sign-up: offers payments setup to a signed-in user with no Stripe account, until they set up or dismiss it. */
export function PaymentsSetupPrompt() {
	const { user } = useAuth();
	const signedIn = !!user && !user.isAnonymous;
	const status = useStripeConnectStatus(signedIn);
	const [dismissed, setDismissed] = useState(readDismissed);

	if (!signedIn || dismissed || !status.data?.configured || status.data.connected) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(DISMISSED_KEY, '1');
		} catch {
			// Browser storage may be off; the prompt just returns next visit.
		}
	};

	return (
		<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ring ring-kumo-hairline">
			<span className="text-sm text-kumo-default">Want your stores to take payments? Set up payments when you're ready to sell.</span>
			<div className="flex items-center gap-2">
				<button type="button" className="text-sm text-kumo-subtle underline" onClick={dismiss}>
					Not now
				</button>
				<LinkButton size="sm" variant="primary" href={SELLER_SETUP_PATH}>
					Set up payments
				</LinkButton>
			</div>
		</div>
	);
}
