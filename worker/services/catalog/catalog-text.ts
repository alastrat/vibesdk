/** Catalog copy as plain text, without the supplier's name: sellers and shoppers never see who fulfills. */

import { SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import { CATALOG_MAX_DESCRIPTION } from './config';

const ENTITIES: Readonly<Record<string, string>> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function namesSupplier(line: string): boolean {
	const lower = line.toLowerCase();
	return SUPPLIER_NAMES.some((name) => lower.includes(name)) || /\bcj\b/i.test(line);
}

export function catalogText(html: string | null): string {
	if (!html) return '';
	const lines = html
		.replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line.length > 0 && !namesSupplier(line));
	return lines.join(' ').slice(0, CATALOG_MAX_DESCRIPTION);
}
