import { expect, it } from 'vitest';
import { runWithLocale, currentLocale, requestLocale } from './request-locale';
import { BaseController } from '../../api/controllers/baseController';
import { keepAlive, runInRequestScope } from '../posthog/request-scope';
import type { AuthUser } from '../../types/auth-types';
import { validatePassword } from '../../utils/validationUtils';
it('prefers the saved locale, then negotiates the request language', async () => {
	const request = new Request('https://estori.test/api/example', { headers: { 'Accept-Language': 'pt-PT, en;q=0.8' } });
	expect(await requestLocale({} as Env, request, { locale: 'es' } as AuthUser)).toBe('es');
	expect(await requestLocale({} as Env, request, null)).toBe('pt-BR');
});
it('translates controller errors across awaits without leaking concurrent request locales', async () => {
	const answers = await Promise.all(
		(['es', 'pt-BR'] as const).map((locale) =>
			runWithLocale(locale, async () => {
				await Promise.resolve();
				return (await BaseController.createErrorResponse('App not found', 404).json()) as { error: { message: string } };
			}),
		),
	);
	expect(answers.map((answer) => answer.error.message)).toEqual(['App no encontrada', 'App não encontrado']);
	expect(currentLocale()).toBe('en');
	expect(((await BaseController.createErrorResponse('App not found', 404).json()) as { error: { message: string } }).error.message).toBe(
		'App not found',
	);
});
it('retains waitUntil through a nested language scope', async () => {
	const pending: Promise<unknown>[] = [];
	await runInRequestScope({ waitUntil: (work) => pending.push(work) }, () =>
		runWithLocale('es', async () => {
			await Promise.resolve();
			keepAlive(Promise.resolve());
			expect(currentLocale()).toBe('es');
		}),
	);
	expect(pending).toHaveLength(1);
});
it('translates each password refusal before several reasons are joined', () => {
	const errors = runWithLocale('es', () => validatePassword('a').errors);
	expect(errors).toContain('La contraseña debe tener al menos 8 caracteres');
	expect(errors).toContain('La contraseña debe incluir al menos una letra mayúscula');
});
it('translates success messages without changing user-written fields', async () => {
	const response = runWithLocale('es', () =>
		BaseController.createSuccessResponse({ message: 'Your password is updated.', title: 'My English title' }),
	);
	const body = (await response.json()) as { data: { message: string; title: string } };
	expect(body.data.message).toBe('Tu contraseña se actualizó.');
	expect(body.data.title).toBe('My English title');
});
