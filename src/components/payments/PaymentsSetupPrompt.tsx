import { t, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { LinkButton } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useStripeConnectStatus } from '@/hooks/use-payments';
import { SELLER_SETUP_PATH } from '@/api-types';
import { setupPrompt } from './setup-prompt';

const DISMISSED_KEY = 'estori:payments-setup-dismissed';

function readDismissed(): string | null {
	try {
		return window.localStorage.getItem(DISMISSED_KEY);
	} catch {
		return null;
	}
}

/** Offers payments setup to a signed-in user until their stores can take payments, unless they dismissed this step. */
export function PaymentsSetupPrompt() {
	useI18n();
	const { user } = useAuth();
	const signedIn = !!user && !user.isAnonymous;
	const status = useStripeConnectStatus(signedIn);
	const [dismissed, setDismissed] = useState(readDismissed);

	const prompt = signedIn && status.data ? setupPrompt(status.data, dismissed) : null;
	if (!prompt) return null;

	const dismiss = () => {
		setDismissed(prompt.key);
		try {
			window.localStorage.setItem(DISMISSED_KEY, prompt.key);
		} catch {
			// Browser storage may be off; the prompt just returns next visit.
		}
	};

	return (
		<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ring ring-kumo-hairline">
			<span className="text-sm text-kumo-default">{prompt.message}</span>
			<div className="flex items-center gap-2">
				<button type="button" className="text-sm text-kumo-subtle underline" onClick={dismiss}>{t("Not now")}</button>
				<LinkButton size="sm" variant="primary" href={SELLER_SETUP_PATH}>
					{prompt.action}
				</LinkButton>
			</div>
		</div>
	);
}
