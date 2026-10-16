import { describe, expect, it } from 'vitest';
import SKILL from './skills/store-checkout/SKILL.md?raw';
import APP_FILE_STRUCTURE from './skills/app-file-structure/SKILL.md?raw';
import { parseStoreManifest } from '../../services/store-payments/manifest';

const skills = import.meta.glob<string>('/worker/agents/think/skills.ts', { query: '?raw', import: 'default', eager: true });

describe('the store checkout skill', () => {
	it('is registered with the agent', () => {
		expect(Object.values(skills)[0]).toContain("'store-checkout': STORE_CHECKOUT");
		expect(SKILL).toMatch(/^---\nname: store-checkout\ndescription: .+\n---/);
	});

	it('teaches a manifest Estori accepts', () => {
		const example = SKILL.match(/```json\n([\s\S]+?)\n```/)?.[1] ?? '';
		expect(parseStoreManifest(example).ok).toBe(true);
	});

	it('keeps payments on the platform', () => {
		for (const rule of ['/__estori/store.js', 'Estori.checkout(', 'Estori.order(', 'Never collect card details', 'catalogVariantId']) expect(SKILL).toContain(rule);
		expect(APP_FILE_STRUCTURE).toContain('store-checkout');
	});
});
