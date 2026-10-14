import { describe, expect, it, vi } from 'vitest';
import { createEmailSender, isEmailSendingEnabled } from './sender';
import { EMAIL_FROM, type OutgoingEmail, type TransactionalEmailBinding } from './types';

const MESSAGE: OutgoingEmail = {
	to: 'user@example.com',
	subject: 'Reset your Estori password',
	html: '<p>hi</p>',
	text: 'hi https://estori.app/reset-password?token=abc',
};

function envWith(values: { ENVIRONMENT: string; EMAIL?: TransactionalEmailBinding }): Env {
	return values as unknown as Env;
}

describe('createEmailSender', () => {
	it('sends through the Cloudflare binding from the Estori address', async () => {
		const send = vi.fn().mockResolvedValue({ messageId: 'm1' });
		const sender = createEmailSender(envWith({ ENVIRONMENT: 'prod', EMAIL: { send } }));

		expect(sender).not.toBeNull();
		await sender!.send(MESSAGE);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith({
			to: MESSAGE.to,
			from: EMAIL_FROM,
			subject: MESSAGE.subject,
			html: MESSAGE.html,
			text: MESSAGE.text,
		});
	});

	it('prefers the binding over the dev log in a dev environment', async () => {
		const send = vi.fn().mockResolvedValue({ messageId: 'm2' });
		const sender = createEmailSender(envWith({ ENVIRONMENT: 'dev', EMAIL: { send } }));
		await sender!.send(MESSAGE);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('lets a binding failure reach the caller', async () => {
		const send = vi.fn().mockRejectedValue(new Error('rejected'));
		const sender = createEmailSender(envWith({ ENVIRONMENT: 'prod', EMAIL: { send } }));
		await expect(sender!.send(MESSAGE)).rejects.toThrow('rejected');
	});

	it('returns a log-only sender in dev when there is no binding', async () => {
		const sender = createEmailSender(envWith({ ENVIRONMENT: 'dev' }));
		expect(sender).not.toBeNull();
		await expect(sender!.send(MESSAGE)).resolves.toBeUndefined();
	});

	it('logs one entry with the recipient, subject and text in dev', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		try {
			await createEmailSender(envWith({ ENVIRONMENT: 'dev' }))!.send(MESSAGE);
			expect(log).toHaveBeenCalledTimes(1);
			const entry = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
			expect(entry).toMatchObject({
				level: 'info',
				component: 'Email',
				to: MESSAGE.to,
				subject: MESSAGE.subject,
				text: MESSAGE.text,
			});
			expect(entry).not.toHaveProperty('html');
		} finally {
			log.mockRestore();
		}
	});

	it('returns null in production when there is no binding', () => {
		expect(createEmailSender(envWith({ ENVIRONMENT: 'prod' }))).toBeNull();
	});
});

describe('isEmailSendingEnabled', () => {
	it('is true with a binding', () => {
		expect(isEmailSendingEnabled(envWith({ ENVIRONMENT: 'prod', EMAIL: { send: vi.fn() } }))).toBe(true);
	});

	it('is true in dev without a binding', () => {
		expect(isEmailSendingEnabled(envWith({ ENVIRONMENT: 'dev' }))).toBe(true);
	});

	it('is false in production without a binding', () => {
		expect(isEmailSendingEnabled(envWith({ ENVIRONMENT: 'prod' }))).toBe(false);
	});
});
