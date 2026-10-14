import { describe, expect, it } from 'vitest';
import { storeWordmark } from './store-wordmark';

describe('storeWordmark', () => {
	it('drops generic endings that name the kind of site', () => {
		expect(storeWordmark('North Ridge Coffee Store')).toBe('North Ridge Coffee');
		expect(storeWordmark('Lumen Yoga Studio Website')).toBe('Lumen Yoga Studio');
		expect(storeWordmark('Pop Landing Page')).toBe('Pop');
		expect(storeWordmark('Maison Verde Shop Template')).toBe('Maison Verde');
	});

	it('keeps a title with no generic ending', () => {
		expect(storeWordmark('Saltmarsh Surf School')).toBe('Saltmarsh Surf School');
	});

	it('ignores case and extra spaces', () => {
		expect(storeWordmark('  Aloha   STORE ')).toBe('Aloha');
	});

	it('always keeps the first word, so a wordmark is never empty', () => {
		expect(storeWordmark('Store')).toBe('Store');
		expect(storeWordmark('My Store')).toBe('My');
	});
});
