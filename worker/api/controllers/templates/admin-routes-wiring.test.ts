import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
    ['/worker/api/routes/templateRoutes.ts', '/worker/api/controllers/appView/controller.ts'],
    { query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
    const text = sources[path];
    if (text === undefined) throw new Error(`Source not found: ${path}`);
    return text;
}

describe('template review routes', () => {
    it('puts every review route behind the admin auth level', () => {
        const routes = source('/worker/api/routes/templateRoutes.ts');
        const adminLines = routes.split('\n').filter((line) => line.includes("'/api/admin/"));
        expect(adminLines).toHaveLength(6);
        for (const line of adminLines) {
            expect(line).toContain('setAuthLevel(AuthConfig.admin)');
        }
    });

    it('shows which template an app started from', () => {
        expect(source('/worker/api/controllers/appView/controller.ts')).toContain(
            'fromTemplate: origin ? toTemplateOrigin(origin) : null',
        );
    });
});
