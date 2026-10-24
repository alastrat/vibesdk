import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/settings/index.tsx',
		'/src/routes/settings/billing.tsx',
		'/src/components/layout/app-layout.tsx',
		'/src/components/billing/PlanButton.tsx',
		'/src/components/billing/BillingBanner.tsx',
		'/src/components/billing/UpgradeDialog.tsx',
		'/src/hooks/use-billing.ts',
		'/src/lib/api-client.ts',
		'/src/routes/settings/billing-view.ts',
		'/src/components/billing/upgrade-action.ts',
		'/src/components/billing/PaymentMethodCard.tsx',
		'/src/components/billing/BillingHistory.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

// Every source in the app, for the words no page may use; this file only names them to forbid them.
const app = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/routes/billing-page-guard.test.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the billing page', () => {
	it('is a signed-in page in the app, linked from settings only when billing is on', () => {
		const routes = source('/src/routes.tsx');
		const appRoutes = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		expect(appRoutes).toContain('path: childPath(BILLING_PATH)');
		expect(appRoutes.slice(appRoutes.indexOf('path: childPath(BILLING_PATH)'), appRoutes.indexOf('path: childPath(BILLING_PATH)') + 200)).toContain('protectedPage(');
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('billing.data?.enabled &&');
		expect(settings).toContain('to={BILLING_PATH}');
	});

	it('waits for the webhook after a checkout, every 2 seconds for up to 30', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain('refetchInterval: confirming ? CONFIRM_POLL_MS : false');
		expect(page).toContain('CONFIRM_TIMEOUT_MS');
		expect(page).toContain('Confirming your payment…');
		expect(page).toContain('Your payment is being confirmed. Refresh in a minute.');
		expect(page).toContain('id="extra-credits"');
	});

	it('keeps asking after a plan change until the page shows it, within the same bounds', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain("setWaiting({ kind: 'change', action })");
		expect(page).toContain('showsChange(waiting.action, view)');
	});

	it("opens a plan's next step from a link followed on the billing page itself, not only on arrival", () => {
		const page = source('/src/routes/settings/billing.tsx');
		const effect = page.slice(page.indexOf('const plan = requestedPlanOf(location.search);'));
		expect(effect.slice(0, 600)).toContain('[location.pathname, location.search, location.hash, navigate]');
		expect(page).not.toContain('useState(() => {');
	});

	it('shows the banner on every app page, and sends signed-out buyers to sign up, then back to their plan', () => {
		expect(source('/src/components/layout/app-layout.tsx')).toContain('<BillingBanner />');
		expect(source('/src/components/billing/PlanButton.tsx')).toContain('usePlanCheckout()');
		// The checkout itself is a hook, so the billing page starts it the same way as the button.
		const checkout = source('/src/hooks/use-billing.ts');
		expect(checkout).toContain('setIntendedUrl(planBillingPath(plan, interval, monthlyCredits))');
		expect(checkout).toContain("navigate('/signup')");
	});

	it("takes a plan or an amount of extra credits to Estori's own checkout page, which opens the session itself", () => {
		const hooks = source('/src/hooks/use-billing.ts');
		expect(hooks).toContain('navigate(planCheckoutPath(plan, interval, monthlyCredits))');
		expect(hooks).toContain('navigate(`${BILLING_CHECKOUT_PATH}?credits=${credits}`)');
		expect(hooks).not.toContain('window.location');
		expect(hooks).not.toContain('apiClient.startPlanCheckout');
		expect(hooks).not.toContain('apiClient.buyCredits');
		expect(source('/src/routes/settings/billing.tsx')).not.toContain('window.location');
		const dialog = source('/src/components/billing/UpgradeDialog.tsx');
		expect(dialog).toContain('usePlanCheckout()');
		expect(dialog).not.toContain('window.location');
		expect(dialog).not.toContain('apiClient');
	});

	it("has no way into Stripe's billing portal", () => {
		for (const path of ['/src/routes/settings/billing.tsx', '/src/routes/settings/billing-view.ts', '/src/components/billing/BillingBanner.tsx', '/src/hooks/use-billing.ts', '/src/lib/api-client.ts']) {
			expect(source(path), path).not.toMatch(/portal/i);
		}
	});

	it('says "Open billing", and never "Manage billing", anywhere in the app', () => {
		for (const [path, text] of Object.entries(app)) expect(text, path).not.toContain('Manage billing');
		expect(source('/src/components/billing/upgrade-action.ts')).toContain("label: t('Open billing')");
		expect(source('/src/routes/settings/billing-view.ts')).toContain("action: { kind: 'link', to: BILLING_PATH, label: t('Open billing') }");
	});

	it("shows the card on file and the invoices, for an account that has billing details", () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain('view.canManageBilling && (');
		expect(page).toContain('<PaymentMethodCard card={view.card} />');
		expect(page).toContain('<BillingHistory />');
		const card = source('/src/components/billing/PaymentMethodCard.tsx');
		expect(card).toContain('to={BILLING_CARD_PATH}');
		expect(card).toContain('Change card');
		expect(card).toContain('cardLabelFor(card)');
	});

	it('offers a seller whose renewal failed both ways out, and keeps the buttons from pressing twice', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain('pastDueActionsFor(view)');
		expect(page).toContain('{actions.payNow}');
		expect(page).toContain('href={actions.updateCard.to}');
		expect(page).toContain('{actions.updateCard.label}');
		expect(page).toContain('loading={paying}');
		expect(page).toContain('onClick={onPayNow}');
		expect(page).toContain('paying={payNow.isPending}');
		expect(page).toContain('onPayNow={() => payNow.mutate()}');
		const view = source('/src/routes/settings/billing-view.ts');
		expect(view).toContain("t('Pay now with {brand} ending {last4}'");
		expect(view).toContain("UPDATE_CARD_AND_PAY_LABEL = msg('Update card and pay')");
		expect(view).toContain('cardPathOf(\'pay\')');
	});

	it("pays the failed renewal through one guarded call that finishes the bank's confirmation, and refreshes the plan after it", () => {
		const hooks = source('/src/hooks/use-billing.ts');
		const payNow = hooks.slice(hooks.indexOf('export function usePayNow('), hooks.indexOf('export function useInvoiceDownload('));
		expect(payNow).toContain('singleFlight(');
		expect(payNow).toContain('settlePayment(await unwrap(apiClient.payOpenInvoice(), PAY_FAILED_MESSAGE))');
		expect(payNow).toContain('invalidateQueries({ queryKey: queryKeys.billing() })');
	});

	it('waits for the webhook after a failed renewal was paid, the same way it waits after a checkout', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain("setWaiting({ kind: 'renewal' })");
		expect(page).toContain('isRenewalPaid(view)');
		expect(page).toContain("returned === 'renewal'");
	});

	it('has an invoice history section the billing emails can link to, and scrolls to it', () => {
		const history = source('/src/components/billing/BillingHistory.tsx');
		expect(history).toContain('id="history"');
		expect(history).toContain('HISTORY_EMPTY_MESSAGE');
		expect(history).toContain('Download');
		expect(source('/src/routes/settings/billing.tsx')).toContain("'#history'");
	});

	it("downloads an invoice's PDF through the API client, never an anchor to the route, so a refusal is a toast and not a page of JSON", () => {
		const history = source('/src/components/billing/BillingHistory.tsx');
		expect(history).not.toMatch(/href=/);
		expect(history).toContain('useInvoiceDownload()');
		const hooks = source('/src/hooks/use-billing.ts');
		const download = hooks.slice(hooks.indexOf('export function useInvoiceDownload('));
		expect(download).toContain('apiClient.downloadInvoicePdf(invoiceId)');
		expect(download).toContain('saveBlob(file.blob, file.filename)');
		expect(download).toContain('toast.error(t(downloadFailureMessage(failure, INVOICE_DOWNLOAD_FAILED_MESSAGE)))');
	});

	it('has the card page and its return route in the app, signed in, after the billing page', () => {
		const routes = source('/src/routes.tsx');
		const appRoutes = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		for (const path of ['BILLING_CARD_PATH', 'BILLING_CARD_RETURN_PATH']) {
			const at = appRoutes.indexOf(`path: childPath(${path})`);
			expect(at, path).toBeGreaterThan(-1);
			expect(appRoutes.slice(at, at + 200), path).toContain('protectedPage(');
		}
		expect(appRoutes.indexOf('path: childPath(BILLING_PATH)')).toBeGreaterThan(-1);
		expect(appRoutes.indexOf('path: childPath(BILLING_PATH)')).toBeLessThan(appRoutes.indexOf('path: childPath(BILLING_CARD_PATH)'));
	});
});

