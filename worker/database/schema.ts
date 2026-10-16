import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
// Relative on purpose: drizzle-kit loads this file without the `shared` alias.
import {
    TEMPLATE_CATEGORIES,
    TEMPLATE_LISTING_STATUSES,
    TEMPLATE_PAYMENT_PROVIDERS,
    TEMPLATE_VERSION_STATUSES,
    USER_ROLES,
} from '../../shared/types/templates';
import {
    CATALOG_ITEM_STATUSES,
    CATALOG_OFFER_UNAVAILABLE_REASONS,
    CATALOG_ORDER_STATUSES,
    CATALOG_PRODUCT_STATUSES,
    CATALOG_SUPPLIERS,
    CATALOG_VARIANT_STATUSES,
} from '../../shared/types/catalog';
import {
    DISPUTE_REVERSAL_STATES,
    PAYOUT_INTERVALS,
    SELLER_CHARGE_KINDS,
    STORE_CHECKOUT_STATUSES,
    STORE_FULFILLMENT_STATUSES,
    STORE_LINE_KINDS,
    STORE_MODES,
    STORE_PAYMENT_STATUSES,
    STORE_REFUND_INITIATORS,
} from '../../shared/types/store-payments';

// Schema enum arrays derived from config types  
const REASONING_EFFORT_VALUES = ['low', 'medium', 'high'] as const;
const PROVIDER_OVERRIDE_VALUES = ['cloudflare', 'direct'] as const;

// ========================================
// CORE USER AND IDENTITY MANAGEMENT
// ========================================

/**
 * Users table - Core user identity and profile information
 * Supports OAuth providers and user preferences
 */
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    username: text('username').unique(), // Optional username for public identity
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    
    // OAuth and Authentication
    provider: text('provider').notNull(), // 'github', 'google', 'email'
    providerId: text('provider_id').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
    passwordHash: text('password_hash'), // Only for provider: 'email'
    
    // Security enhancements
    failedLoginAttempts: integer('failed_login_attempts').default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp' }),
    passwordChangedAt: integer('password_changed_at', { mode: 'timestamp' }),
    
    // User Preferences and Settings
    preferences: text('preferences', { mode: 'json' }).default('{}'),
    theme: text('theme', { enum: ['light', 'dark', 'system'] }).default('system'),
    timezone: text('timezone').default('UTC'),
    // Whether the user's own Cloudflare AI Gateway should be used for inference.
    // Nullable on purpose: null means "use the derived default" (off for users who
    // signed in with Cloudflare, on for everyone else who explicitly connected).
    aiGatewayEnabled: integer('ai_gateway_enabled', { mode: 'boolean' }),

    // Platform role; admins review template submissions.
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    
    // Account Status
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    isSuspended: integer('is_suspended', { mode: 'boolean' }).default(false),
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),

    // Terms of Service agreement: when and which version; null until the user agrees.
    termsAcceptedAt: integer('terms_accepted_at', { mode: 'timestamp' }),
    termsVersion: text('terms_version'),
    /** The selling-terms version the user agreed to before their stores take payments; null until they do. */
    sellerTermsVersion: text('seller_terms_version'),
    sellerTermsAcceptedAt: integer('seller_terms_accepted_at', { mode: 'timestamp' }),
    
    // Soft delete
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
    providerIdx: uniqueIndex('users_provider_unique_idx').on(table.provider, table.providerId),
    usernameIdx: index('users_username_idx').on(table.username),
    failedLoginAttemptsIdx: index('users_failed_login_attempts_idx').on(table.failedLoginAttempts),
    lockedUntilIdx: index('users_locked_until_idx').on(table.lockedUntil),
    isActiveIdx: index('users_is_active_idx').on(table.isActive),
    lastActiveAtIdx: index('users_last_active_at_idx').on(table.lastActiveAt),
}));

/**
 * User OAuth Identities table - Links multiple OAuth provider identities to a
 * single user. Login resolves by (provider, providerId) here rather than by
 * email, which prevents cross-provider account takeover via email collision.
 */
export const userOauthIdentities = sqliteTable('user_oauth_identities', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // Provider identity
    provider: text('provider').notNull(), // 'github', 'google', 'cloudflare'
    providerId: text('provider_id').notNull(),

    // Provider-reported email at link/login time (for display and auditing)
    email: text('email'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),

    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    providerIdx: uniqueIndex('user_oauth_identities_provider_unique_idx').on(table.provider, table.providerId),
    userIdx: index('user_oauth_identities_user_idx').on(table.userId),
}));

/**
 * Sessions table - JWT session management with refresh token support
 */
export const sessions = sqliteTable('sessions', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Session Details
    deviceInfo: text('device_info'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    
    // Security metadata
    isRevoked: integer('is_revoked', { mode: 'boolean' }).default(false),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revokedReason: text('revoked_reason'),
    
    // Token Management
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    
    // Timing
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    lastActivity: integer('last_activity', { mode: 'timestamp' }),
}, (table) => ({
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
    accessTokenHashIdx: index('sessions_access_token_hash_idx').on(table.accessTokenHash),
    refreshTokenHashIdx: index('sessions_refresh_token_hash_idx').on(table.refreshTokenHash),
    lastActivityIdx: index('sessions_last_activity_idx').on(table.lastActivity),
    isRevokedIdx: index('sessions_is_revoked_idx').on(table.isRevoked),
}));

