/** CJ's order number for a placement: the catalog order id and a digest of its lines, so a retry of the same lines can't place twice. */

import { sha256Hash } from '../../../utils/cryptoUtils';
import type { SupplierOrderLine } from '../supplier';

export async function cjOrderNumber(reference: string, lines: readonly SupplierOrderLine[]): Promise<string> {
	const canonical = lines
		.map((line) => `${line.supplierVariantId}:${line.quantity}`)
		.sort()
		.join(',');
	return `${reference}-${(await sha256Hash(canonical)).slice(0, 8)}`;
}
