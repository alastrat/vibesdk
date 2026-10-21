import { describe, expect, it, vi } from 'vitest';
import { CATALOG_PAUSED_MESSAGE, type CatalogProductView } from '../../../shared/types/catalog';
import { catalogToolDepsFromEnv, createCatalogTools } from './catalog-tools';

const { isFlagOn } = vi.hoisted(() => ({ isFlagOn: vi.fn(async () => true) }));
vi.mock('../../services/posthog/flags', () => ({ isFlagOn }));

const PRODUCT: CatalogProductView = {
	productId: 'cp_1',
	title: 'Gravity Pet Feeder',
	description: 'Feeds and waters.',
	category: 'Pet supplies',
	imageUrls: ['https://estori.test/api/catalog/images/cp_1/a.jpg'],
	shipsTo: ['US'],
	variants: [
		{ catalogVariantId: 'cv_blue', name: 'Blue', options: { Color: 'Blue' }, imageUrl: null, available: true, deliveryDays: { min: 3, max: 5 }, catalogPriceCents: 2028, minimumRetailPriceCents: 2120, suggestedRetailPriceCents: 4099 },
	],
};

const tools = createCatalogTools({
	search: async () => [PRODUCT],
	get: async (productId) => (productId === 'cp_1' ? PRODUCT : null),
	catalogRefusal: async () => null,
	paused: async () => false,
});

type Executable = { execute?: (input: unknown, options: unknown) => unknown };

async function run(tool: unknown, input: unknown): Promise<string> {
	const execute = (tool as Executable).execute;
	if (!execute) throw new Error('tool has no execute');
	return String(await execute(input, { toolCallId: 't1', messages: [] }));
}

describe('the catalog tools', () => {
	it('return products with retail price guidance and no catalog price', async () => {
		for (const output of [await run(tools.search_catalog, { query: 'pet' }), await run(tools.get_catalog_product, { productId: 'cp_1' })]) {
			expect(output).toContain('cv_blue');
			expect(output).toContain('"minimumRetailPriceCents":2120');
			expect(output).not.toContain('catalogPriceCents');
		}
	});

	it('answer an unknown product with an error the model can act on', async () => {
		expect(JSON.parse(await run(tools.get_catalog_product, { productId: 'cp_x' }))).toEqual({ error: 'No catalog product cp_x. Use search_catalog to find one.' });
	});

	it('refuse malformed input before searching', () => {
		const schema = (tools.get_catalog_product as unknown as { inputSchema: { safeParse(value: unknown): { success: boolean } } }).inputSchema;
		expect(schema.safeParse({ productId: '' }).success).toBe(false);
		expect(schema.safeParse({}).success).toBe(false);
	});

	it('tell the model to use one image and write its own copy', () => {
		const description = `${tools.search_catalog.description}`;
		expect(description).toContain('first of the imageUrls');
		expect(description).toContain('Write your own product names, descriptions and variant names');
	});

	it('tell the model how to add a product to a store', () => {
		const description = `${tools.search_catalog.description} ${tools.get_catalog_product.description}`;
		for (const phrase of ['estori-store.json', 'catalogVariantId', 'minimumRetailPriceCents']) expect(description).toContain(phrase);
	});

	it("tell the AI, in the seller's words, that catalog products need Pro or Premium", async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'supplierCatalog' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' };
		const basic = createCatalogTools({ search: async () => [PRODUCT], get: async () => PRODUCT, catalogRefusal: async () => refusal, paused: async () => false });
		for (const output of [await run(basic.search_catalog, {}), await run(basic.get_catalog_product, { productId: 'cp_1' })]) {
			expect(JSON.parse(output).notice).toBe(`${refusal.message} Tell the seller this before adding a catalog product to their store.`);
		}
		expect(JSON.parse(await run(tools.search_catalog, {})).notice).toBeUndefined();
	});

	it('answers that the catalog is paused, searching nothing, while the pause flag is on', async () => {
		const search = vi.fn(async () => []);
		const tools = createCatalogTools({ search, get: async () => null, catalogRefusal: async () => null, paused: async () => true });
		const answer = await tools.search_catalog.execute?.({ query: 'mug' }, { toolCallId: 't1', messages: [] });
		expect(String(answer)).toContain(CATALOG_PAUSED_MESSAGE);
		expect(search).not.toHaveBeenCalled();
	});

	it('answers that the catalog is paused for one product too, reading nothing', async () => {
		const get = vi.fn(async () => PRODUCT);
		const paused = createCatalogTools({ search: async () => [], get, catalogRefusal: async () => null, paused: async () => true });
		expect(JSON.parse(await run(paused.get_catalog_product, { productId: 'cp_1' }))).toEqual({
			paused: true,
			message: `${CATALOG_PAUSED_MESSAGE} Build the store with the seller's own products.`,
		});
		expect(get).not.toHaveBeenCalled();
	});
});

describe("the catalog tools' pause", () => {
	it("reads the catalog pause flag for the store's seller", async () => {
		const env = { CUSTOM_DOMAIN: 'estori.test' } as Env;
		expect(await catalogToolDepsFromEnv(env, 'seller_1').paused()).toBe(true);
		expect(isFlagOn).toHaveBeenCalledWith(env, 'catalog-paused', 'seller_1');
	});
});

const agentSources = import.meta.glob<string>('/worker/agents/think/ThinkAgent.ts', { query: '?raw', import: 'default', eager: true });

describe('the agent', () => {
	it("registers the catalog tools for the store's seller, whose catalog pause they read", () => {
		const agent = Object.values(agentSources)[0] ?? '';
		const tools = agent.slice(agent.indexOf('override getTools('));
		expect(tools).toContain('const userId = this.getConfig<ThinkAgentConfig>()?.userId ?? null;');
		expect(tools).toContain('...createCatalogTools(catalogToolDepsFromEnv(this.env, userId))');
	});
});