/**
 * API Keys table - Manage user API keys for programmatic access
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Key Details
    name: text('name').notNull(), // User-friendly name for the API key
    keyHash: text('key_hash').notNull().unique(), // Hashed API key for security
    keyPreview: text('key_preview').notNull(), // First few characters for display (e.g., "sk_prod_1234...")
    
    // Security and Access Control
    scopes: text('scopes').notNull(), // JSON array of allowed scopes
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    
    // Usage Tracking
    lastUsed: integer('last_used', { mode: 'timestamp' }),
    requestCount: integer('request_count').default(0), // Track usage
    
    // Timing
    expiresAt: integer('expires_at', { mode: 'timestamp' }), // Optional expiration
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdIdx: index('api_keys_user_id_idx').on(table.userId),
    keyHashIdx: index('api_keys_key_hash_idx').on(table.keyHash),
    isActiveIdx: index('api_keys_is_active_idx').on(table.isActive),
    expiresAtIdx: index('api_keys_expires_at_idx').on(table.expiresAt),
}));

// ========================================
// CORE APP AND GENERATION SYSTEM
// ========================================

/**
 * Apps table - Generated applications with comprehensive metadata
 */
export const apps = sqliteTable('apps', {
    id: text('id').primaryKey(),
    
    // App Identity
    title: text('title').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'), // App icon URL
    
    // Original Generation Data
    originalPrompt: text('original_prompt').notNull(), // The user's original request
    finalPrompt: text('final_prompt'), // The processed/refined prompt used for generation
    
    // Generated Content  
    framework: text('framework'), // 'react', 'vue', 'svelte', etc.
    
    // Ownership and Context
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // Null for anonymous
    sessionToken: text('session_token'), // For anonymous users
    
    // Visibility and Sharing
    visibility: text('visibility', { enum: ['private', 'public'] }).notNull().default('private'),
    
    // Status and State
    status: text('status', { enum: ['generating', 'completed'] }).notNull().default('generating'),
    
    // Deployment Information
    deploymentId: text('deployment_id'), // Deployment ID (extracted from deployment URL)
    
    // GitHub Repository Integration
    githubRepositoryUrl: text('github_repository_url'), // GitHub repository URL
    githubRepositoryVisibility: text('github_repository_visibility', { enum: ['public', 'private'] }), // Repository visibility
    
    // App Metadata
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    isFeatured: integer('is_featured', { mode: 'boolean' }).default(false), // Featured by admins
    
    // Versioning (for future support)
    version: integer('version').default(1),
    parentAppId: text('parent_app_id'), // Forked from, or started from by reuse
    fromTemplateVersionId: text('from_template_version_id'), // Approved paid version this app was copied from

    // Discover: the owner's category and consent to reuse, and admin removal.
    category: text('category', { enum: TEMPLATE_CATEGORIES }),
    reuseConsentAt: integer('reuse_consent_at', { mode: 'timestamp' }),
    removedFromDiscoverAt: integer('removed_from_discover_at', { mode: 'timestamp' }),
    removedFromDiscoverBy: text('removed_from_discover_by'),
    removedFromDiscoverReason: text('removed_from_discover_reason'),

    // Preview-token revocation epoch. Incremented on every visibility change so
    // outstanding space-preview tokens (which embed the value at mint) are
    // rejected after a public->private toggle.
    previewVersion: integer('preview_version').notNull().default(0),
    
    // Screenshot Information
    screenshotUrl: text('screenshot_url'), // URL to saved screenshot image
    screenshotCapturedAt: integer('screenshot_captured_at', { mode: 'timestamp' }), // When screenshot was last captured
    showcaseScreenshotUrl: text('showcase_screenshot_url'), // Tall Discover showcase image, 1280x1650 JPEG
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    lastDeployedAt: integer('last_deployed_at', { mode: 'timestamp' }),
}, (table) => ({
    userIdx: index('apps_user_idx').on(table.userId),
    statusIdx: index('apps_status_idx').on(table.status),
    visibilityIdx: index('apps_visibility_idx').on(table.visibility),
    sessionTokenIdx: index('apps_session_token_idx').on(table.sessionToken),
    parentAppIdx: index('apps_parent_app_idx').on(table.parentAppId),
    // Performance indexes for common queries
    searchIdx: index('apps_search_idx').on(table.title, table.description),
    frameworkStatusIdx: index('apps_framework_status_idx').on(table.framework, table.status),
    visibilityStatusIdx: index('apps_visibility_status_idx').on(table.visibility, table.status),
    createdAtIdx: index('apps_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('apps_updated_at_idx').on(table.updatedAt),
}));

// ========================================
// TEMPLATES
// ========================================

/**
 * Paid listings - one per app whose owner set a price. Name, description and
 * category come from the app; the approved version and its price live here.
 */
export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    sourceAppId: text('source_app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    creatorUserId: text('creator_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Null until an admin approves the first version.
    currentVersionId: text('current_version_id'),
    // `unlisted` while the app is free again; a new listing starts unlisted until its first submission is stored.
    status: text('status', { enum: TEMPLATE_LISTING_STATUSES }).notNull().default('listed'),
    // The approved version's price in US cents; 0 before the first approval.
    priceCents: integer('price_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    creatorIdx: index('templates_creator_idx').on(table.creatorUserId),
    sourceAppIdx: uniqueIndex('templates_source_app_unique_idx').on(table.sourceAppId),
}));

