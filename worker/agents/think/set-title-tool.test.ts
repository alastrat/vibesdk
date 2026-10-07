import { describe, expect, it } from 'vitest';
import { createSetTitleTool } from './set-title-tool';

describe('set_title tool', () => {
	const description = createSetTitleTool().description ?? '';

	it('tells the model to replace the provisional title on the first turn', () => {
		expect(description).toContain('provisional title');
		expect(description).toContain('On the first turn of a new project');
	});

	it('prefers the name the user gave the product', () => {
		expect(description).toContain('use the name the user gave the product');
	});

	it('no longer lets the model skip naming when the request already names the product', () => {
		expect(description).not.toContain('ONLY IF the project does not yet have a clear name');
	});
});
