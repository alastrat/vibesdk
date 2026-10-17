import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from '../../../services/rate-limit/config';
import { CONTACT_FAILED_MESSAGE, CONTACT_LIMITED_MESSAGE } from '../../../../shared/types/contact';
import { LEGAL_CONTACT } from '../../../../shared/types/legal';

const sources = import.meta.glob<string>(
	['/worker/api/routes/contactRoutes.ts', '/worker/api/routes/index.ts', '/worker/api/controllers/contact/controller.ts', '/worker/types/email-binding.d.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('contact sales routes', () => {
	const routes = source('/worker/api/routes/contactRoutes.ts');

	it('takes the form from anyone, signed in or not', () => {
		expect(routes).toContain("app.post('/api/contact', setAuthLevel(AuthConfig.public)");
	});

	it('shows the requests to admins only', () => {
		expect(routes).toContain("app.get('/api/admin/contact-requests', setAuthLevel(AuthConfig.admin)");
		expect(routes.split('\n').filter((line) => line.includes("'/api/admin/"))).toHaveLength(1);
	});

	it('is registered with the app', () => {
		expect(source('/worker/api/routes/index.ts')).toContain('setupContactRoutes(app);');
	});

	it('limits each client to a few requests an hour, counted in a durable object', () => {
		const limit = DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.CONTACT_SALES];
		expect(limit).toEqual({ enabled: true, store: RateLimitStore.DURABLE_OBJECT, limit: 5, period: 60 * 60 });
		expect(source('/worker/api/controllers/contact/controller.ts')).toContain('RateLimitService.enforceContactSalesRateLimit(');
	});

	it('sends each address at most a couple of confirmations a day, keyed by a hash of the address', () => {
		const limit = DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.CONTACT_RECIPIENT];
		expect(limit).toEqual({ enabled: true, store: RateLimitStore.DURABLE_OBJECT, limit: 2, period: 24 * 60 * 60 });
		const controller = source('/worker/api/controllers/contact/controller.ts');
		expect(controller).toContain('RateLimitService.enforceContactRecipientRateLimit(');
		expect(controller).toContain('confirmationSent: result.confirmationSent');
	});

	it('sends the team notice to an inbox set in the environment, when there is one', () => {
		expect(source('/worker/types/email-binding.d.ts')).toContain('SALES_INBOX?: string;');
		expect(source('/worker/api/controllers/contact/controller.ts')).toContain('teamInbox: env.SALES_INBOX?.trim() || null');
	});

	it('tells someone who is limited, or whose message failed, which address to email instead', () => {
		expect(CONTACT_LIMITED_MESSAGE).toBe(`Too many requests. Please try again in an hour, or email ${LEGAL_CONTACT.support}.`);
		expect(CONTACT_FAILED_MESSAGE).toBe(`Couldn't send your message. Please try again, or email ${LEGAL_CONTACT.support}.`);
		const controller = source('/worker/api/controllers/contact/controller.ts');
		expect(controller).toContain('createErrorResponse<ContactReceivedData>(CONTACT_LIMITED_MESSAGE, 429)');
		expect(controller).toContain('createErrorResponse<ContactReceivedData>(CONTACT_FAILED_MESSAGE, 500)');
	});
});
