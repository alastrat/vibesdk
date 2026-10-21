/** A page that worded something in the seller's language hears when the language saved on the account changes. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import { useAccountLocaleChange } from './use-account-locale-change';

const account = vi.hoisted((): { locale: string | null } => ({ locale: null }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', locale: account.locale } }) }));

beforeAll(silenceTestRendererDeprecation);

afterEach(async () => {
	await unmountAll();
	account.locale = null;
});

function Probe({ onChange }: { onChange: () => void }) {
	useAccountLocaleChange(onChange);
	return null;
}

describe('useAccountLocaleChange', () => {
	it('stays quiet while the language saved on the account is what it was when the page opened', async () => {
		account.locale = 'es';
		const onChange = vi.fn();
		const renderer = await mountElement(createElement(Probe, { onChange }));
		await act(async () => renderer.update(createElement(Probe, { onChange })));
		expect(onChange).not.toHaveBeenCalled();
	});

	it('tells the page once each time the saved language changes, with the page as it is now', async () => {
		account.locale = 'es';
		const first = vi.fn();
		const renderer = await mountElement(createElement(Probe, { onChange: first }));
		account.locale = 'pt-BR';
		const second = vi.fn();
		await act(async () => renderer.update(createElement(Probe, { onChange: second })));
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
		await act(async () => renderer.update(createElement(Probe, { onChange: second })));
		expect(second).toHaveBeenCalledTimes(1);
		account.locale = 'en';
		await act(async () => renderer.update(createElement(Probe, { onChange: second })));
		expect(second).toHaveBeenCalledTimes(2);
	});

	it('hears a first choice for an account that had none', async () => {
		const onChange = vi.fn();
		const renderer = await mountElement(createElement(Probe, { onChange }));
		account.locale = 'es';
		await act(async () => renderer.update(createElement(Probe, { onChange })));
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
