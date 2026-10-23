import { zipSync } from 'fflate';
import type { CatalogArtifact } from '../../../shared/types/discover-artifact';
import { buildSnapshot, containsSecret, isSafeSeedPath, parseBundle } from '../templates/snapshot';

export interface CatalogCategorySeed { slug: string; title: string; description: string; color: string; }
interface SeedObject { id: string; role: 'cover' | 'preview' | 'source' | 'download' | 'manifest'; key: string; mime: string; bytes: Uint8Array; sha256: string; }
interface PreparedArtifact { artifact: CatalogArtifact; version: string; objects: SeedObject[]; }
export interface CatalogSeedStorage {
    put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
    get(key: string): Promise<Uint8Array | null>;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
    const buffer = new Uint8Array(bytes).buffer;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),(byte) => byte.toString(16).padStart(2,'0')).join('');
}
const encode = (value: string) => new TextEncoder().encode(value);

/** Prepare all content before writing anything; version addresses include metadata as well as all artifact bytes. */
export async function prepareCatalog(artifacts: CatalogArtifact[], categories: readonly CatalogCategorySeed[]): Promise<PreparedArtifact[]> {
    const slugs = new Set<string>();
    return Promise.all(artifacts.map(async (artifact) => {
        if (!/^[a-z0-9-]+$/.test(artifact.slug) || slugs.has(artifact.slug)) throw new Error(`Invalid or duplicate slug: ${artifact.slug}`);
        slugs.add(artifact.slug);
        if (!categories.some((category) => category.slug === artifact.categorySlug)) throw new Error(`Unknown category: ${artifact.categorySlug}`);
        const expectedPrice = artifact.tier === 'free' ? 0 : artifact.kind === 'store' ? 2900 : 900;
        if (artifact.priceCents !== expectedPrice) throw new Error(`Invalid catalog price: ${artifact.slug}`);
        if (!artifact.files.some((file) => file.path === 'index.html') || !artifact.files.some((file) => /^readme\.md$/i.test(file.path))) throw new Error(`Missing runnable entry point or README: ${artifact.slug}`);
        const paths = new Set<string>();
        for (const file of artifact.files) {
            if (!isSafeSeedPath(file.path) || paths.has(file.path)) throw new Error(`Invalid source path: ${file.path}`);
            paths.add(file.path);
        }
        if (containsSecret(artifact.previewHtml) || containsSecret(artifact.coverSvg)) throw new Error(`Public artifact contains a secret: ${artifact.slug}`);
        if (!/^\s*<svg\b/.test(artifact.coverSvg) || /<script\b|\son\w+\s*=|<foreignObject\b/i.test(artifact.coverSvg)) throw new Error(`Unsafe SVG cover: ${artifact.slug}`);
        const snapshot = buildSnapshot(artifact.files.map((file) => ({ path: file.path, bytes: encode(file.content) })));
        if (!snapshot.ok) throw new Error(`${artifact.slug}: ${snapshot.error}`);
        const source = JSON.stringify(snapshot.bundle);
        const files = parseBundle(source);
        const version = `v1-${(await sha256(encode(JSON.stringify(artifact)))).slice(0,20)}`;
        const root = `discover/${artifact.slug}/${version}`;
        const archive = zipSync(Object.fromEntries(files.map((file) => [file.path,file.bytes])), { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
        const raw: Array<{ role: SeedObject['role']; name: string; mime: string; bytes: Uint8Array }> = [
            { role: 'cover',name: 'cover.svg',mime: 'image/svg+xml',bytes: encode(artifact.coverSvg) },
            { role: 'preview',name: 'preview.html',mime: 'text/html; charset=utf-8',bytes: encode(artifact.previewHtml) },
            { role: 'source',name: 'files.json',mime: 'application/json',bytes: encode(source) },
            { role: 'download',name: 'source.zip',mime: 'application/zip',bytes: archive },
        ];
        const objects: SeedObject[] = await Promise.all(raw.map(async (item) => ({ id: `${artifact.slug}-${version}-${item.role}`,role: item.role,key: `${root}/${item.name}`,mime: item.mime,bytes: item.bytes,sha256: await sha256(item.bytes) })));
        const manifest = encode(JSON.stringify({ slug: artifact.slug,version,provenance: 'Original first-party Estori catalog artwork and code',objects: objects.map(({ role,key,mime,bytes,sha256 }) => ({ role,key,mime,byteSize: bytes.byteLength,sha256 })) }));
        objects.push({ id: `${artifact.slug}-${version}-manifest`,role: 'manifest',key: `${root}/manifest.json`,mime: 'application/json',bytes: manifest,sha256: await sha256(manifest) });
        return { artifact, version, objects };
    }));
}

/** All uploads are read back and hash-verified before the first publication write. Failed uploads leave existing versions intact. */
export async function seedCatalog(db: D1Database, storage: CatalogSeedStorage, artifacts: CatalogArtifact[], categories: readonly CatalogCategorySeed[]): Promise<{ entries: number; objects: number }> {
    const prepared = await prepareCatalog(artifacts,categories);
    const objects = prepared.flatMap((entry) => entry.objects);
    for (let i = 0; i < objects.length; i += 8) {
        const uploaded = await Promise.allSettled(objects.slice(i,i + 8).map(async (object) => {
            const existing = await storage.get(object.key);
            if (existing) {
                if (await sha256(existing) !== object.sha256) throw new Error(`Immutable artifact hash mismatch: ${object.key}`);
            } else {
                await storage.put(object.key,object.bytes,object.mime);
            }
            const persisted = await storage.get(object.key);
            if (!persisted || await sha256(persisted) !== object.sha256) throw new Error(`R2 verification failed: ${object.key}`);
        }));
        const failed = uploaded.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }
    await db.batch(categories.map((category,index) => db.prepare(`INSERT INTO discover_categories(id,slug,title,description,color,sort_order) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,color=excluded.color,sort_order=excluded.sort_order`).bind(category.slug,category.slug,category.title,category.description,category.color,index)));
    for (let index = 0; index < prepared.length; index++) {
        const { artifact: a,version,objects } = prepared[index];
        const source = objects.find((object) => object.role === 'source')!;
        const download = objects.find((object) => object.role === 'download')!;
        const now = Date.now();
        await db.batch([
            db.prepare(`INSERT INTO discover_entries(id,slug,title,summary,description,category_id,kind,tier,price_cents,currency,version,tags,features,palette,animation_key,featured,published,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'usd',?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,description=excluded.description,category_id=excluded.category_id,kind=excluded.kind,tier=excluded.tier,price_cents=excluded.price_cents,version=excluded.version,tags=excluded.tags,features=excluded.features,palette=excluded.palette,animation_key=excluded.animation_key,featured=excluded.featured,published=1,sort_order=excluded.sort_order,updated_at=excluded.updated_at`).bind(a.slug,a.slug,a.title,a.summary,a.description,a.categorySlug,a.kind,a.tier,a.priceCents,version,JSON.stringify(a.tags),JSON.stringify(a.features),JSON.stringify(a.palette),a.animationKey,Number(a.featured),index,now),
            db.prepare(`INSERT INTO discover_versions(id,entry_id,version,price_cents,currency,source_key,download_key,source_sha256,created_at) VALUES(?,?,?,?,'usd',?,?,?,?) ON CONFLICT(entry_id,version) DO NOTHING`).bind(`${a.slug}:${version}`,a.slug,version,a.priceCents,source.key,download.key,source.sha256,now),
            ...objects.map((object) => db.prepare(`INSERT INTO discover_assets(id,entry_id,version,role,object_key,mime,byte_size,sha256) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(object.id,a.slug,version,object.role,object.key,object.mime,object.bytes.byteLength,object.sha256)),
        ]);
    }
    return { entries: prepared.length,objects: objects.length };
}
