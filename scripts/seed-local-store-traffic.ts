/** Local-only illustrative traffic for the two explicitly authorized sample stores. */
import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import {
	SAMPLE_OWNER_ID,
	SAMPLE_STORE_IDS,
	assertLocalSamplePath,
} from './seed-local-store-transactions';
if (!import.meta.main)
	throw new Error('Run this local sample script directly.');
if (process.argv.length > 2)
	throw new Error(
		'This script accepts no remote database or other arguments.',
	);
const file = assertLocalSamplePath(
	resolve(
		'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/65fb73f4b482216abfe276db82de59ed0446a94f9b09c5c75aaff43e560aec1c.sqlite',
	),
	process.cwd(),
);
const db = new Database(file);
db.exec('PRAGMA foreign_keys=ON');
const now = Math.floor(Date.now() / 1000),
	today = Math.floor(now / 86400) * 86400;
const insert = db.prepare(
	'INSERT INTO store_page_events (id,app_id,mode,visitor_hash,path,source,country,device,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
);
const checkout = db.prepare(
	`INSERT INTO store_checkouts (id,mode,app_id,commit_hash,seller_user_id,ship_to_country,priced_cart,subtotal_cents,shipping_cents,total_cents,application_fee_cents,status,success_path,cancel_path,note,created_at,expires_at) VALUES (?,'test',?,'sample-traffic',?,'US',?,3500,0,3500,0,'expired','/','/',?,?,?)`,
);
const sources = [
	'Direct',
	'google.com',
	'instagram.com',
	'youtube.com',
	'Direct',
	'Direct',
	'tiktok.com',
];
const countries = ['CO', 'US', 'BR', 'MX', 'CO', 'ES', 'AR', 'CL'];
const paths = [
	'/',
	'/',
	'/collections/all',
	'/products/house-blend',
	'/products/ceramic-mug',
	'/about',
];
const devices = ['mobile', 'desktop', 'mobile', 'desktop', 'tablet'];
let events = 0,
	checkouts = 0;
db.transaction(() => {
	for (const [storeIndex, appId] of SAMPLE_STORE_IDS.entries()) {
		const owner = db
			.query('SELECT user_id FROM apps WHERE id=?')
			.get(appId) as { user_id: string } | null;
		if (owner?.user_id !== SAMPLE_OWNER_ID)
			throw new Error('Sample store ownership does not match.');
		db.prepare(
			"DELETE FROM store_page_events WHERE app_id=? AND mode='test' AND id LIKE 'sample-traffic-%'",
		).run(appId);
		db.prepare(
			"DELETE FROM store_checkouts WHERE app_id=? AND mode='test' AND id LIKE 'sample-traffic-%' AND note=? AND stripe_checkout_session_id IS NULL",
		).run(
			appId,
			'SAMPLE DATA — Illustrative abandoned checkout. No payment or provider call.',
		);
		for (let day = 0; day < 180; day++) {
			const count = 14 + ((day * 17 + storeIndex * 13) % 51);
			for (let i = 0; i < count; i++) {
				const at = Math.min(
					today -
						day * 86400 +
						Math.floor(((i + 1) * 85000) / (count + 1)),
					now - 30,
				);
				const visitor = new Bun.CryptoHasher('sha256')
					.update(
						`sample:${appId}:${(day * 7 + Math.floor(i / 2)) % 127}`,
					)
					.digest('hex');
				insert.run(
					`sample-traffic-${appId}-${day}-${i}`,
					appId,
					'test',
					visitor,
					paths[(i + day) % paths.length],
					sources[(i + day) % sources.length],
					countries[(i + day) % countries.length],
					devices[i % devices.length],
					at,
				);
				events++;
			}
			if (day % 2 === 0) {
				const at = Math.min(today - day * 86400 + 36000, now - 3600);
				checkout.run(
					`sample-traffic-checkout-${appId}-${day}`,
					appId,
					SAMPLE_OWNER_ID,
					JSON.stringify({
						currency: 'usd',
						lines: [],
						shippingCents: 0,
						totalCents: 3500,
					}),
					'SAMPLE DATA — Illustrative abandoned checkout. No payment or provider call.',
					at,
					at + 1800,
				);
				checkouts++;
			}
		}
	}
})();
console.log(
	JSON.stringify({
		local: true,
		mode: 'test',
		events,
		expiredSampleCheckouts: checkouts,
		stores: SAMPLE_STORE_IDS.length,
	}),
);
db.close();