/**
 * Template versions table - One row per submission. Files and screenshots are
 * frozen in R2 under templates/<templateId>/<versionId>/.
 */
export const templateVersions = sqliteTable('template_versions', {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull().references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sourceCommit: text('source_commit').notNull(),
    snapshotKey: text('snapshot_key').notNull(),
    fileCount: integer('file_count').notNull(),
    totalBytes: integer('total_bytes').notNull(),
    desktopShotKey: text('desktop_shot_key').notNull(),
    mobileShotKey: text('mobile_shot_key').notNull(),
    pageCopy: text('page_copy'), // Page text sent for review with this version (JSON)
    // The price this submission asks for; approval copies it to the listing.
    priceCents: integer('price_cents').notNull(),
    status: text('status', { enum: TEMPLATE_VERSION_STATUSES }).notNull().default('pending'),
    rightsConfirmedAt: integer('rights_confirmed_at', { mode: 'timestamp' }).notNull(),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
    rejectionReason: text('rejection_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    templateVersionIdx: uniqueIndex('template_versions_template_version_unique_idx').on(table.templateId, table.version),
    statusIdx: index('template_versions_status_idx').on(table.status),
    // A listing holds at most one version in review.
    onePendingIdx: uniqueIndex('template_versions_one_pending_idx').on(table.templateId).where(sql`${table.status} = 'pending'`),
}));

/**
 * Template purchases table - Who may use a paid site. Recorded with the 'test' provider (no charge) until a payment provider is connected.
 */
export const templatePurchases = sqliteTable('template_purchases', {
    id: text('id').primaryKey(),
    // Kept when the listing is deleted with its app.
    templateId: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents').notNull(),
    provider: text('provider', { enum: TEMPLATE_PAYMENT_PROVIDERS }).notNull(),
    // Stripe purchases: the Checkout session (unique, so webhook and confirm record it once) and the money split.
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    platformFeeCents: integer('platform_fee_cents'),
    sellerAmountCents: integer('seller_amount_cents'),
    currency: text('currency').notNull().default('usd'),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    // What was bought, kept when the listing is deleted with its app.
    sourceAppId: text('source_app_id'),
    versionId: text('version_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    templateUserIdx: uniqueIndex('template_purchases_template_user_unique_idx').on(table.templateId, table.userId),
    userIdx: index('template_purchases_user_idx').on(table.userId),
    // SQLite cannot add a UNIQUE column with ALTER TABLE, so uniqueness comes from this index.
    checkoutSessionIdx: uniqueIndex('template_purchases_checkout_session_unique_idx').on(table.stripeCheckoutSessionId),
}));

