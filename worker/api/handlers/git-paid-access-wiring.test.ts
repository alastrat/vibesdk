import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/handlers/git-protocol.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('git clone of a paid site', () => {
	const handler = source('/worker/api/handlers/git-protocol.ts');

	it('checks the paid listing before allowing a public clone', () => {
		const lookup = handler.indexOf('new TemplateService(env).getListingByApp(appId)');
		const publicAllow = handler.indexOf('return { hasAccess: true');
		expect(lookup).toBeGreaterThan(-1);
		expect(publicAllow).toBeGreaterThan(lookup);
		expect(handler).toContain("if (listing?.status !== 'listed')");
	});

	it('leaves a listed paid site to the owner token check', () => {
		expect(handler).toContain('const hasAccess = payload.sub === app.userId;');
	});
});
