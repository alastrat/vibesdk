import { JWTUtils } from './jwtUtils';

const SCREENSHOT_PATH_PREFIX = '/api/screenshots/';

export class ScreenshotSecurity {
    private static readonly TOKEN_EXPIRY = 6 * 60 * 60; // 6 hours

    private jwt: JWTUtils;

    constructor(env: { JWT_SECRET: string }) {
        this.jwt = JWTUtils.getInstance(env);
    }

    async signUrl(url: string, appId: string): Promise<string> {
        const isAbsolute = url.startsWith('http://') || url.startsWith('https://');

        let parsed: URL;
        try {
            parsed = new URL(url, 'http://localhost');
        } catch {
            return url;
        }

        if (!parsed.pathname.startsWith(SCREENSHOT_PATH_PREFIX)) return url;

        const token = await this.jwt.signPayload({ appId, purpose: 'screenshot' }, ScreenshotSecurity.TOKEN_EXPIRY);
        parsed.searchParams.set('token', token);
        return isAbsolute ? parsed.toString() : parsed.pathname + parsed.search;
    }

    /** Signs each app's desktop and showcase screenshot URLs. */
    async enrichUrls<T extends { id: string; screenshotUrl?: string | null; showcaseScreenshotUrl?: string | null }>(apps: T[]): Promise<T[]> {
        return Promise.all(apps.map(async (app) => {
            const screenshotUrl = app.screenshotUrl ? await this.signUrl(app.screenshotUrl, app.id) : app.screenshotUrl;
            const showcaseScreenshotUrl = app.showcaseScreenshotUrl
                ? await this.signUrl(app.showcaseScreenshotUrl, app.id)
                : app.showcaseScreenshotUrl;
            if (screenshotUrl === app.screenshotUrl && showcaseScreenshotUrl === app.showcaseScreenshotUrl) return app;
            return { ...app, screenshotUrl, showcaseScreenshotUrl };
        }));
    }

    async verifyToken(token: string, expectedAppId: string): Promise<boolean> {
        const payload = await this.jwt.verifyPayload(token);
        return payload?.appId === expectedAppId && payload?.purpose === 'screenshot';
    }
}
