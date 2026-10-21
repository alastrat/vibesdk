import { describe, expect, it } from 'vitest';
import { SHOPPER_EMAIL_STATUSES } from '@/api-types';
import { STATUS_LABELS, insertPlaceholder, statusVariant, templateOrigin } from './email-format';

describe('shopper email formatting', () => {
	it('labels every status, and marks the ones that need a look', () => {
		for (const status of SHOPPER_EMAIL_STATUSES) expect(STATUS_LABELS[status], status).toBeTruthy();
		expect(statusVariant('sent')).toBe('success');
		expect(statusVariant('failed')).toBe('error');
		expect(statusVariant('capped')).toBe('error');
		expect(statusVariant('disabled')).toBe('secondary');
	});

	it("tells an edited email from Estori's default", () => {
		expect(templateOrigin({ edited: true })).toBe('Edited by you');
		expect(templateOrigin({ edited: false })).toBe("Estori's default");
	});

	it('inserts a placeholder where the cursor is, replacing a selection, and puts the cursor after it', () => {
		expect(insertPlaceholder('Hi !', 'customer_first_name', 3, 3)).toEqual({ text: 'Hi {{customer_first_name}}!', caret: 26 });
		expect(insertPlaceholder('Order NUMBER', 'order_number', 6, 12)).toEqual({ text: 'Order {{order_number}}', caret: 22 });
	});
});
