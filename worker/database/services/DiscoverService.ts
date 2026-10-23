import type { DiscoverCatalogFilters, DiscoverCatalogPage, DiscoverCategory, DiscoverEntry, DiscoverEntryDetail } from '../../../shared/types/discover-catalog';

interface EntryRow {
    id: string; slug: string; title: string; summary: string; description: string; category_slug: string; category_title: string;
    kind: 'store' | 'component'; tier: 'free' | 'premium'; price_cents: number; currency: 'usd'; version: string;
    tags: string; features: string; palette: string; animation_key: string; featured: number; cover_id: string; preview_id: string;
}
export interface DiscoverAsset { id: string; role: string; object_key: string; mime: string; byte_size: number; sha256: string; }
export interface DiscoverVersion { id: string; entry_id: string; version: string; price_cents: number; currency: string; source_key: string; download_key: string; source_sha256: string; }
export interface DiscoverOrder { entry_id: string; product_name: string; buyer_email: string; return_url: string; id: string; user_id: string; version_id: string; price_cents: number; currency: string; session_id: string | null; payment_intent_id: string | null; status: 'pending' | 'paid' | 'refunded' | 'expired' | 'duplicate'; created_at: number; }
const selectEntry = `SELECT e.*, c.slug AS category_slug, c.title AS category_title, cover.id AS cover_id, preview.id AS preview_id
 FROM discover_entries e JOIN discover_categories c ON c.id=e.category_id
 JOIN discover_assets cover ON cover.entry_id=e.id AND cover.version=e.version AND cover.role='cover'
 JOIN discover_assets preview ON preview.entry_id=e.id AND preview.version=e.version AND preview.role='preview'`;
function dto(row: EntryRow): DiscoverEntry {
    const media = `/api/discover/catalog/${encodeURIComponent(row.slug)}/media/`;
    return { id: row.id, slug: row.slug, title: row.title, summary: row.summary, description: row.description,
        categorySlug: row.category_slug, categoryTitle: row.category_title, kind: row.kind, tier: row.tier,
        priceCents: row.price_cents, currency: row.currency, version: row.version, tags: JSON.parse(row.tags),
        features: JSON.parse(row.features), palette: JSON.parse(row.palette), animationKey: row.animation_key,
        coverUrl: media + encodeURIComponent(row.cover_id), previewUrl: media + encodeURIComponent(row.preview_id), featured: row.featured === 1 };
}