/** A site's product page text as the creator last saved it (JSON). Paid sites show their approved version's text instead. */
export const sitePages = sqliteTable('site_pages', {
    appId: text('app_id').primaryKey().references(() => apps.id, { onDelete: 'cascade' }),
    copy: text('copy').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Stripe Connect accounts - the Express account a seller is paid through,
 * with the readiness flags Stripe reports (refreshed by webhook and status checks).
 */
export const stripeConnectAccounts = sqliteTable('stripe_connect_accounts', {
    userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    detailsSubmitted: integer('details_submitted', { mode: 'boolean' }).notNull().default(false),
    chargesEnabled: integer('charges_enabled', { mode: 'boolean' }).notNull().default(false),
    payoutsEnabled: integer('payouts_enabled', { mode: 'boolean' }).notNull().default(false),
    transfersActive: integer('transfers_active', { mode: 'boolean' }).notNull().default(false),
    /** The seller can be the merchant of record (on_behalf_of); store checkout requires it. */
    cardPaymentsActive: integer('card_payments_active', { mode: 'boolean' }).notNull().default(false),
    /** How often the seller is paid; they choose, and pay Stripe's per-payout cost. */
    payoutInterval: text('payout_interval', { enum: PAYOUT_INTERVALS }).notNull().default('weekly'),
    /** A weekday for weekly payouts, or a day of the month (as text) for monthly ones. */
    payoutAnchor: text('payout_anchor').notNull().default('monday'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Catalog orders - the catalog part of a paid store checkout. Estori buys these items from suppliers with the
 * application fee it took from the payment; one order per Checkout session.
 */
export const catalogOrders = sqliteTable('catalog_orders', {
    id: text('id').primaryKey(),
    sellerUserId: text('seller_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storeAppId: text('store_app_id').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    status: text('status', { enum: CATALOG_ORDER_STATUSES }).notNull().default('awaiting-placement'),
    totalCents: integer('total_cents').notNull(),
    catalogTotalCents: integer('catalog_total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    destinationCountry: text('destination_country').notNull(),
    // The shopper's address as JSON: supplier orders are placed after the webhook answers.
    shippingAddress: text('shipping_address').notNull(),
    placementAttempts: integer('placement_attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    checkoutSessionIdx: uniqueIndex('catalog_orders_checkout_session_unique_idx').on(table.stripeCheckoutSessionId),
    sellerIdx: index('catalog_orders_seller_idx').on(table.sellerUserId),
    statusIdx: index('catalog_orders_status_idx').on(table.status),
}));

/** Catalog order items - one per catalog line, with the price locked at checkout and the supplier's progress. */
export const catalogOrderItems = sqliteTable('catalog_order_items', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => catalogOrders.id, { onDelete: 'cascade' }),
    catalogVariantId: text('catalog_variant_id').notNull(),
    supplier: text('supplier', { enum: CATALOG_SUPPLIERS }).notNull(),
    supplierVariantId: text('supplier_variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    catalogPriceCents: integer('catalog_price_cents').notNull(),
    status: text('status', { enum: CATALOG_ITEM_STATUSES }).notNull().default('pending'),
    supplierOrderId: text('supplier_order_id'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    supplierRefunded: integer('supplier_refunded', { mode: 'boolean' }).notNull().default(false),
    // The seller's share of a refunded item still to take back from their transfer; 0 once reversed.
    sellerReversalDueCents: integer('seller_reversal_due_cents').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    orderIdx: index('catalog_order_items_order_idx').on(table.orderId),
    supplierOrderIdx: index('catalog_order_items_supplier_order_idx').on(table.supplierOrderId),
}));

/**
 * Store checkouts - a cart Estori priced and sent to Stripe. Financial records: no foreign key to apps, so they
 * outlive a deleted app.
 */
export const storeCheckouts = sqliteTable('store_checkouts', {
    id: text('id').primaryKey(),
    mode: text('mode', { enum: STORE_MODES }).notNull(),
    appId: text('app_id').notNull(),
    storeVersionId: text('store_version_id'),
    commitHash: text('commit_hash').notNull(),
    sellerUserId: text('seller_user_id').notNull(),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    shipToCountry: text('ship_to_country').notNull(),
    // The PricedCart as JSON: what the shopper pays is fixed here, never re-read from the store.
    pricedCart: text('priced_cart').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    status: text('status', { enum: STORE_CHECKOUT_STATUSES }).notNull().default('creating'),
    successPath: text('success_path').notNull(),
    cancelPath: text('cancel_path').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    sessionIdx: uniqueIndex('store_checkouts_session_unique_idx').on(table.stripeCheckoutSessionId),
    appIdx: index('store_checkouts_app_idx').on(table.appId),
}));

/** Store orders - one per paid checkout, numbered per store and mode. */
export const storeOrders = sqliteTable('store_orders', {
    id: text('id').primaryKey(),
    mode: text('mode', { enum: STORE_MODES }).notNull(),
    appId: text('app_id').notNull(),
    orderNumber: integer('order_number').notNull(),
    checkoutId: text('checkout_id').notNull(),
    sellerUserId: text('seller_user_id').notNull(),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    storeVersionId: text('store_version_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    paymentStatus: text('payment_status', { enum: STORE_PAYMENT_STATUSES }).notNull().default('paid'),
    fulfillmentStatus: text('fulfillment_status', { enum: STORE_FULFILLMENT_STATUSES }).notNull().default('unfulfilled'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    refundedCents: integer('refunded_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    customerEmail: text('customer_email'),
    customerName: text('customer_name'),
    // The shopper's address as JSON, for the seller to ship own products.
    shippingAddress: text('shipping_address'),
    note: text('note'),
    needsAttention: text('needs_attention'),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    checkoutIdx: uniqueIndex('store_orders_checkout_unique_idx').on(table.checkoutId),
    sessionIdx: uniqueIndex('store_orders_session_unique_idx').on(table.stripeCheckoutSessionId),
    numberIdx: uniqueIndex('store_orders_number_unique_idx').on(table.appId, table.mode, table.orderNumber),
    paymentIntentIdx: index('store_orders_payment_intent_idx').on(table.stripePaymentIntentId),
    sellerIdx: index('store_orders_seller_idx').on(table.sellerUserId),
}));

/** Store order items - the priced lines, as the shopper paid for them. */
export const storeOrderItems = sqliteTable('store_order_items', {
    orderId: text('order_id').notNull().references(() => storeOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    kind: text('kind', { enum: STORE_LINE_KINDS }).notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    catalogVariantId: text('catalog_variant_id'),
    lockedCatalogPriceCents: integer('locked_catalog_price_cents'),
}, (table) => ({
    pk: primaryKey({ columns: [table.orderId, table.lineNo] }),
}));

/**
 * Every refund of a store order line, by whoever started it. The row is claimed before Stripe is called, so a line is
 * refunded once whoever asks; the Stripe refund and the seller's reversal are filled in as they happen.
 */
export const storeRefunds = sqliteTable('store_refunds', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    lineNo: integer('line_no').notNull(),
    amountCents: integer('amount_cents').notNull(),
    requestId: text('request_id').notNull(),
    initiatedBy: text('initiated_by', { enum: STORE_REFUND_INITIATORS }).notNull(),
    stripeRefundId: text('stripe_refund_id'),
    /** What to take back from the seller's transfer for this line; 0 when the catalog refund handles it. */
    reversalCents: integer('reversal_cents').notNull().default(0),
    reversalId: text('reversal_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    orderLineUnique: uniqueIndex('store_refunds_order_line_unique_idx').on(table.orderId, table.lineNo),
    orderIdx: index('store_refunds_order_idx').on(table.orderId),
}));

/** A shopper's dispute of a store order, and what Estori took back from the seller for it. */
export const storeDisputes = sqliteTable('store_disputes', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    amountCents: integer('amount_cents').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    /** none: nothing to take back yet (an inquiry); planned: saved before Stripe is called; done or refused after. */
    reversalState: text('reversal_state', { enum: DISPUTE_REVERSAL_STATES }).notNull().default('none'),
    reversalId: text('reversal_id'),
    reversedCents: integer('reversed_cents').notNull().default(0),
    feeCents: integer('fee_cents').notNull().default(0),
    returnedCents: integer('returned_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/** What a seller owes Estori outside one sale; taken from their next sales. */
export const sellerCharges = sqliteTable('seller_charges', {
    id: text('id').primaryKey(),
    sellerUserId: text('seller_user_id').notNull().references(() => users.id),
    kind: text('kind', { enum: SELLER_CHARGE_KINDS }).notNull(),
    sourceId: text('source_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    collectedCents: integer('collected_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    kindSourceUnique: uniqueIndex('seller_charges_kind_source_unique_idx').on(table.kind, table.sourceId),
    openIdx: index('seller_charges_seller_idx').on(table.sellerUserId, table.createdAt),
}));

export const sellerChargeCollections = sqliteTable('seller_charge_collections', {
    chargeId: text('charge_id').notNull().references(() => sellerCharges.id),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    /** Null while the collection is claimed but not yet taken from the transfer. */
    reversalId: text('reversal_id'),
    amountCents: integer('amount_cents').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    chargeOrderUnique: uniqueIndex('seller_charge_collections_unique_idx').on(table.chargeId, table.orderId),
}));

/** The card fee Stripe charged above what the sale collected, taken back from the seller once per order. */
export const storeFeeAdjustments = sqliteTable('store_fee_adjustments', {
    orderId: text('order_id').primaryKey().references(() => storeOrders.id),
    collectedCents: integer('collected_cents').notNull(),
    actualFeeCents: integer('actual_fee_cents').notNull(),
    /** What to take back, saved before Stripe is called; the reversal id follows once it's done. */
    differenceCents: integer('difference_cents').notNull().default(0),
    reversalId: text('reversal_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** Catalog products - the curated supplier products Estori sells, refreshed from the supplier. */
export const catalogProducts = sqliteTable('catalog_products', {
    id: text('id').primaryKey(),
    supplier: text('supplier', { enum: CATALOG_SUPPLIERS }).notNull(),
    supplierProductId: text('supplier_product_id').notNull(),
    status: text('status', { enum: CATALOG_PRODUCT_STATUSES }).notNull().default('active'),
    category: text('category').notNull(),
    title: text('title'),
    description: text('description'),
    // JSON arrays and objects: R2 keys of the copied images, and the supplier's English properties.
    images: text('images').notNull().default('[]'),
    attributes: text('attributes').notNull().default('{}'),
    detailsRefreshedAt: integer('details_refreshed_at', { mode: 'timestamp' }),
    refreshClaimedUntil: integer('refresh_claimed_until', { mode: 'timestamp' }),
    lastRefreshError: text('last_refresh_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    supplierIdx: uniqueIndex('catalog_products_supplier_unique_idx').on(table.supplier, table.supplierProductId),
    statusIdx: index('catalog_products_status_idx').on(table.status),
}));

/** Catalog variants - one per supplier variant; the id is the catalogVariantId stores and carts carry. */
export const catalogVariants = sqliteTable('catalog_variants', {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull().references(() => catalogProducts.id, { onDelete: 'cascade' }),
    supplierVariantId: text('supplier_variant_id').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    options: text('options').notNull().default('{}'),
    imageKey: text('image_key'),
    weightGrams: integer('weight_grams').notNull(),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    // JSON { countryCode: quantity } of the supplier's stock by warehouse country.
    stock: text('stock').notNull().default('{}'),
    status: text('status', { enum: CATALOG_VARIANT_STATUSES }).notNull().default('active'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    supplierVariantIdx: uniqueIndex('catalog_variants_supplier_variant_unique_idx').on(table.supplierVariantId),
    productIdx: index('catalog_variants_product_idx').on(table.productId),
}));

/** Catalog variant offers - a variant's price and availability for one destination country. */
export const catalogVariantOffers = sqliteTable('catalog_variant_offers', {
    variantId: text('variant_id').notNull().references(() => catalogVariants.id, { onDelete: 'cascade' }),
    destinationCountry: text('destination_country').notNull(),
    originCountry: text('origin_country').notNull(),
    logisticName: text('logistic_name'),
    deliveryDaysMin: integer('delivery_days_min'),
    deliveryDaysMax: integer('delivery_days_max'),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    shippingCents: integer('shipping_cents'),
    catalogPriceCents: integer('catalog_price_cents'),
    available: integer('available', { mode: 'boolean' }).notNull(),
    unavailableReason: text('unavailable_reason', { enum: CATALOG_OFFER_UNAVAILABLE_REASONS }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.variantId, table.destinationCountry] }),
}));

/**
 * Favorites table - Track user favorite apps
 */
export const favorites = sqliteTable('favorites', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userAppIdx: uniqueIndex('favorites_user_app_idx').on(table.userId, table.appId),
    userIdx: index('favorites_user_idx').on(table.userId),
    appIdx: index('favorites_app_idx').on(table.appId),
}));

/**
 * Stars table - Track app stars (like GitHub stars)
 */
export const stars = sqliteTable('stars', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    starredAt: integer('starred_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userAppIdx: uniqueIndex('stars_user_app_idx').on(table.userId, table.appId),
    userIdx: index('stars_user_idx').on(table.userId),
    appIdx: index('stars_app_idx').on(table.appId),
    appStarredAtIdx: index('stars_app_starred_at_idx').on(table.appId, table.starredAt),
}));

/**
 * Early-access requests for upcoming programs, one per user and program.
 */
export const earlyAccessRequests = sqliteTable('early_access_requests', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    userCapabilityIdx: uniqueIndex('early_access_requests_user_capability_idx').on(table.userId, table.capability),
    capabilityIdx: index('early_access_requests_capability_idx').on(table.capability),
}));

/**
 * Contact-sales requests from the public contact page. Anyone can send one, so they aren't tied to an account.
 */
export const contactRequests = sqliteTable('contact_requests', {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    company: text('company').notNull(),
    companySize: text('company_size').notNull(),
    topic: text('topic').notNull(),
    message: text('message'),
    premiumCredits: integer('premium_credits'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    createdAtIdx: index('contact_requests_created_at_idx').on(table.createdAt),
}));

// ========================================
// COMMUNITY INTERACTIONS
// ========================================

/**
 * AppLikes table - User likes/reactions on apps
 */
export const appLikes = sqliteTable('app_likes', {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Reaction Details
    reactionType: text('reaction_type').notNull().default('like'), // 'like', 'love', 'helpful', etc.
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    appUserIdx: uniqueIndex('app_likes_app_user_idx').on(table.appId, table.userId),
    userIdx: index('app_likes_user_idx').on(table.userId),
}));

/**
 * CommentLikes table - User likes on comments
 */
export const commentLikes = sqliteTable('comment_likes', {
    id: text('id').primaryKey(),
    commentId: text('comment_id').notNull().references(() => appComments.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Reaction Details
    reactionType: text('reaction_type').notNull().default('like'), // 'like', 'love', 'helpful', etc.
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    commentUserIdx: uniqueIndex('comment_likes_comment_user_idx').on(table.commentId, table.userId),
    userIdx: index('comment_likes_user_idx').on(table.userId),
    commentIdx: index('comment_likes_comment_idx').on(table.commentId),
}));

/**
 * AppComments table - Comments and discussions on apps
 */
export const appComments = sqliteTable('app_comments', {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Comment Content
    content: text('content').notNull(),
    parentCommentId: text('parent_comment_id'), // For threaded comments
    
    // Moderation
    isEdited: integer('is_edited', { mode: 'boolean' }).default(false),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).default(false),
    
    // Removed likeCount and replyCount - use COUNT() queries with proper indexes instead
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    appIdx: index('app_comments_app_idx').on(table.appId),
    userIdx: index('app_comments_user_idx').on(table.userId),
    parentIdx: index('app_comments_parent_idx').on(table.parentCommentId),
}));

