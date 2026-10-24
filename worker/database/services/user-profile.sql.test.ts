import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import { UserService } from './UserService';
import { AuthService } from './AuthService';
import { mapUserResponse } from '../../utils/authUtils';
import { UserController } from '../../api/controllers/user/controller';
import type { RouteContext } from '../../api/types/route-context';

let db: D1Database;
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'profile_settings');
});
const environment = () =>
	envWith(db, {
		JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters',
	});

describe('account profile persistence', () => {
	it('saves a time zone and clears a biography through the public profile endpoint', async () => {
		await db
			.prepare('UPDATE users SET bio = ?, timezone = ? WHERE id = ?')
			.bind('Old biography', 'UTC', 'profile_settings')
			.run();
		const response = await UserController.updateProfile(
			new Request('https://estori.app/api/user/profile', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ bio: '', timezone: 'America/Bogota' }),
			}),
			environment(),
			{} as ExecutionContext,
			{ user: { id: 'profile_settings' } } as RouteContext,
		);
		expect(response.status).toBe(200);
		const stored = await db
			.prepare('SELECT bio, timezone FROM users WHERE id = ?')
			.bind('profile_settings')
			.first();
		expect(stored).toMatchObject({ bio: '', timezone: 'America/Bogota' });
	});

	it('leaves omitted fields alone and does not allow a blank display name', async () => {
		const service = new UserService(environment());
		await service.updateUserProfileWithValidation('profile_settings', {
			displayName: 'Seller',
			bio: 'Keep this biography',
		});
		expect(
			(
				await service.updateUserProfileWithValidation(
					'profile_settings',
					{ displayName: '   ' },
				)
			).success,
		).toBe(false);
		await service.updateUserProfileWithValidation('profile_settings', {
			username: 'seller_profile',
		});
		expect(
			await db
				.prepare('SELECT display_name, bio FROM users WHERE id = ?')
				.bind('profile_settings')
				.first(),
		).toMatchObject({ display_name: 'Seller', bio: 'Keep this biography' });
	});

	it('rejects an invalid time zone without modifying the profile', async () => {
		const service = new UserService(environment());
		const result = await service.updateUserProfileWithValidation(
			'profile_settings',
			{ timezone: 'Not/A_Timezone', bio: 'Do not save' },
		);
		expect(result.success).toBe(false);
		expect(
			(await service.findUser({ id: 'profile_settings' }))?.bio,
		).not.toBe('Do not save');
	});

	it('returns the stored theme through auth and repeated profile mapping', async () => {
		await new UserService(environment()).updateUserProfileWithValidation(
			'profile_settings',
			{ theme: 'dark' },
		);
		const user = await new AuthService(environment()).getUserForAuth(
			'profile_settings',
		);
		expect(user).toMatchObject({ theme: 'dark' });
		expect(mapUserResponse(user ?? { id: 'x', email: 'x' })).toMatchObject({
			theme: 'dark',
		});
	});
});
