import { t } from '@/lib/i18n';
export function validateProductDraft(
	name: string,
	prices: string[],
): string | null {
	if (!name.trim()) return t('Enter a product name.');
	if (
		!prices.length ||
		prices.some(
			(price) =>
				!/^\d+(\.\d{1,2})?$/.test(price) ||
				Number(price) < 0.5 ||
				Number(price) > 10000,
		)
	)
		return t(
			'Each price must be between $0.50 and $10,000 with at most two decimal places.',
		);
	return null;
}
export function csvCell(value: string | number): string {
	const safe = String(value).replace(/^[=+@-]/, "'$&");
	return `"${safe.replaceAll('"', '""')}"`;
}
