import { describe, expect, it } from 'vitest';
import { SellerTermsService } from './SellerTermsService';
import { recordingD1 } from '../test-support/recording-d1';

describe('SellerTermsService', () => {
	it('records the current version and the time', async () => {
		const { d1, statements } = recordingD1();
		const terms = new SellerTermsService({ DB: d1 } as unknown as Env);

		expect(await terms.accept('u1', '2026-10-16', new Date(1_800_000_000_000))).toBe(true);
		const update = statements.find((entry) => entry.sql.toLowerCase().startsWith('update "users"'));
		expect(update?.sql).toContain('"seller_terms_version"');
		expect(update?.sql).toContain('"seller_terms_accepted_at"');
		expect(update?.params).toContain('2026-10-16');
		expect(update?.params).toContain('u1');
	});

	it('refuses an old or missing version without writing', async () => {
		const { d1, statements } = recordingD1();
		const terms = new SellerTermsService({ DB: d1 } as unknown as Env);

		expect(await terms.accept('u1', '2026-10-13', new Date())).toBe(false);
		expect(await terms.accept('u1', undefined, new Date())).toBe(false);
		expect(statements).toHaveLength(0);
	});

	it('reads an agreement as current only for the current version', async () => {
		expect(await new SellerTermsService({ DB: recordingD1([['2026-10-16']]).d1 } as unknown as Env).hasAccepted('u1')).toBe(true);
		expect(await new SellerTermsService({ DB: recordingD1([['2026-10-13']]).d1 } as unknown as Env).hasAccepted('u1')).toBe(false);
		expect(await new SellerTermsService({ DB: recordingD1([]).d1 } as unknown as Env).hasAccepted('u1')).toBe(false);
	});
});