// ========================================
// ANALYTICS AND TRACKING
// ========================================

/**
 * AppViews table - Track app views for analytics
 */
export const appViews = sqliteTable('app_views', {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    
    // Viewer Information
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // Null for anonymous
    sessionToken: text('session_token'), // For anonymous tracking
    ipAddressHash: text('ip_address_hash'), // Hashed IP for privacy
    // Stable per-viewer, per-time-bucket identity used to deduplicate views so
    // a single client cannot arbitrarily inflate view counts. For authenticated
    // viewers derived from the user id; for anonymous viewers from a hash of
    // ip + user-agent + appId. Combined with the unique index below and an
    // upsert on insert, this bounds how fast counts can grow.
    viewerHash: text('viewer_hash'),
    
    // View Context
    referrer: text('referrer'),
    userAgent: text('user_agent'),
    deviceType: text('device_type'), // 'desktop', 'mobile', 'tablet'
    
    // Timing
    viewedAt: integer('viewed_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    durationSeconds: integer('duration_seconds'), // How long they viewed
}, (table) => ({
    appIdx: index('app_views_app_idx').on(table.appId),
    userIdx: index('app_views_user_idx').on(table.userId),
    viewedAtIdx: index('app_views_viewed_at_idx').on(table.viewedAt),
    appViewedAtIdx: index('app_views_app_viewed_at_idx').on(table.appId, table.viewedAt),
    appViewerIdx: uniqueIndex('app_views_app_viewer_idx').on(table.appId, table.viewerHash),
}));

// ========================================
// OAUTH AND EXTERNAL INTEGRATIONS
// ========================================

/**
 * OAuthStates table - Manage OAuth flow states securely
 */
export const oauthStates = sqliteTable('oauth_states', {
    id: text('id').primaryKey(),
    state: text('state').notNull().unique(), // OAuth state parameter
    provider: text('provider').notNull(), // 'github', 'google', etc.
    
    // Flow Context
    redirectUri: text('redirect_uri'),
    scopes: text('scopes', { mode: 'json' }).default('[]'),
    userId: text('user_id').references(() => users.id), // If linking to existing account
    
    // Security
    codeVerifier: text('code_verifier'), // For PKCE
    nonce: text('nonce'),
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    isUsed: integer('is_used', { mode: 'boolean' }).default(false),
}, (table) => ({
    stateIdx: uniqueIndex('oauth_states_state_idx').on(table.state),
    expiresAtIdx: index('oauth_states_expires_at_idx').on(table.expiresAt),
}));

// ========================================
// NORMALIZED RELATIONSHIPS
// ========================================

/**
 * Auth Attempts table - Security monitoring and rate limiting
 */
export const authAttempts = sqliteTable('auth_attempts', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    identifier: text('identifier').notNull(),
    attemptType: text('attempt_type', { 
        enum: ['login', 'register', 'oauth_google', 'oauth_github', 'oauth_cloudflare', 'refresh', 'reset_password'] 
    }).notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent'),
    attemptedAt: integer('attempted_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    lookupIdx: index('auth_attempts_lookup_idx').on(table.identifier, table.attemptedAt),
    ipIdx: index('auth_attempts_ip_idx').on(table.ipAddress, table.attemptedAt),
    successIdx: index('auth_attempts_success_idx').on(table.success, table.attemptedAt),
    attemptTypeIdx: index('auth_attempts_type_idx').on(table.attemptType, table.attemptedAt),
}));

