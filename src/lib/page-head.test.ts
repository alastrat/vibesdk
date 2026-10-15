import { describe, expect, it } from 'vitest';
import { pageHeadTags } from './page-head';

const ORIGIN = 'https://estori.example';

describe('pageHeadTags', () => {
	it('describes the page to shared links by its full title and description', () => {
		expect(pageHeadTags({ title: 'Pricing', description: 'Plans and credits.' }, ORIGIN)).toEqual([
			{ name: 'meta', attributes: { property: 'og:type', content: 'website' } },
			{ name: 'meta', attributes: { property: 'og:title', content: 'Pricing - Estori' } },
			{ name: 'meta', attributes: { property: 'og:description', content: 'Plans and credits.' } },
			{ name: 'meta', attributes: { name: 'twitter:card', content: 'summary' } },
		]);
	});

	it('names the brand alone for a page without a title of its own', () => {
		const tags = pageHeadTags({ description: 'Build a store.' }, ORIGIN);
		expect(tags).toContainEqual({ name: 'meta', attributes: { property: 'og:title', content: 'Estori' } });
	});

	it("names the page's canonical address on the origin serving it", () => {
		const tags = pageHeadTags({ title: 'Blog', description: 'News.', path: '/blog' }, ORIGIN);
		expect(tags).toContainEqual({ name: 'link', attributes: { rel: 'canonical', href: `${ORIGIN}/blog` } });
		expect(tags).toContainEqual({ name: 'meta', attributes: { property: 'og:url', content: `${ORIGIN}/blog` } });
	});

	it('shows the image large in shared links, at its full address and with its description', () => {
		const tags = pageHeadTags({ title: 'Pets', description: 'Pet stores.', image: { src: '/marketing/pets.webp', alt: 'A dog on a leash' } }, ORIGIN);
		expect(tags).toContainEqual({ name: 'meta', attributes: { name: 'twitter:card', content: 'summary_large_image' } });
		expect(tags).toContainEqual({ name: 'meta', attributes: { property: 'og:image', content: `${ORIGIN}/marketing/pets.webp` } });
		expect(tags).toContainEqual({ name: 'meta', attributes: { property: 'og:image:alt', content: 'A dog on a leash' } });
	});
});