/** Parameterized D1 queries keep private artifact locations outside public DTOs. */
export class DiscoverService {
    constructor(private readonly db: D1Database) {}
    async list(filters: DiscoverCatalogFilters): Promise<DiscoverCatalogPage> {
        const where = ['e.published=1'];
        const values: (string | number)[] = [];
        if (filters.category) { where.push('c.slug=?'); values.push(filters.category); }
        if (filters.kind) { where.push('e.kind=?'); values.push(filters.kind); }
        if (filters.tier) { where.push('e.tier=?'); values.push(filters.tier); }
        if (filters.search) { where.push("(e.title LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\')"); const term = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`; values.push(term, term, term); }
        const clause = where.join(' AND ');
        const limit = filters.limit ?? 48;
        const offset = filters.offset ?? 0;
        const [rows, count] = await Promise.all([
            this.db.prepare(`${selectEntry} WHERE ${clause} ORDER BY e.sort_order,e.slug LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<EntryRow>(),
            this.db.prepare(`SELECT COUNT(*) AS total FROM discover_entries e JOIN discover_categories c ON c.id=e.category_id WHERE ${clause}`).bind(...values).first<{ total: number }>(),
        ]);
        return { entries: rows.results.map(dto), total: count?.total ?? 0, limit, offset };
    }
    async categories(): Promise<DiscoverCategory[]> {
        const rows = await this.db.prepare(`SELECT c.*, COUNT(e.id) AS count FROM discover_categories c LEFT JOIN discover_entries e ON e.category_id=c.id AND e.published=1 GROUP BY c.id ORDER BY c.sort_order`).all<{ id: string; slug: string; title: string; description: string; color: string; count: number }>();
        const covers = await this.db.prepare(`SELECT e.category_id, e.slug, a.id FROM discover_entries e JOIN discover_assets a ON a.entry_id=e.id AND a.version=e.version AND a.role='cover' WHERE e.published=1 ORDER BY e.sort_order`).all<{ category_id: string; slug: string; id: string }>();
        return rows.results.map((row) => { const cover = covers.results.find((item) => item.category_id === row.id); return { ...row, coverUrl: cover ? `/api/discover/catalog/${cover.slug}/media/${cover.id}` : null }; });
    }
    async entry(slug: string): Promise<DiscoverEntry | null> {
        const row = await this.db.prepare(`${selectEntry} WHERE e.slug=? AND e.published=1`).bind(slug).first<EntryRow>();
        return row ? dto(row) : null;
    }
    async detail(slug: string): Promise<DiscoverEntryDetail | null> {
        const entry = await this.entry(slug);
        if (!entry) return null;
        const related = await this.list({ category: entry.categorySlug, limit: 7 });
        return { entry, related: related.entries.filter((item) => item.id !== entry.id).slice(0, 5) };
    }
    publicAsset(slug: string, id: string): Promise<DiscoverAsset | null> {
        return this.db.prepare(`SELECT a.* FROM discover_assets a JOIN discover_entries e ON e.id=a.entry_id WHERE e.slug=? AND e.published=1 AND a.id=? AND a.version=e.version AND a.role IN ('cover','preview')`).bind(slug, id).first<DiscoverAsset>();
    }
    currentVersion(entry: DiscoverEntry): Promise<DiscoverVersion | null> {
        return this.db.prepare('SELECT * FROM discover_versions WHERE entry_id=? AND version=?').bind(entry.id, entry.version).first<DiscoverVersion>();
    }
    async entitledVersion(entry: DiscoverEntry, userId: string): Promise<DiscoverVersion | null> {
        if (entry.tier === 'free') return this.currentVersion(entry);
        return this.db.prepare(`SELECT v.* FROM discover_versions v JOIN discover_purchases p ON p.version_id=v.id WHERE v.entry_id=? AND p.user_id=? AND p.revoked=0 ORDER BY v.created_at DESC LIMIT 1`).bind(entry.id, userId).first<DiscoverVersion>();
    }
    order(id: string): Promise<DiscoverOrder | null> { return this.db.prepare('SELECT * FROM discover_checkout_orders WHERE id=?').bind(id).first<DiscoverOrder>(); }
    orderForSession(sessionId: string): Promise<DiscoverOrder | null> { return this.db.prepare('SELECT * FROM discover_checkout_orders WHERE session_id=?').bind(sessionId).first<DiscoverOrder>(); }
    async createOrder(id: string, userId: string, version: DiscoverVersion, now: number, checkout: { productName: string; buyerEmail: string; returnUrl: string }): Promise<DiscoverOrder | null> {
        // The partial unique index is the lock, including concurrent requests and catalog version updates.
        // An entitlement appearing between the controller read and this statement also prevents a new sale.
        await this.db.prepare(`INSERT INTO discover_checkout_orders(id,user_id,entry_id,version_id,price_cents,currency,product_name,buyer_email,return_url,status,created_at)
            SELECT ?,?,?,?,?,?,?,?,?,'pending',? WHERE NOT EXISTS (SELECT 1 FROM discover_purchases WHERE user_id=? AND entry_id=? AND revoked=0)
            ON CONFLICT DO NOTHING`).bind(id,userId,version.entry_id,version.id,version.price_cents,version.currency,checkout.productName,checkout.buyerEmail,checkout.returnUrl,now,userId,version.entry_id).run();
        return this.db.prepare("SELECT * FROM discover_checkout_orders WHERE user_id=? AND entry_id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM discover_purchases WHERE user_id=? AND entry_id=? AND revoked=0)").bind(userId,version.entry_id,userId,version.entry_id).first<DiscoverOrder>();
    }
    async attachSession(id: string, sessionId: string): Promise<void> {
        await this.db.prepare('UPDATE discover_checkout_orders SET session_id=? WHERE id=? AND (session_id IS NULL OR session_id=?)').bind(sessionId,id,sessionId).run();
    }
    /** Only call after Stripe has confirmed this exact session is expired. */
    async expireOrder(id: string, sessionId: string): Promise<void> {
        await this.db.prepare("UPDATE discover_checkout_orders SET status='expired' WHERE id=? AND session_id=? AND status='pending'").bind(id,sessionId).run();
    }
    async recordPurchase(order: DiscoverOrder, sessionId: string, paymentIntentId: string): Promise<'recorded' | 'refunded' | 'duplicate'> {
        // Atomic uniqueness is per buyer and entry, including historical versions and delayed completions.
        await this.db.batch([
            this.db.prepare("UPDATE discover_checkout_orders SET status='paid',session_id=?,payment_intent_id=? WHERE id=? AND status!='refunded' AND (session_id IS NULL OR session_id=?)").bind(sessionId,paymentIntentId,order.id,sessionId),
            this.db.prepare("INSERT INTO discover_purchases(id,user_id,entry_id,version_id,order_id,revoked,created_at) SELECT id,user_id,entry_id,version_id,id,0,? FROM discover_checkout_orders WHERE id=? AND status='paid' ON CONFLICT DO NOTHING").bind(Date.now(),order.id),
            this.db.prepare("UPDATE discover_checkout_orders SET status='duplicate' WHERE id=? AND status='paid' AND NOT EXISTS (SELECT 1 FROM discover_purchases WHERE order_id=?)").bind(order.id,order.id),
        ]);
        const saved = await this.order(order.id);
        return saved?.status === 'paid' ? 'recorded' : saved?.status === 'refunded' ? 'refunded' : 'duplicate';
    }
    async revokePurchase(paymentIntentId: string, orderId: string | null): Promise<void> {
        await this.db.batch([
            this.db.prepare("UPDATE discover_checkout_orders SET status='refunded' WHERE payment_intent_id=? OR id=?").bind(paymentIntentId,orderId),
            this.db.prepare("UPDATE discover_purchases SET revoked=1 WHERE order_id IN (SELECT id FROM discover_checkout_orders WHERE status='refunded' AND (payment_intent_id=? OR id=?))").bind(paymentIntentId,orderId),
        ]);
    }
}
