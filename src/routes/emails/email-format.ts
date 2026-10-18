import type { ShopperEmailStatus } from '@/api-types';

export const STATUS_LABELS: Readonly<Record<ShopperEmailStatus, string>> = {
	queued: 'Sending',
	sent: 'Sent',
	failed: 'Not sent',
	suppressed: 'Address blocked',
	disabled: 'Turned off',
	capped: 'Over the daily limit',
};

export function statusVariant(status: ShopperEmailStatus): 'success' | 'error' | 'secondary' {
	if (status === 'sent') return 'success';
	if (status === 'failed' || status === 'suppressed' || status === 'capped') return 'error';
	return 'secondary';
}

export function templateOrigin(template: { edited: boolean }): string {
	return template.edited ? 'Edited' : "Estori's default";
}

/** Puts `{{name}}` in place of the selection and returns where the cursor goes after it. */
export function insertPlaceholder(text: string, name: string, start: number, end: number): { text: string; caret: number } {
	const token = `{{${name}}}`;
	return { text: `${text.slice(0, start)}${token}${text.slice(end)}`, caret: start + token.length };
}