describe('the billing calls of the API client', () => {
	const client = source('/src/lib/api-client.ts');
	const billing = client.slice(client.indexOf('async getBilling('), client.indexOf('async getSellerLimits('));

	it('reaches each billing route through the one request that sends the CSRF token with a write', () => {
		for (const call of [
			"this.request<CheckoutClientStart>('/api/billing/checkout', { method: 'POST', body })",
			"this.request<CheckoutClientStart>('/api/billing/credits', { method: 'POST', body })",
			'this.request<CheckoutTermsView>(`/api/billing/checkout/terms?${new URLSearchParams({ session_id: sessionId })}`)',
			"this.request<{ recorded: true }>('/api/billing/checkout/consent', { method: 'POST', body })",
			'this.request<CheckoutStatusView>(`/api/billing/checkout/status?${new URLSearchParams({ session_id: sessionId })}`)',
			"this.request<CardSetupStart>('/api/billing/card', { method: 'POST', body: { mode } })",
			"this.request<InvoicePaymentResult>('/api/billing/card/complete', { method: 'POST', body: { sessionId } })",
			"this.request<InvoicePaymentResult>('/api/billing/invoices/pay', { method: 'POST' })",
			"this.request<InvoiceView[]>('/api/billing/history')",
		]) {
			expect(billing, call).toContain(call);
		}
		expect(billing).not.toContain('fetch(');
	});

	it("fetches an invoice's PDF from a path on Estori, through the one request that sends credentials, with the server's file name", () => {
		expect(billing).toContain('async downloadInvoicePdf(invoiceId: string): Promise<InvoicePdfFile> {');
		expect(billing).toContain('this.requestRaw<unknown>(`/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, { skipJsonParsing: true }, false, true)');
		expect(billing).toContain("filenameOfDisposition(response.headers.get('Content-Disposition')");
		expect(billing).not.toContain('invoicePdfUrl');
		expect(billing).not.toContain('stripe.com');
	});
});
