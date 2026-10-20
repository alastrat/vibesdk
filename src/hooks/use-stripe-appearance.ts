import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useTheme } from '@/contexts/theme-context';
import { BILLING_APPEARANCE_TOKENS, billingAppearance } from '@/lib/stripe/appearance';
import type { StripeAppearance, StripeCheckoutSdk } from '@/lib/stripe/stripe-js';

/** Stripe's look for a card form, from the theme tokens as they are on the page now. */
function appearanceFor(theme: 'light' | 'dark'): StripeAppearance {
	const root = getComputedStyle(document.documentElement);
	const tokens = Object.fromEntries(BILLING_APPEARANCE_TOKENS.map((name) => [name, root.getPropertyValue(name).trim()]));
	return billingAppearance(theme, tokens);
}

/**
 * Stripe's look for a card form: the returned function gives the look for the theme as it is now, to open a form with, and
 * the form in `sdk` is restyled when the theme switches. The theme provider writes the tokens in an effect that runs after a
 * child's, so the look is read a frame after the switch.
 */
export function useStripeAppearance(sdk: RefObject<StripeCheckoutSdk | null>): () => StripeAppearance {
	const { resolvedTheme } = useTheme();
	const theme = useRef(resolvedTheme);

	useEffect(() => {
		theme.current = resolvedTheme;
		const frame = requestAnimationFrame(() => sdk.current?.changeAppearance(appearanceFor(resolvedTheme)));
		return () => cancelAnimationFrame(frame);
	}, [resolvedTheme, sdk]);

	return useCallback(() => appearanceFor(theme.current), []);
}
