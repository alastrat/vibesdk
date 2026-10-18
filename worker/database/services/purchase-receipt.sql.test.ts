/** What a paid site's receipt names, read from real SQL. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { TemplateService } from './TemplateService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'creator_1');
	await insertUser(db, 'buyer_1');
	await insertApp(db, { id: 'app_1', userId: 'creator_1', title: 'Bakery Landing Page' });
});

describe('a purchase receipt on real SQL', () => {
	it("reads the site's title and the buyer's account email, and nulls for ones that are gone", async () => {
		const service = new TemplateService(envWith(db));
		expect(await service.receiptFacts('app_1', 'buyer_1')).toEqual({ siteTitle: 'Bakery Landing Page', buyerEmail: 'buyer_1@example.test' });
		expect(await service.receiptFacts('app_gone', 'buyer_gone')).toEqual({ siteTitle: null, buyerEmail: null });
	});
});