/**
 * Password Reset Tokens table - Secure password reset functionality
 */
export const passwordResetTokens = sqliteTable('password_reset_tokens', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    used: integer('used', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    lookupIdx: index('password_reset_tokens_lookup_idx').on(table.tokenHash),
    expiryIdx: index('password_reset_tokens_expiry_idx').on(table.expiresAt),
}));

/**
 * Email Verification Tokens table - Email verification functionality
 */
export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    used: integer('used', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    lookupIdx: index('email_verification_tokens_lookup_idx').on(table.tokenHash),
    expiryIdx: index('email_verification_tokens_expiry_idx').on(table.expiresAt),
}));

/**
 * Verification OTPs table - Store OTP codes for email verification
 */
export const verificationOtps = sqliteTable('verification_otps', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    otp: text('otp').notNull(), // Hashed OTP code
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    used: integer('used', { mode: 'boolean' }).default(false),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    emailIdx: index('verification_otps_email_idx').on(table.email),
    expiresAtIdx: index('verification_otps_expires_at_idx').on(table.expiresAt),
    usedIdx: index('verification_otps_used_idx').on(table.used),
}));

/**
 * AuditLogs table - Track important changes for compliance
 */
export const auditLogs = sqliteTable('audit_logs', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    oldValues: text('old_values', { mode: 'json' }),
    newValues: text('new_values', { mode: 'json' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: index('audit_logs_user_idx').on(table.userId),
    entityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
}));

