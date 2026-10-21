import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/translationRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/controllers/liveStores/controller.ts',
		'/worker/api/controllers/storeTranslations/controller.ts',
		'/worker/api/controllers/storeTranslations/translations-api.ts',
		'/worker/api/controllers/tasks/controller.ts',
		'/src/lib/api-client.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const routeLines = (): string[] => source('/worker/api/routes/translationRoutes.ts').split('\n').filter((line) => line.includes("'/api/"));

describe('translation routes', () => {
	it("keeps a store's translations to its owner, and the store list and tasks to the signed-in seller", () => {
		const lines = routeLines();
		const storeRoutes = lines.filter((line) => line.includes("'/api/stores/:id/"));
		expect(storeRoutes).toHaveLength(6);
		for (const line of storeRoutes) expect(line).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		// A task's `:id` is a task, not an app, so an app-owner check could never pass for it: the controller scopes it to the seller.
		const sellerRoutes = lines.filter((line) => !line.includes("'/api/stores/:id/"));
		expect(sellerRoutes).toHaveLength(4);
		for (const line of sellerRoutes) expect(line).toContain('setAuthLevel(AuthConfig.authenticated)');
		expect(lines.find((line) => line.includes("'/api/translations/stores'"))).toContain('StoreTranslationsController.stores');
		expect(lines.filter((line) => line.includes("'/api/tasks"))).toHaveLength(3);
	});

	it('offers each route once, with the method and path the app calls', () => {
		const routes = routeLines().map((line) => /app\.(get|put|post|delete)\('([^']+)'/.exec(line)?.slice(1, 3).join(' '));
		expect(routes).toEqual([
			'get /api/translations/stores',
			'get /api/stores/:id/translations',
			'put /api/stores/:id/translations/settings',
			'post /api/stores/:id/translations/:locale/run',
			'get /api/stores/:id/translations/:locale/texts',
			'put /api/stores/:id/translations/:locale/texts/:hash',
			'delete /api/stores/:id/translations/:locale/texts/:hash',
			'get /api/tasks',
			'post /api/tasks/:id/cancel',
			'post /api/tasks/:id/resume',
		]);
		expect(source('/worker/api/routes/index.ts')).toContain('setupTranslationRoutes(app)');
	});

	it('is called by the app at the same paths and with the same methods', () => {
		const client = source('/src/lib/api-client.ts');
		for (const line of routeLines()) {
			const [, method, path] = /app\.(get|put|post|delete)\('([^']+)'/.exec(line) ?? [];
			// A `:param` in a route is a template expression in the client's path.
			const pattern = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/:\w+/g, '\\$\\{[^}]+\\}');
			// The path may end in a query or a search string the client builds, but not in more path.
			const calls = [...client.matchAll(new RegExp(`[\`']${pattern}(?:\\$\\{[^}]+\\}|\\?[^\`']*)?[\`']`, 'g'))];
			expect(calls.length, `${method} ${path}`).toBeGreaterThan(0);
			// A call without a method is a GET; the others name theirs on the same line.
			const methods = calls.map((call) => /method: '(\w+)'/.exec(client.slice(call.index, client.indexOf('\n', call.index)))?.[1]?.toLowerCase() ?? 'get');
			expect(methods, `${method} ${path}`).toContain(method);
		}
	});

	it('answers 503 under the pause flag from one place both controllers share, before touching anything else, except for cancel', () => {
		expect(source('/worker/api/controllers/storeTranslations/translations-api.ts')).toContain("isFlagOn(env, 'store-translations-paused', user.id)");
		for (const path of ['/worker/api/controllers/storeTranslations/controller.ts', '/worker/api/controllers/tasks/controller.ts']) {
			const methods = source(path).split(/\n\tstatic async /).slice(1);
			expect(methods.length).toBeGreaterThan(0);
			for (const method of methods) {
				const name = method.split('(')[0];
				// A seller can always stop a task, so the pause never refuses a cancel.
				if (path.includes('/tasks/') && name === 'cancel') expect(method).not.toMatch(/pausedReply/);
				else expect(method, name).toMatch(/pausedReply|targetOf/);
			}
		}
	});

	it('queues translations after a publish out of the publish request, so they cannot fail or delay it', () => {
		const publish = source('/worker/api/controllers/liveStores/controller.ts');
		expect(publish).toContain('ctx.waitUntil(translateAfterPublish(env, appId, ownerId))');
		expect(publish.indexOf('ctx.waitUntil(translateAfterPublish')).toBeGreaterThan(publish.indexOf('stores.publish({'));
	});

	it('reports a cancel to analytics through the same event the runner uses, guarded so it cannot fail the request', () => {
		const tasks = source('/worker/api/controllers/tasks/controller.ts');
		expect(tasks).toContain('trackTaskEnded(serverAnalytics(env), task)');
		expect(tasks).toMatch(/try \{\s*trackTaskEnded[\s\S]*\} catch/);
	});
});
