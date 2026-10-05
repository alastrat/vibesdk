import { describe, expect, it } from 'vitest';
import logoSvg from './assets/estori-logo.svg?raw';
import glyphSvg from './assets/estori-glyph.svg?raw';
import faviconSvg from '../../public/favicon.svg?raw';

function count(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

describe('Estori logo assets', () => {
	it('wordmark letters follow the text color and the dot stays brand blue', () => {
		expect(count(logoSvg, 'fill="currentColor"')).toBe(6);
		expect(count(logoSvg, 'fill="#2C71F0"')).toBe(1);
		expect(logoSvg).not.toMatch(/\swidth="\d+"/);
	});

	it('glyph is a square "e." monogram', () => {
		expect(glyphSvg).toContain('viewBox="-0.88 5.5 38 38"');
		expect(count(glyphSvg, 'fill="currentColor"')).toBe(1);
		expect(count(glyphSvg, 'fill="#2C71F0"')).toBe(1);
	});

	it('favicon is a white "e." on an Estori navy tile', () => {
		expect(faviconSvg).toContain('fill="#11295A"');
		expect(faviconSvg).toContain('fill="#FFFFFF"');
		expect(faviconSvg).toContain('fill="#2C71F0"');
	});
});
