import { describe, expect, it } from 'vitest';
import { ScreenshotSecurity } from './screenshot-security';

const env = { JWT_SECRET: 'screenshot-security-test-secret-0123456789abcdef' };

describe('ScreenshotSecurity.enrichUrls', () => {
	it('signs the desktop and the showcase screenshot of each app', async () => {
		const security = new ScreenshotSecurity(env);
		const [app] = await security.enrichUrls([
			{ id: 'app1', screenshotUrl: '/api/screenshots/app1/latest.png', showcaseScreenshotUrl: '/api/screenshots/app1/showcase.jpg' },
		]);
		expect(app.screenshotUrl).toMatch(/^\/api\/screenshots\/app1\/latest\.png\?token=/);
		expect(app.showcaseScreenshotUrl).toMatch(/^\/api\/screenshots\/app1\/showcase\.jpg\?token=/);
		const token = new URL(app.showcaseScreenshotUrl ?? '', 'http://localhost').searchParams.get('token') ?? '';
		expect(await security.verifyToken(token, 'app1')).toBe(true);
	});

	it('leaves a missing showcase screenshot as it is', async () => {
		const [app] = await new ScreenshotSecurity(env).enrichUrls([
			{ id: 'app1', screenshotUrl: '/api/screenshots/app1/latest.png', showcaseScreenshotUrl: null },
		]);
		expect(app.showcaseScreenshotUrl).toBeNull();
	});

	it('signs only the showcase when an app has no desktop screenshot', async () => {
		const [app] = await new ScreenshotSecurity(env).enrichUrls([{ id: 'app1', screenshotUrl: null, showcaseScreenshotUrl: '/api/screenshots/app1/showcase.jpg' }]);
		expect(app.screenshotUrl).toBeNull();
		expect(app.showcaseScreenshotUrl).toMatch(/^\/api\/screenshots\/app1\/showcase\.jpg\?token=/);
	});

	it('leaves an app without the showcase field as it is, adding nothing', async () => {
		const [app] = await new ScreenshotSecurity(env).enrichUrls([{ id: 'app1', screenshotUrl: '/api/screenshots/app1/latest.png' }]);
		expect(app.screenshotUrl).toMatch(/\?token=/);
		expect(app.showcaseScreenshotUrl).toBeUndefined();
	});

	it('hands back the very same object when there is nothing to sign', async () => {
		const plain = { id: 'app1', screenshotUrl: 'https://cdn.example/elsewhere.png', showcaseScreenshotUrl: null };
		const [app] = await new ScreenshotSecurity(env).enrichUrls([plain]);
		expect(app).toBe(plain);
	});
});

