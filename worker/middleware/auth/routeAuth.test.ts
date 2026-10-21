import { describe, expect, it, vi } from 'vitest';
vi.mock('../../database', () => ({ AppService: class {}, UserService: class {} }));
vi.mock('./ticketAuth', () => ({ authenticateViaTicket: vi.fn(), hasTicketParam: vi.fn() }));

import { AuthConfig, checkAdminRole, routeAuthChecks, type AuthRequirement } from './routeAuth';
import type { AuthUser } from '../../types/auth-types';
import { runWithLocale } from '../../services/i18n/request-locale';

const env = {} as Env;
const member: AuthUser = { id: 'user-1', email: 'member@example.com' };

it('translates middleware refusals while preserving the sign-in action', async () => {
	const result = await runWithLocale('es', () => routeAuthChecks(null, env, AuthConfig.authenticated));
	expect(result.response?.status).toBe(401);
	expect(await result.response?.json()).toMatchObject({
		error: { message: 'Se necesita iniciar sesión', type: 'AUTHENTICATION_REQUIRED', action: 'login' },
	});
});

function adminRequirement(isAdmin: boolean): AuthRequirement {
	return { required: true, level: 'admin', roleCheck: async () => isAdmin };
}

describe('admin routes', () => {
	it('lets admins through', async () => {
		const result = await routeAuthChecks(member, env, adminRequirement(true));
		expect(result.success).toBe(true);
		expect(result.response).toBeUndefined();
	});

	it('refuses signed-in users who are not admins', async () => {
		const result = await routeAuthChecks(member, env, adminRequirement(false));
		expect(result.success).toBe(false);
		expect(result.response?.status).toBe(403);
	});

	it('asks anonymous visitors to sign in', async () => {
		const result = await routeAuthChecks(null, env, adminRequirement(true));
		expect(result.success).toBe(false);
		expect(result.response?.status).toBe(401);
	});

	it('reads the role from the database for the shared admin config', () => {
		expect(AuthConfig.admin.level).toBe('admin');
		expect(AuthConfig.admin.roleCheck).toBe(checkAdminRole);
	});
});
