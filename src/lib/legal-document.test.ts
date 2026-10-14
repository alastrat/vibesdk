import { describe, expect, it } from 'vitest';
import { parseLegalDocument } from './legal-document';

const RAW = ['---', 'title: Terms of Service', 'version: 2026-10-13', 'updated: October 13, 2026', '---', '', 'Run by {{entity.name}}.', ''].join('\n');

describe('parseLegalDocument', () => {
	it('reads the header and fills the named fields', () => {
		expect(parseLegalDocument(RAW, { 'entity.name': 'Globalink' })).toEqual({
			title: 'Terms of Service',
			version: '2026-10-13',
			updated: 'October 13, 2026',
			body: 'Run by Globalink.',
		});
	});

	it('fails on a field it has no value for, so a typo never reaches the page', () => {
		expect(() => parseLegalDocument(RAW, {})).toThrow('Unknown legal field: entity.name');
	});

	it('fails without a complete header', () => {
		expect(() => parseLegalDocument('Body only', {})).toThrow('Legal document is missing its header');
		const noVersion = ['---', 'title: X', 'updated: today', '---', 'Body'].join('\n');
		expect(() => parseLegalDocument(noVersion, {})).toThrow('Legal document header needs title, version and updated');
	});
});
