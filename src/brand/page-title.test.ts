import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
	it('returns the brand name alone for the home page', () => {
		expect(pageTitle()).toBe('Estori');
	});

	it('suffixes page names with the brand name', () => {
		expect(pageTitle('Settings')).toBe('Settings - Estori');
	});

	it('treats a blank page name as the home page', () => {
		expect(pageTitle('   ')).toBe('Estori');
	});
});