// ========================================
// CLOUDFLARE ACCOUNT AND GATEWAY MANAGEMENT
// ========================================

/**
 * Cloudflare Accounts table - Store user's connected Cloudflare accounts
 */
export const cloudflareAccounts = sqliteTable('cloudflare_accounts', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Account Details
    accountId: text('account_id').notNull(), // Cloudflare account ID
    accountName: text('account_name').notNull(), // Account name from CF API
    accountEmail: text('account_email'), // Account email
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
}, (table) => ({
    userIdx: index('cloudflare_accounts_user_idx').on(table.userId),
    accountIdIdx: index('cloudflare_accounts_account_id_idx').on(table.accountId),
    userAccountIdx: uniqueIndex('cloudflare_accounts_user_account_idx').on(table.userId, table.accountId),
}));

/**
 * AI Gateways table - Store AI Gateways for each Cloudflare account
 */
export const aiGateways = sqliteTable('ai_gateways', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cloudflareAccountId: text('cloudflare_account_id').notNull().references(() => cloudflareAccounts.id, { onDelete: 'cascade' }),
    
    // Gateway Details
    gatewayId: text('gateway_id').notNull(), // Gateway ID from Cloudflare
    gatewayName: text('gateway_name').notNull(), // Gateway name
    gatewaySlug: text('gateway_slug').notNull(), // Gateway slug/identifier
    
    // Credits and Usage
    creditsRemaining: real('credits_remaining').default(0), // Cached credits value
    creditsLastUpdated: integer('credits_last_updated', { mode: 'timestamp' }),
    
    // Configuration
    autoCreated: integer('auto_created', { mode: 'boolean' }).default(false), // Was this auto-created?
    
    // Status
    isActive: integer('is_active', { mode: 'boolean' }).default(false),
    
    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: index('ai_gateways_user_idx').on(table.userId),
    accountIdx: index('ai_gateways_account_idx').on(table.cloudflareAccountId),
    userAccountIdx: index('ai_gateways_user_account_idx').on(table.userId, table.cloudflareAccountId),
    gatewayIdIdx: uniqueIndex('ai_gateways_gateway_id_idx').on(table.cloudflareAccountId, table.gatewayId),
}));

