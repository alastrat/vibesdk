/** Local-only: bun scripts/discover/seed.ts [--config wrangler.jsonc] [--persist-to .wrangler/state] */
import { resolve } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { Miniflare } from 'miniflare';
import { buildStoreArtifacts } from './stores';
import { buildComponentArtifacts } from './components';
import { catalogCategories } from './artifact-types';
import { seedCatalog } from '../../worker/services/discover/seed';

const args = process.argv.slice(2);
if (args.includes('--remote')) throw new Error('This seeder only writes local development storage.');
function option(name: string, fallback: string) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] ?? fallback; }
const configPath = resolve(option('--config','wrangler.jsonc'));
const persistRoot = resolve(option('--persist-to','.wrangler/state'));
const configErrors: ParseError[] = [];
const config = parse(await Bun.file(configPath).text(), configErrors) as { d1_databases: Array<{ binding: string; database_id: string; database_name: string }>; r2_buckets: Array<{ binding: string; bucket_name: string }>; compatibility_date: string };
if (configErrors.length || !config?.d1_databases || !config.r2_buckets) throw new Error('Use a valid Wrangler JSON or JSONC config with DB and TEMPLATES_BUCKET bindings.');
const database = config.d1_databases.find((binding) => binding.binding === 'DB');
const bucket = config.r2_buckets.find((binding) => binding.binding === 'TEMPLATES_BUCKET');
if (!database || !bucket) throw new Error('Local Wrangler config must bind DB and TEMPLATES_BUCKET.');
const artifacts = [...buildStoreArtifacts(),...buildComponentArtifacts()];
if (artifacts.length !== 48 || artifacts.filter((item) => item.tier === 'free').length !== 24 || catalogCategories.some((category) => artifacts.filter((item) => item.categorySlug === category.slug).length !== 6)) throw new Error('Catalog inventory must contain 48 entries, 24 free, and six per category.');
const migration = Bun.spawn(['bunx','wrangler','d1','migrations','apply',database.database_name,'--local','--config',configPath,'--persist-to',persistRoot], { stdout: 'pipe',stderr: 'pipe',env: { ...process.env,CI: 'true',WRANGLER_SEND_METRICS: 'false' } });
if (await migration.exited !== 0) { console.error(await new Response(migration.stderr).text()); throw new Error('Local migration failed'); }
// Explicit physical IDs and persistence root match the Vite plugin's local binding configuration.
const runtime = new Miniflare({ modules: true,script: 'export default { fetch() { return new Response("Local catalog seeder"); } };',compatibilityDate: config.compatibility_date,d1Databases: { DB: database.database_id },r2Buckets: { TEMPLATES_BUCKET: bucket.bucket_name },d1Persist: resolve(persistRoot,'v3/d1'),r2Persist: resolve(persistRoot,'v3/r2') });
try {
    const db = await runtime.getD1Database('DB');
    const r2 = await runtime.getR2Bucket('TEMPLATES_BUCKET');
    const result = await seedCatalog(db, {
        async put(key,bytes,mime) { await r2.put(key,bytes,{ httpMetadata: { contentType: mime } }); },
        async get(key) { const object = await r2.get(key); return object ? new Uint8Array(await object.arrayBuffer()) : null; },
    }, artifacts,catalogCategories);
    const persisted = await db.prepare('SELECT kind,tier,COUNT(*) AS count FROM discover_entries WHERE published=1 GROUP BY kind,tier').all();
    console.log(JSON.stringify({ ...result,persisted: persisted.results,local: true,configPath,persistRoot },null,2));
} finally { await runtime.dispose(); }
