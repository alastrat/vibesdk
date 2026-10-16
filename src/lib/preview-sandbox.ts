/** Sandbox tokens for frames that show a deployed site; deliberately without allow-top-navigation. */
export const PREVIEW_IFRAME_SANDBOX =
	'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-modals allow-orientation-lock allow-popups allow-presentation';

/** The owner's editor preview also lets a store's checkout tab leave the sandbox: Stripe Checkout can't run framed or sandboxed. */
export const EDITOR_PREVIEW_IFRAME_SANDBOX = `${PREVIEW_IFRAME_SANDBOX} allow-popups-to-escape-sandbox`;
