import { describe, expect, it } from 'vitest';
import { productImageUrl } from './products-view';

describe('collection image addresses', () => {
	it.each([
		['/tea.jpg', 'https://tea.shops.example', 'https://tea.shops.example/tea.jpg'],
		['https://cdn.example/tea.jpg', null, 'https://cdn.example/tea.jpg'],
		['/tea.jpg', null, null],
		['javascript:alert(1)', 'https://tea.shops.example', null],
		['data:image/svg+xml,<svg/>', 'https://tea.shops.example', null],
		['//outside.example/a', 'https://tea.shops.example', null],
		['/\\outside.example/a', 'https://tea.shops.example', null],
		['https://username:secret@outside.example/a', 'https://tea.shops.example', null],
		['http://outside.example/a', 'https://tea.shops.example', null],
		['/tea.jpg', 'http://tea.stores.localhost:5173', 'http://tea.stores.localhost:5173/tea.jpg'],
	])('safely resolves %s against %s', (image, base, expected) => {
		expect(productImageUrl(image, base)).toBe(expected);
	});
});