// ========================================
// USER MODEL CONFIGURATIONS
// ========================================

/**
 * User Model Configurations table - User-specific AI model settings that override defaults
 */
export const userModelConfigs = sqliteTable('user_model_configs', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Configuration Details
    agentActionName: text('agent_action_name').notNull(), // Maps to AgentActionKey from config.ts
    modelName: text('model_name'), // Override for AIModels - null means use default
    maxTokens: integer('max_tokens'), // Override max tokens - null means use default
    temperature: real('temperature'), // Override temperature - null means use default
    reasoningEffort: text('reasoning_effort', { enum: REASONING_EFFORT_VALUES }), // Override reasoning effort  
    providerOverride: text('provider_override', { enum: PROVIDER_OVERRIDE_VALUES }), // Override provider
    fallbackModel: text('fallback_model'), // Override fallback model
    
    // Status and Metadata
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userAgentIdx: uniqueIndex('user_model_configs_user_agent_idx').on(table.userId, table.agentActionName),
    userIdx: index('user_model_configs_user_idx').on(table.userId),
    isActiveIdx: index('user_model_configs_is_active_idx').on(table.isActive),
}));

/**
 * User Model Providers table - Custom OpenAI-compatible providers
 */
export const userModelProviders = sqliteTable('user_model_providers', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Provider Details
    name: text('name').notNull(), // User-friendly name (e.g., "My Local Ollama")
    baseUrl: text('base_url').notNull(), // OpenAI-compatible API base URL
    secretId: text('secret_id'),
    
    // Status and Metadata
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userNameIdx: uniqueIndex('user_model_providers_user_name_idx').on(table.userId, table.name),
    userIdx: index('user_model_providers_user_idx').on(table.userId),
    isActiveIdx: index('user_model_providers_is_active_idx').on(table.isActive),
}));

// ========================================
// SYSTEM CONFIGURATION
// ========================================

/**
 * SystemSettings table - Global system configuration
 */
export const systemSettings = sqliteTable('system_settings', {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    value: text('value', { mode: 'json' }),
    description: text('description'),
    
    // Metadata
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedBy: text('updated_by').references(() => users.id),
}, (table) => ({
    keyIdx: uniqueIndex('system_settings_key_idx').on(table.key),
}));

// ========================================
// TYPE EXPORTS FOR APPLICATION USE
// ========================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type EarlyAccessRequest = typeof earlyAccessRequests.$inferSelect;
export type NewEarlyAccessRequest = typeof earlyAccessRequests.$inferInsert;
export type ContactRequest = typeof contactRequests.$inferSelect;
export type NewContactRequest = typeof contactRequests.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;

export type AppLike = typeof appLikes.$inferSelect;
export type NewAppLike = typeof appLikes.$inferInsert;

export type CommentLike = typeof commentLikes.$inferSelect;
export type NewCommentLike = typeof commentLikes.$inferInsert;

export type AppComment = typeof appComments.$inferSelect;
export type NewAppComment = typeof appComments.$inferInsert;

export type AppView = typeof appViews.$inferSelect;
export type NewAppView = typeof appViews.$inferInsert;

export type OAuthState = typeof oauthStates.$inferSelect;
export type NewOAuthState = typeof oauthStates.$inferInsert;

export type UserOauthIdentity = typeof userOauthIdentities.$inferSelect;
export type NewUserOauthIdentity = typeof userOauthIdentities.$inferInsert;

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

export type AuthAttempt = typeof authAttempts.$inferSelect;
export type NewAuthAttempt = typeof authAttempts.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type UserModelConfig = typeof userModelConfigs.$inferSelect;
export type NewUserModelConfig = typeof userModelConfigs.$inferInsert;
export type UserModelProvider = typeof userModelProviders.$inferSelect;
export type NewUserModelProvider = typeof userModelProviders.$inferInsert;

export type Star = typeof stars.$inferSelect;
export type NewStar = typeof stars.$inferInsert;

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
export type TemplatePurchase = typeof templatePurchases.$inferSelect;
export type NewTemplatePurchase = typeof templatePurchases.$inferInsert;
export type SitePage = typeof sitePages.$inferSelect;
export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;
