import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { loadCatalog } from './catalog-loader';
import { chooseLocale } from './choose-locale';
import { applyAccountLocale, bindAccountSaver, getLocale } from './index';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./catalog-loader', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./catalog-loader')>();
	return { loadCatalog: vi.fn(actual.loadCatalog) };
});

interface ToastOptions {
	action: { label: string; onClick: () => void };
}

/** The message and options of the toast shown last. */
function shown(): { message: string; options?: ToastOptions } {
	const [message, options] = vi.mocked(toast.error).mock.lastCall as [string, ToastOptions | undefined];
	return { message, options };
}

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.mocked(toast.error).mockClear();
	vi.mocked(loadCatalog).mockClear();
	bindAccountSaver(null);
	await applyAccountLocale('en');
});

describe('choosing a language', () => {
	it('switches it and shows nothing when it worked', async () => {
		const save = vi.fn(async () => undefined);
		bindAccountSaver(save);
		await chooseLocale('es');
		expect(getLocale()).toBe('es');
		expect(save).toHaveBeenCalledWith('es');
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('says the language was not saved, in the new language, and offers to try again', async () => {
		bindAccountSaver(async () => {
			throw new Error('offline');
		});
		await chooseLocale('es');
		expect(getLocale()).toBe('es');
		expect(shown().message).toBe('No se pudo guardar tu idioma. Inténtalo de nuevo.');
		expect(shown().options?.action.label).toBe('Intentar de nuevo');
	});

	it('saves again when the seller tries again, with no new message once it works', async () => {
		const save = vi.fn<(locale: string) => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
		bindAccountSaver(save);
		await chooseLocale('pt-BR');
		expect(toast.error).toHaveBeenCalledTimes(1);
		shown().options?.action.onClick();
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		expect(save).toHaveBeenLastCalledWith('pt-BR');
		expect(getLocale()).toBe('pt-BR');
		expect(toast.error).toHaveBeenCalledTimes(1);
	});

	it('offers to try again again when the second save fails too', async () => {
		bindAccountSaver(async () => {
			throw new Error('offline');
		});
		await chooseLocale('es');
		shown().options?.action.onClick();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
		expect(shown().options?.action.label).toBe('Intentar de nuevo');
	});

	it('says the language could not be loaded, in the language the app is still in, with no retry', async () => {
		vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
		await chooseLocale('es');
		expect(getLocale()).toBe('en');
		expect(shown()).toEqual({ message: "Couldn't load that language. Reload the page and try again.", options: undefined });
	});

	it('says it in Spanish when the app is in Spanish and Portuguese cannot be loaded', async () => {
		vi.stubGlobal('document', { documentElement: { lang: 'en' } });
		await applyAccountLocale('es');
		vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
		await chooseLocale('pt-BR');
		expect(getLocale()).toBe('es');
		expect(shown().message).toBe('No se pudo cargar ese idioma. Recarga la página e inténtalo de nuevo.');
	});

	it('shows nothing on the sign-in page, where there is nothing to save', async () => {
		await chooseLocale('pt-BR');
		expect(getLocale()).toBe('pt-BR');
		expect(toast.error).not.toHaveBeenCalled();
	});
});
