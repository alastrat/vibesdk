import type { StoreTrafficAnalytics } from '@/api-types';
import type { DiscoverCategory, DiscoverCatalogFilters, DiscoverCatalogPage, DiscoverEntryDetail, DiscoverAccess, DiscoverCheckout } from '@/api-types';
import type { BillingInterval } from '@/api-types';
import type { StorePublicationStatus, StoreWorkspaceProducts } from '@/api-types';
/**
 * Unified API Client - Premium quality abstraction for all worker API calls
 * Provides type-safe methods for all endpoints with proper error handling
 * Features 401 response interception to trigger authentication modals
 */

import { getLocale } from '@/lib/i18n';
import type{
	ApiResponse,
	AppsListData,
	PublicAppsData,
	FavoriteToggleData,
	CreateAppData,
	AppDeleteData,
	AppDetailsData,
	AppStarToggleData,
	GitCloneTokenData,
	PreviewTokenData,
	UserAppsData,
	ProfileUpdateData,
	UserStatsData,
	UserActivityData,
	UserAnalyticsResponseData,
	AgentAnalyticsResponseData,
	ModelConfigsData,
	ModelConfigData,
	ModelConfigUpdateData,
	ModelConfigTestData,
	ModelConfigResetData,
	ModelConfigDefaultsData,
	ModelConfigDeleteData,
	ByokProvidersData,
	ModelConfigUpdate,
	ModelProvidersListData,
	ModelProviderCreateData,
	ModelProviderUpdateData,
	ModelProviderDeleteData,
	ModelProviderTestData,
	CreateProviderRequest,
	UpdateProviderRequest,
	TestProviderRequest,
	SecretTemplatesData,
	AgentConnectionData,
	AgentStreamingResponse,
	ActiveSessionsData,
	ApiKeysData,
	LinkedIdentitiesData,
	LoginResponseData,
	RegisterResponseData,
	ProfileResponseData,
	AuthProvidersResponseData,
	CsrfTokenResponseData,
	CloudflareConnectRequestData,
	CloudflareConnectResponseData,
	OAuthProvider,
	CodeGenArgs,
	AgentPreviewResponse,
	PlatformStatusData,
	RateLimitError,
	CapabilitiesData,
	AdminFlagsData,
	AnalyticsPreferenceData,
	Locale,
	LocalePreferenceData,
	TelemetryConfigData,
	VaultConfigResponse,
	VaultStatusResponse,
	ListAppTablesResponse,
	QueryAppTableResponse,
	WipeAppDatabaseResponse,
	ListAppBranchesResponse,
	AdminSalesData,
	ConfirmPurchaseData,
	ConfirmPurchaseRequest,
	DiscoverPricing,
	DiscoverRemovalData,
	DiscoverRemovalRequest,
	ContactAdminData,
	ContactReceivedData,
	ContactRequestBody,
	EarlyAccessAdminData,
	EarlyAccessCapability,
	MyEarlyAccessData,
	MyPaidListingsData,
	PageCopyDraftData,
	PaidVersionActionData,
	PendingReviewsData,
	PublishSiteData,
	PublishSiteRequest,
	RejectVersionRequest,
	ReviewVersionFileData,
	ReviewVersionFilesData,
	ShowcaseChangeData,
	ShowcaseChangeRequest,
	ShowcaseRefreshData,
	SiteCheckoutData,
	PublicPlanLimits,
	SitePageData,
	SitePublishingData,
	StripeConnectStatusData,
	SellerLimitsData,
	StoreOrdersData,
	SellerOrderDetail,
	SellerOrderModeFilter,
	SellerOrdersData,
	SellerOrderView,
	SellerShipmentRequest,
	ShopperEmailKind,
	ShopperEmailPreview,
	ShopperEmailSettings,
	ShopperEmailsData,
	ShopperEmailStoresData,
	ShopperEmailTemplate,
	ShopperEmailTemplateFields,
	ShopperEmailTemplateView,
	ShopperEmailTestResult,
	StoreTranslationOverview,
	StoreTranslationPage,
	StoreTranslationRow,
	StoreTranslationRun,
	StoreTranslationSettings,
	StoreTranslationSettingsPatch,
	StoreTranslationStoreSummary,
	TaskView,
	StoreRefundRequest,
	StoreRefundResponse,
	LiveStoreView,
	PublishLiveStoreRequest,
	AddStoreDomainRequest,
	CreateDraftRequest,
	DraftsSnapshot,
	RenameDraftRequest,
	PayoutInterval,
	CatalogProductsData,
	AdminCatalogOrdersData,
	AdminCatalogOrderDetail,
	AdminCatalogOrderView,
	StripeLinkData,
	TemplateCategory,
	AuthUser,
	BillingChangeRequested,
	BillingView,
	CardSetupMode,
	CardSetupStart,
	CheckoutClientStart,
	CheckoutConsentRequest,
	CheckoutStatusView,
	CheckoutTermsView,
	CreditsRequest,
	InvoicePaymentResult,
	InvoiceView,
	PaidPlanId,
	PlanLimitRefusal,
	PlanRequest,
} from '@/api-types';
import {
	isPlanLimitRefusal,
	RateLimitExceededError,
	SecurityError,
	SecurityErrorType,
} from '@/api-types';
import { filenameOfDisposition } from './download';
import { announcePlanLimit } from './plan-limit-events';
import { msg } from './i18n';
import { oauthStartPath } from './oauth-start';
import { toast } from 'sonner';

/** An invoice's PDF, ready to save. */
export interface InvoicePdfFile {
	blob: Blob;
	filename: string;
}

/**
 * Global auth modal trigger for 401 interception
 */
let globalAuthModalTrigger: ((context?: string) => void) | null = null;

export function setGlobalAuthModalTrigger(trigger: (context?: string) => void) {
	globalAuthModalTrigger = trigger;
}

/**
 * API Client Error class with proper error context
 */
export class ApiError extends Error {
	/** The plan limit behind a 402, for the shared Upgrade dialog. */
	public planLimit: PlanLimitRefusal | null = null;

	constructor(
		public status: number,
		public statusText: string,
		message: string,
		public endpoint: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/**
 * Base API client configuration
 */
interface ApiClientConfig {
	baseUrl?: string;
	defaultHeaders?: Record<string, string>;
}

/**
 * Request options for API calls
 */
interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	headers?: Record<string, string>;
	body?: unknown;
	credentials?: RequestCredentials;
	skipJsonParsing?: boolean; // Skip JSON parsing for streaming responses
}

/**
 * Pagination parameters for paginated endpoints
 */
interface PaginationParams {
	page?: number;
	limit?: number;
	sort?: string;
	order?: 'asc' | 'desc';
}

/**
 * User apps parameters with filtering and sorting
 */
interface UserAppsParams extends PaginationParams {
	publication?: StorePublicationStatus;
	period?: 'today' | 'week' | 'month' | 'all';
	framework?: string;
	search?: string;
	visibility?: 'private' | 'public' | 'team' | 'board';
	status?: 'generating' | 'completed';
	teamId?: string;
}

/**
 * Public apps parameters with filtering and sorting
 */
interface PublicAppsParams extends PaginationParams {
	period?: 'today' | 'week' | 'month' | 'all';
	framework?: string;
	search?: string;
	boardId?: string;
	category?: TemplateCategory;
	pricing?: DiscoverPricing;
	reusableOnly?: boolean;
	/** Only stores an admin showcased on the landing page. */
	showcasedOnly?: boolean;
}

/**
 * Unified API Client class
 */
interface CSRFTokenInfo {
	token: string;
	expiresAt: number;
}

class ApiClient {
	private baseUrl: string;
	private defaultHeaders: Record<string, string>;
	private csrfTokenInfo: CSRFTokenInfo | null = null;
	private csrfTokenPromise: Promise<boolean> | null = null;

	constructor(config: ApiClientConfig = {}) {
		this.baseUrl = config.baseUrl || '';
		this.defaultHeaders = {
			'Content-Type': 'application/json',
			...config.defaultHeaders,
		};
	}

	/**
	 * Get authentication headers for API requests
	 */
	private async getAuthHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = { 'Accept-Language': getLocale() };

		// Add session token for anonymous users if not authenticated
		// This will be handled automatically by cookies/credentials for authenticated users
		const sessionToken = localStorage.getItem('anonymous_session_token');
		if (sessionToken && !document.cookie.includes('session=')) {
			headers['X-Session-Token'] = sessionToken;
		}

		// Add CSRF token for state-changing requests
		if (this.csrfTokenInfo && !this.isCSRFTokenExpired()) {
			headers['X-CSRF-Token'] = this.csrfTokenInfo.token;
		}

		// The Cloudflare OAuth token lives in an HttpOnly cookie. The browser
		// attaches it automatically on same-origin requests; there is nothing
		// for the API client to add.
		return headers;
	}

	/**
	 * Fetch CSRF token from server with expiration handling
	 */
	private async fetchCsrfToken(): Promise<boolean> {
		if (this.csrfTokenPromise) return this.csrfTokenPromise;
		this.csrfTokenPromise = this.fetchCsrfTokenUncached();
		try {
			return await this.csrfTokenPromise;
		} finally {
			this.csrfTokenPromise = null;
		}
	}

	private async fetchCsrfTokenUncached(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/api/auth/csrf-token`, {
				method: 'GET',
				headers: { 'Accept-Language': getLocale() },
				credentials: 'include',
			});

			if (response.ok) {
				const data: ApiResponse<CsrfTokenResponseData> = await response.json();
				if (data.data?.token) {
					const expiresIn = data.data.expiresIn || 7200; // Default 2 hours
					this.csrfTokenInfo = {
						token: data.data.token,
						expiresAt: Date.now() + (expiresIn * 1000)
					};
					return true;
				}
			}
			return false;
		} catch (error) {
			console.warn('Failed to fetch CSRF token:', error);
			return false;
		}
	}

	/**
	 * Public method to refresh CSRF token
	 * Should be called after authentication operations that rotate the token
	 */
	async refreshCsrfToken(): Promise<void> {
		await this.fetchCsrfToken();
	}


	/**
	 * Check if CSRF token is expired
	 */
	private isCSRFTokenExpired(): boolean {
		if (!this.csrfTokenInfo) return true;
		return Date.now() >= this.csrfTokenInfo.expiresAt;
	}

	/**
	 * Ensure CSRF token exists and is valid for state-changing requests
	 */
	private async ensureCsrfToken(method: string): Promise<boolean> {
		if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
			return true;
		}

		// Fetch new token if none exists or current one is expired
		if (!this.csrfTokenInfo || this.isCSRFTokenExpired()) {
			return await this.fetchCsrfToken();
		}

		return true;
	}

	/**
	 * Ensure session token exists for anonymous users
	 */
	private ensureSessionToken(): void {
		if (
			!localStorage.getItem('anonymous_session_token') &&
			!document.cookie.includes('session=')
		) {
			localStorage.setItem(
				'anonymous_session_token',
				crypto.randomUUID(),
			);
		}
	}

	/**
	 * Get the message that says why sign-in was asked for, from the endpoint that answered 401. The sign-in window
	 * translates it as it shows it.
	 */
	private getAuthContextForEndpoint(endpoint: string): string {
		if (endpoint.includes('/api/agent')) return msg('Sign in to create applications');
		if (endpoint.includes('/favorite')) return msg('Sign in to favorite this app');
		if (endpoint.includes('/star')) return msg('Sign in to star this app');
		// if (endpoint.includes('/fork')) return msg('Sign in to fork this app');
		// if (endpoint.includes('/apps')) return msg('Sign in to access your apps');
		if (endpoint.includes('/profile')) return msg('Sign in to access your profile');
		if (endpoint.includes('/settings')) return msg('Sign in to access settings');
		return msg('Sign in to continue');
	}

	/**
	 * Check if endpoint should trigger auth modal on 401
	 * Auth checking endpoints should not auto-trigger modals
	 */
	private shouldTriggerAuthModal(endpoint: string): boolean {
		// Don't trigger modal for auth state checking endpoints
		if (endpoint === '/api/auth/profile') return false;
		if (endpoint === '/api/auth/providers') return false;
		if (endpoint === '/api/auth/sessions') return false;

		return true;
	}

	private async request<T>(
		endpoint: string,
		options: RequestOptions = {},
        noToast: boolean = false,
	): Promise<ApiResponse<T>> {
		const { data } = await this.requestRaw<T>(endpoint, options, false, noToast);
		if (!data) {
			throw new ApiError(
				500,
				'Internal Error',
				'Unexpected null response data',
				endpoint,
			);
		}
		return data;
	}

	private async requestRaw<T>(
		endpoint: string,
		options: RequestOptions = {},
		isRetry: boolean = false,
        noToast: boolean = false,
	): Promise<{ response: Response; data: ApiResponse<T> | null }> {
		this.ensureSessionToken();

		if (!await this.ensureCsrfToken(options.method || 'GET')) {
			throw new ApiError(
				500,
				'Internal Error',
				'Failed to obtain CSRF token',
				endpoint,
			);
		}

		const url = `${this.baseUrl}${endpoint}`;
		const authHeaders = await this.getAuthHeaders();
		const config: RequestInit = {
			method: options.method || 'GET',
			headers: {
				...this.defaultHeaders,
				...authHeaders,
				...options.headers,
			},
			credentials: options.credentials || 'include',
		};

		if (options.body) {
			config.body =
				typeof options.body === 'string'
					? options.body
					: JSON.stringify(options.body);
		}

		try {
			const response = await fetch(url, config);

			// For streaming responses, skip JSON parsing if response is ok
			if (options.skipJsonParsing && response.ok) {
				return { response, data: null };
			}

			const data = await response.json() as ApiResponse<T>;

			if (!response.ok) {
                // Token refresh happens transparently on the backend via the
                // HttpOnly cookie. A 401 here means the cookie is gone or the
                // session itself is invalid - no client-side refresh to attempt.

                if (
                    response.status === 401 &&
                    globalAuthModalTrigger &&
                    this.shouldTriggerAuthModal(endpoint)
                ) {
                    const authContext = this.getAuthContextForEndpoint(endpoint);
                    globalAuthModalTrigger(authContext);
                }

                const errorData = data.error;
                if (errorData && errorData.type) {
                    if (
                        errorData.type === SecurityErrorType.CSRF_VIOLATION &&
                        response.status === 403 &&
                        !isRetry
                    ) {
                        this.csrfTokenInfo = null;
                        return this.requestRaw(endpoint, options, true, noToast);
                    }
                    if (!noToast) {
                        toast.error(errorData.message);
                    }
                    switch (errorData.type) {
                        case SecurityErrorType.CSRF_VIOLATION:
                            break;
                        case SecurityErrorType.RATE_LIMITED:
                            // Handle rate limiting
                            console.log('Rate limited', errorData);
                            throw RateLimitExceededError.fromRateLimitError(errorData as unknown as RateLimitError);
                        default:
                            // Security error
                            throw new SecurityError(errorData.type, errorData.message);
                        }
                    }

                    const apiError = new ApiError(
                        response.status,
                        response.statusText,
                        data.error?.message || data.message || 'Request failed',
                        endpoint,
                    );
                    // A plan limit opens the shared Upgrade dialog; callers can still read it from the error.
                    if (response.status === 402 && isPlanLimitRefusal(data?.error?.planLimit)) {
                        apiError.planLimit = data.error.planLimit;
                        announcePlanLimit(data.error.planLimit);
                    }
                    throw apiError;
			}

		    return { response, data };
		} catch (error) {
            console.error(error);
			if (error instanceof ApiError || error instanceof RateLimitExceededError || error instanceof SecurityError) {
				throw error;
			}
			throw new ApiError(
				0,
				'Network Error',
				error instanceof Error ? error.message : 'Unknown error',
				endpoint,
			);
		}
	}

	// ===============================
	// Platform Status API Methods
	// ===============================

	async getPlatformStatus(noToast: boolean = true): Promise<ApiResponse<PlatformStatusData>> {
		return this.request<PlatformStatusData>('/api/status', undefined, noToast);
	}

	// ===============================
	// Platform Capabilities API Methods
	// ===============================

	/**
	 * Get platform capabilities including available features
	 */
	async getCapabilities(noToast: boolean = true): Promise<ApiResponse<CapabilitiesData>> {
		return this.request<CapabilitiesData>('/api/capabilities', undefined, noToast);
	}

	/** Visitors' replay pause, and the local opt-in token; quiet, since the app works without it. */
	async getTelemetryConfig(): Promise<ApiResponse<TelemetryConfigData>> {
		return this.request<TelemetryConfigData>('/api/telemetry/config', undefined, true);
	}

	async getAnalyticsPreference(): Promise<ApiResponse<AnalyticsPreferenceData>> {
		return this.request<AnalyticsPreferenceData>('/api/user/analytics');
	}

	/** Quiet: the settings card shows its own error. */
	async setAnalyticsPreference(optedOut: boolean): Promise<ApiResponse<AnalyticsPreferenceData>> {
		return this.request<AnalyticsPreferenceData>('/api/user/analytics', { method: 'PUT', body: { optedOut } }, true);
	}

	/** Quiet: the language card and the picker report their own errors. */
	async setLocale(locale: Locale): Promise<ApiResponse<LocalePreferenceData>> {
		return this.request<LocalePreferenceData>('/api/user/locale', { method: 'PUT', body: { locale } }, true);
	}

	/** Every flag's value for the signed-in admin; quiet because non-admins get 403. */
	async getAdminFlags(): Promise<ApiResponse<AdminFlagsData>> {
		return this.request<AdminFlagsData>('/api/admin/flags', {}, true);
	}

	// ===============================
	// Apps API Methods
	// ===============================

	/**
	 * Get all apps for the current user
	 */
	async getUserApps(): Promise<ApiResponse<AppsListData>> {
		return this.request<AppsListData>('/api/apps');
	}

	/**
	 * Get recent apps (last 10)
	 */
	async getRecentApps(): Promise<ApiResponse<AppsListData>> {
		return this.request<AppsListData>('/api/apps/recent');
	}

	/**
	 * Get favorite apps
	 */
	async getFavoriteApps(): Promise<ApiResponse<AppsListData>> {
		return this.request<AppsListData>('/api/apps/favorites');
	}

	/**
	 * Get public apps feed with pagination
	 */
	async getPublicApps(
		params?: PublicAppsParams,
	): Promise<ApiResponse<PublicAppsData>> {
		const queryParams = new URLSearchParams();
		if (params?.page) queryParams.set('page', params.page.toString());
		if (params?.limit) queryParams.set('limit', params.limit.toString());
		if (params?.sort) queryParams.set('sort', params.sort);
		if (params?.order) queryParams.set('order', params.order);
		if (params?.period) queryParams.set('period', params.period);
		if (params?.framework) queryParams.set('framework', params.framework);
		if (params?.search) queryParams.set('search', params.search);
		if (params?.category) queryParams.set('category', params.category);
		if (params?.pricing && params.pricing !== 'all') queryParams.set('pricing', params.pricing);
		if (params?.reusableOnly) queryParams.set('reusableOnly', 'true');
		if (params?.showcasedOnly) queryParams.set('showcasedOnly', 'true');
		if (params?.boardId) queryParams.set('boardId', params.boardId);

		const endpoint = `/api/apps/public${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
		return this.request<PublicAppsData>(endpoint);
	}

	/**
	 * Create a new app
	 */
	async createApp(data: {
		title: string;
		description?: string;
	}): Promise<ApiResponse<CreateAppData>> {
		return this.request<CreateAppData>('/api/apps', {
			method: 'POST',
			body: data,
		});
	}

	/**
	 * Toggle favorite status of an app
	 */
	async toggleFavorite(
		appId: string,
	): Promise<ApiResponse<FavoriteToggleData>> {
		return this.request<FavoriteToggleData>(`/api/apps/${appId}/favorite`, {
			method: 'POST',
		});
	}

	/**
	 * Delete an app
	 */
	async deleteApp(appId: string): Promise<ApiResponse<AppDeleteData>> {
		return this.request<AppDeleteData>(`/api/apps/${appId}`, {
			method: 'DELETE',
		});
	}

	// ===============================
	// App View API Methods
	// ===============================

	/**
	 * Get detailed app information for viewing
	 */
	async getStoreAnalytics(appId: string, options: {days: number; mode: 'live' | 'test'}): Promise<ApiResponse<StoreTrafficAnalytics>> {
 return this.request<StoreTrafficAnalytics>(`/api/stores/${encodeURIComponent(appId)}/analytics?${new URLSearchParams({days:String(options.days),mode:options.mode})}`, {}, true);
 }

	async getAppDetails(appId: string): Promise<ApiResponse<AppDetailsData>> {
		return this.request<AppDetailsData>(`/api/apps/${appId}`);
	}

	// ===============================
	// Publishing and reuse API Methods
	// ===============================

	/** Make an app public (with consent, category and price) or private. */
	async publishSite(appId: string, body: PublishSiteRequest): Promise<ApiResponse<PublishSiteData>> {
		return this.request<PublishSiteData>(`/api/apps/${appId}/visibility`, { method: 'PUT', body });
	}

	/** Publishing settings for one of the owner's apps; quiet because non-owners get 403. */
	async getSitePublishing(appId: string): Promise<ApiResponse<SitePublishingData>> {
		return this.request<SitePublishingData>(`/api/apps/${appId}/publishing`, {}, true);
	}

	/** The free plan's daily limits; quiet because pricing hides the line on failure. */
	async getPublicPlan(): Promise<ApiResponse<PublicPlanLimits>> {
		return this.request<PublicPlanLimits>('/api/limits/plan', {}, true);
	}

	/** A Discover site's product page; quiet because the page shows its own unavailable state. */
	async getDiscoverCategories() {
		return this.request<DiscoverCategory[]>('/api/discover/catalog/categories', {}, true);
	}
	async getDiscoverCatalog(filters: DiscoverCatalogFilters) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
		return this.request<DiscoverCatalogPage>(`/api/discover/catalog?${params}`, {}, true);
	}
	async getDiscoverEntry(slug: string) {
		return this.request<DiscoverEntryDetail>(`/api/discover/catalog/${encodeURIComponent(slug)}`, {}, true);
	}
	async getDiscoverAccess(slug: string) {
		return this.request<DiscoverAccess>(`/api/discover/catalog/${encodeURIComponent(slug)}/access`, {}, true);
	}
	async createDiscoverCheckout(slug: string) {
		return this.request<DiscoverCheckout>(`/api/discover/catalog/${encodeURIComponent(slug)}/checkout`, { method: 'POST' }, true);
	}
	async confirmDiscoverCheckout(sessionId: string) {
		return this.request<DiscoverAccess>('/api/discover/catalog/checkout/confirm', { method: 'POST', body: { sessionId } }, true);
	}

	async getSitePage(appId: string): Promise<ApiResponse<SitePageData>> {
		return this.request<SitePageData>(`/api/discover/${appId}`, {}, true);
	}

	/** An AI draft of a site's page text, for its owner; quiet because the dialog shows the failure inline. */
	async draftPageCopy(appId: string): Promise<ApiResponse<PageCopyDraftData>> {
		return this.request<PageCopyDraftData>(`/api/apps/${appId}/page-copy/draft`, { method: 'POST' }, true);
	}

	async submitPaidUpdate(appId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/apps/${appId}/paid-listing/versions`, { method: 'POST' });
	}

	async withdrawPaidVersion(appId: string, versionId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/apps/${appId}/paid-listing/versions/${versionId}/withdraw`, {
			method: 'POST',
		});
	}

	/** Start Stripe Checkout for a paid site; the response carries the Checkout page URL. */
	async createSiteCheckout(appId: string): Promise<ApiResponse<SiteCheckoutData>> {
		return this.request<SiteCheckoutData>(`/api/apps/${appId}/purchases`, { method: 'POST' });
	}

	/** Record the purchase after the buyer returns from Stripe Checkout. */
	async confirmSitePurchase(appId: string, sessionId: string): Promise<ApiResponse<ConfirmPurchaseData>> {
		const body: ConfirmPurchaseRequest = { sessionId };
		return this.request<ConfirmPurchaseData>(`/api/apps/${appId}/purchases/confirm`, { method: 'POST', body });
	}

	async startStripeOnboarding(): Promise<ApiResponse<StripeLinkData>> {
		return this.request<StripeLinkData>('/api/stripe/connect/onboarding', { method: 'POST' });
	}

	async getStripeConnectStatus(): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/status');
	}

	/** How often the seller is paid; returns their refreshed status. */
	async setPayoutSchedule(choice: { interval: PayoutInterval; anchor: string }): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/payouts', { method: 'PUT', body: choice });
	}

	/** The signed-in account's plan, subscription, credits and what it may do. */
	async getBilling(): Promise<ApiResponse<BillingView>> {
		return this.request<BillingView>('/api/billing');
	}

	/** Opens an embedded checkout for Pro or Premium; the answer carries what Stripe.js starts the form with. */
	async startPlanCheckout(plan: PaidPlanId, billingInterval: BillingInterval = 'month', monthlyCredits?: number): Promise<ApiResponse<CheckoutClientStart>> {
		const body: PlanRequest = { plan, ...(monthlyCredits !== undefined ? { monthlyCredits } : {}), ...(billingInterval !== undefined ? { billingInterval } : {}) };
		return this.request<CheckoutClientStart>('/api/billing/checkout', { method: 'POST', body });
	}

	/** Opens an embedded checkout for extra credits on any plan. */
	async buyCredits(credits: number): Promise<ApiResponse<CheckoutClientStart>> {
		const body: CreditsRequest = { credits };
		return this.request<CheckoutClientStart>('/api/billing/credits', { method: 'POST', body });
	}

	/** The consent sentence, button and first payment of the seller's open subscription checkout, as Stripe has it now. */
	async getCheckoutTerms(sessionId: string): Promise<ApiResponse<CheckoutTermsView>> {
		return this.request<CheckoutTermsView>(`/api/billing/checkout/terms?${new URLSearchParams({ session_id: sessionId })}`);
	}

	/** Keeps the seller's agreement to the terms shown, before the payment is confirmed. */
	async recordCheckoutConsent(body: CheckoutConsentRequest): Promise<ApiResponse<{ recorded: true }>> {
		return this.request<{ recorded: true }>('/api/billing/checkout/consent', { method: 'POST', body });
	}

	/** Where the seller's checkout stands; once it is paid the server has recorded it. */
	async getCheckoutStatus(sessionId: string): Promise<ApiResponse<CheckoutStatusView>> {
		return this.request<CheckoutStatusView>(`/api/billing/checkout/status?${new URLSearchParams({ session_id: sessionId })}`);
	}

	/** Premium now, Pro at the renewal, or the current plan again to drop a pending move. */
	async changePlan(plan: PaidPlanId, billingInterval?: BillingInterval, monthlyCredits?: number): Promise<ApiResponse<BillingChangeRequested>> {
		const body: PlanRequest = { plan, ...(monthlyCredits !== undefined ? { monthlyCredits } : {}), ...(billingInterval !== undefined ? { billingInterval } : {}) };
		return this.request<BillingChangeRequested>('/api/billing/change-plan', { method: 'POST', body });
	}

	async cancelPlan(): Promise<ApiResponse<BillingChangeRequested>> {
		return this.request<BillingChangeRequested>('/api/billing/cancel', { method: 'POST' });
	}

	async resumePlan(): Promise<ApiResponse<BillingChangeRequested>> {
		return this.request<BillingChangeRequested>('/api/billing/resume', { method: 'POST' });
	}

	/** Opens the form for a new card; `pay` also pays the failed invoice with it once it is saved. */
	async startCardSetup(mode: CardSetupMode): Promise<ApiResponse<CardSetupStart>> {
		return this.request<CardSetupStart>('/api/billing/card', { method: 'POST', body: { mode } });
	}

	/** Makes the card the seller just saved their default, and in `pay` mode pays the failed invoice with it. */
	async completeCardSetup(sessionId: string): Promise<ApiResponse<InvoicePaymentResult>> {
		return this.request<InvoicePaymentResult>('/api/billing/card/complete', { method: 'POST', body: { sessionId } });
	}

	/** Pays the failed invoice with the card on file. */
	async payOpenInvoice(): Promise<ApiResponse<InvoicePaymentResult>> {
		return this.request<InvoicePaymentResult>('/api/billing/invoices/pay', { method: 'POST' });
	}

	/** The seller's last 24 invoices, newest first. */
	async getBillingHistory(): Promise<ApiResponse<InvoiceView[]>> {
		return this.request<InvoiceView[]>('/api/billing/history');
	}

	/**
	 * An invoice's PDF to save, named as the server names it. The server streams it, so Stripe's address never reaches the
	 * page. A refusal throws with the server's own message; quiet, since the page shows it. A failure with no message of
	 * its own, such as a gateway page, has status 0.
	 */
	async downloadInvoicePdf(invoiceId: string): Promise<InvoicePdfFile> {
		const { response } = await this.requestRaw<unknown>(`/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, { skipJsonParsing: true }, false, true);
		return { blob: await response.blob(), filename: filenameOfDisposition(response.headers.get('Content-Disposition'), `${invoiceId}.pdf`) };
	}

	/** The seller's level, store limits and this week's use. */
	async getSellerLimits(): Promise<ApiResponse<SellerLimitsData>> {
		return this.request<SellerLimitsData>('/api/stores/limits');
	}

	/** Record the seller's agreement to the current selling terms; returns their refreshed status. */
	async acceptSellerTerms(version: string): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/terms', { method: 'POST', body: { version } });
	}

	/** The signed-in seller's orders across their stores, 50 a page. */
	async getSellerOrders(filters: { view: SellerOrderView; mode: SellerOrderModeFilter; store: string | null; cursor: string | null }): Promise<ApiResponse<SellerOrdersData>> {
		const query = new URLSearchParams({ view: filters.view, mode: filters.mode });
		if (filters.store) query.set('store', filters.store);
		if (filters.cursor) query.set('cursor', filters.cursor);
		return this.request<SellerOrdersData>(`/api/orders?${query}`);
	}

	async getSellerOrder(orderId: string): Promise<ApiResponse<SellerOrderDetail>> {
		return this.request<SellerOrderDetail>(`/api/orders/${encodeURIComponent(orderId)}`);
	}

	/** Refunds lines of the seller's own order; the seller's Stripe balance pays. */
	async refundSellerOrder(orderId: string, request: StoreRefundRequest): Promise<ApiResponse<StoreRefundResponse>> {
		return this.request<StoreRefundResponse>(`/api/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', body: request });
	}

	/** Marks the order's own items shipped, with an optional carrier and tracking number, or not shipped again. */
	async setSellerOrderShipment(orderId: string, body: SellerShipmentRequest): Promise<ApiResponse<SellerOrderDetail>> {
		return this.request<SellerOrderDetail>(`/api/orders/${encodeURIComponent(orderId)}/shipment`, { method: 'POST', body });
	}

	/** The signed-in seller's stores that can email shoppers: those with a live store or an order. */
	async getShopperEmailStores(): Promise<ApiResponse<ShopperEmailStoresData>> {
		return this.request<ShopperEmailStoresData>('/api/emails/stores');
	}

	async getShopperEmails(appId: string): Promise<ApiResponse<ShopperEmailsData>> {
		return this.request<ShopperEmailsData>(`/api/stores/${encodeURIComponent(appId)}/emails`);
	}

	async saveShopperEmail(appId: string, kind: ShopperEmailKind, template: ShopperEmailTemplate): Promise<ApiResponse<ShopperEmailTemplateView>> {
		return this.request<ShopperEmailTemplateView>(`/api/stores/${encodeURIComponent(appId)}/emails/${kind}`, { method: 'PUT', body: template });
	}

	/** Forgets the store's version, so the email goes back to Estori's default. */
	async resetShopperEmail(appId: string, kind: ShopperEmailKind): Promise<ApiResponse<ShopperEmailTemplateView>> {
		return this.request<ShopperEmailTemplateView>(`/api/stores/${encodeURIComponent(appId)}/emails/${kind}`, { method: 'DELETE' });
	}

	async saveShopperEmailSettings(appId: string, settings: ShopperEmailSettings): Promise<ApiResponse<ShopperEmailSettings>> {
		return this.request<ShopperEmailSettings>(`/api/stores/${encodeURIComponent(appId)}/emails-settings`, { method: 'PUT', body: settings });
	}

	/** Renders a template, saved or not, filled in with a sample order. */
	async previewShopperEmail(appId: string, kind: ShopperEmailKind, fields: ShopperEmailTemplateFields): Promise<ApiResponse<ShopperEmailPreview>> {
		return this.request<ShopperEmailPreview>(`/api/stores/${encodeURIComponent(appId)}/emails/${kind}/preview`, { method: 'POST', body: fields });
	}

	/** Sends a template, saved or not, filled in with a sample order, to the signed-in seller. */
	async sendShopperEmailTest(appId: string, kind: ShopperEmailKind, fields: ShopperEmailTemplateFields): Promise<ApiResponse<ShopperEmailTestResult>> {
		return this.request<ShopperEmailTestResult>(`/api/stores/${encodeURIComponent(appId)}/emails/${kind}/test`, { method: 'POST', body: fields });
	}

	/** The signed-in seller's stores that have been deployed, with where each language of each stands. */
	async getTranslationStores(): Promise<ApiResponse<StoreTranslationStoreSummary[]>> {
		return this.request<StoreTranslationStoreSummary[]>('/api/translations/stores');
	}

	/** A store's translation settings and languages. Its texts are read again first when a deploy or publish is newer. */
	async getStoreTranslations(appId: string): Promise<ApiResponse<StoreTranslationOverview>> {
		return this.request<StoreTranslationOverview>(`/api/stores/${encodeURIComponent(appId)}/translations`);
	}

	async saveStoreTranslationSettings(appId: string, patch: StoreTranslationSettingsPatch): Promise<ApiResponse<StoreTranslationSettings>> {
		return this.request<StoreTranslationSettings>(`/api/stores/${encodeURIComponent(appId)}/translations/settings`, { method: 'PUT', body: patch });
	}

	/** Translates the store into a language, turning it on first. `created` is false when that language was already queued or running. */
	async runStoreTranslation(appId: string, locale: Locale): Promise<ApiResponse<StoreTranslationRun>> {
		return this.request<StoreTranslationRun>(`/api/stores/${encodeURIComponent(appId)}/translations/${locale}/run`, { method: 'POST' });
	}

	/** A page of the store's texts with their translations into a language; `query` searches both. */
	async getStoreTranslationTexts(appId: string, locale: Locale, options: { query?: string; cursor?: string } = {}): Promise<ApiResponse<StoreTranslationPage>> {
		const params = new URLSearchParams();
		if (options.query) params.set('query', options.query);
		if (options.cursor) params.set('cursor', options.cursor);
		const query = params.toString();
		return this.request<StoreTranslationPage>(`/api/stores/${encodeURIComponent(appId)}/translations/${locale}/texts${query ? `?${query}` : ''}`);
	}

	/** Saves the seller's own words for a text; no translation task overwrites them. */
	async saveStoreTranslationText(appId: string, locale: Locale, hash: string, text: string): Promise<ApiResponse<StoreTranslationRow>> {
		return this.request<StoreTranslationRow>(`/api/stores/${encodeURIComponent(appId)}/translations/${locale}/texts/${encodeURIComponent(hash)}`, { method: 'PUT', body: { text } });
	}

	/** Gives a text back its machine translation. */
	async revertStoreTranslationText(appId: string, locale: Locale, hash: string): Promise<ApiResponse<StoreTranslationRow>> {
		return this.request<StoreTranslationRow>(`/api/stores/${encodeURIComponent(appId)}/translations/${locale}/texts/${encodeURIComponent(hash)}`, { method: 'DELETE' });
	}

	/** The seller's background tasks, newest first; `appId` narrows them to one store's. */
	async getTasks(appId?: string): Promise<ApiResponse<TaskView[]>> {
		return this.request<TaskView[]>(appId ? `/api/tasks?appId=${encodeURIComponent(appId)}` : '/api/tasks');
	}

	async cancelTask(taskId: string): Promise<ApiResponse<TaskView>> {
		return this.request<TaskView>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
	}

	/** Queues a paused or failed task again where it stopped. */
	async resumeTask(taskId: string): Promise<ApiResponse<TaskView>> {
		return this.request<TaskView>(`/api/tasks/${encodeURIComponent(taskId)}/resume`, { method: 'POST' });
	}

	async getStoreOrders(appId: string): Promise<ApiResponse<StoreOrdersData>> {
		return this.request<StoreOrdersData>(`/api/stores/${encodeURIComponent(appId)}/orders`);
	}

	async getStoreProducts(appId: string): Promise<ApiResponse<StoreWorkspaceProducts>> {
		return this.request(`/api/stores/${encodeURIComponent(appId)}/products`);
	}

	/** Refund lines of a store order; the seller's Stripe balance pays it. */
	async refundStoreOrder(appId: string, orderId: string, request: StoreRefundRequest): Promise<ApiResponse<StoreRefundResponse>> {
		return this.request<StoreRefundResponse>(`/api/stores/${encodeURIComponent(appId)}/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', body: request });
	}

	/** The store's live address, published version and own domain. */
	async getLiveStore(appId: string): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live`);
	}

	/** Publishes the previewed version at the store's address. */
	async publishLiveStore(appId: string, request: PublishLiveStoreRequest): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live/publish`, { method: 'POST', body: request });
	}

	async takeLiveStoreOffline(appId: string): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live/offline`, { method: 'POST' });
	}

	async addStoreDomain(appId: string, request: AddStoreDomainRequest): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live/domain`, { method: 'POST', body: request });
	}

	async checkStoreDomain(appId: string): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live/domain/check`, { method: 'POST' });
	}

	async removeStoreDomain(appId: string): Promise<ApiResponse<LiveStoreView>> {
		return this.request<LiveStoreView>(`/api/stores/${encodeURIComponent(appId)}/live/domain`, { method: 'DELETE' });
	}

	/** The store's drafts and which one is being edited. */
	async getDrafts(appId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts`);
	}

	async createDraft(appId: string, request: CreateDraftRequest): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts`, { method: 'POST', body: request });
	}

	async activateDraft(appId: string, draftId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}/activate`, { method: 'POST' });
	}

	async renameDraft(appId: string, draftId: string, request: RenameDraftRequest): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: request });
	}

	async deleteDraft(appId: string, draftId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
	}

	async getCatalogProducts(query?: string): Promise<ApiResponse<CatalogProductsData>> {
		const search = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
		return this.request<CatalogProductsData>(`/api/catalog/products${search}`);
	}

	/** Admins: catalog orders, 50 a page, the ones that need someone unless the view is `all`. */
	async getAdminCatalogOrders(view: AdminCatalogOrderView, cursor: string | null): Promise<ApiResponse<AdminCatalogOrdersData>> {
		const query = new URLSearchParams({ view });
		if (cursor) query.set('cursor', cursor);
		return this.request<AdminCatalogOrdersData>(`/api/admin/catalog/orders?${query}`, {}, true);
	}

	async getAdminCatalogOrder(orderId: string): Promise<ApiResponse<AdminCatalogOrderDetail>> {
		return this.request<AdminCatalogOrderDetail>(`/api/admin/catalog/orders/${encodeURIComponent(orderId)}`, {}, true);
	}

	/** Asks the supplier for the order's updates now. */
	async syncCatalogOrder(orderId: string): Promise<ApiResponse<{ signalled: true }>> {
		return this.request<{ signalled: true }>(`/api/admin/catalog/orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
	}

	/** Places a stuck order again. */
	async retryCatalogOrder(orderId: string): Promise<ApiResponse<{ retried: true }>> {
		return this.request<{ retried: true }>(`/api/admin/catalog/orders/${encodeURIComponent(orderId)}/retry`, { method: 'POST' });
	}

	/** Places an order held for a risky payment, after review. */
	async releaseCatalogOrder(orderId: string): Promise<ApiResponse<{ released: boolean }>> {
		return this.request<{ released: boolean }>(`/api/admin/catalog/orders/${encodeURIComponent(orderId)}/release`, { method: 'POST' });
	}

	/** Moves a sandbox supplier order along, so the rest of the flow can be tried. */
	async moveSandboxCatalogOrder(orderId: string, action: 'ship' | 'deliver'): Promise<ApiResponse<{ moved: string[] }>> {
		return this.request<{ moved: string[] }>(`/api/admin/catalog/orders/${encodeURIComponent(orderId)}/sandbox`, { method: 'POST', body: { action } });
	}

	async getStripeDashboardLink(): Promise<ApiResponse<StripeLinkData>> {
		return this.request<StripeLinkData>('/api/stripe/connect/dashboard', { method: 'POST' });
	}

	/** Admins only; quiet because non-admins get 403. */
	async getAdminSales(): Promise<ApiResponse<AdminSalesData>> {
		return this.request<AdminSalesData>('/api/admin/sales', {}, true);
	}

	async getMyPaidListings(): Promise<ApiResponse<MyPaidListingsData>> {
		return this.request<MyPaidListingsData>('/api/paid-listings/mine');
	}

	/** Review queue; quiet because non-admins get 403 and the page explains it. */
	async getPendingReviews(): Promise<ApiResponse<PendingReviewsData>> {
		return this.request<PendingReviewsData>('/api/admin/reviews', {}, true);
	}

	async getReviewVersionFiles(versionId: string): Promise<ApiResponse<ReviewVersionFilesData>> {
		return this.request<ReviewVersionFilesData>(`/api/admin/template-versions/${versionId}/files`);
	}

	async getReviewVersionFile(versionId: string, path: string): Promise<ApiResponse<ReviewVersionFileData>> {
		return this.request<ReviewVersionFileData>(
			`/api/admin/template-versions/${versionId}/file?path=${encodeURIComponent(path)}`,
		);
	}

	async approveReviewVersion(versionId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/admin/template-versions/${versionId}/approve`, { method: 'POST' });
	}

	async rejectReviewVersion(versionId: string, reason: string): Promise<ApiResponse<PaidVersionActionData>> {
		const body: RejectVersionRequest = { reason };
		return this.request<PaidVersionActionData>(`/api/admin/template-versions/${versionId}/reject`, {
			method: 'POST',
			body,
		});
	}

	/** Admins only: hide a public site from Discover and block its reuse, or restore it. */
	async setDiscoverRemoval(appId: string, body: DiscoverRemovalRequest): Promise<ApiResponse<DiscoverRemovalData>> {
		return this.request<DiscoverRemovalData>(`/api/admin/apps/${appId}/discover`, { method: 'PUT', body });
	}

	/** Admins only: show a public Discover store on the landing page, or take it off. */
	async setShowcased(appId: string, body: ShowcaseChangeRequest): Promise<ApiResponse<ShowcaseChangeData>> {
		return this.request<ShowcaseChangeData>(`/api/admin/apps/${appId}/showcase`, { method: 'PUT', body });
	}

	/** Admins only: capture the showcase images Discover stores are still missing, one batch per call. */
	async refreshShowcaseScreenshots(): Promise<ApiResponse<ShowcaseRefreshData>> {
		return this.request<ShowcaseRefreshData>('/api/admin/showcase-screenshots/refresh', { method: 'POST' });
	}

	async getMyEarlyAccess(): Promise<ApiResponse<MyEarlyAccessData>> {
		return this.request<MyEarlyAccessData>('/api/early-access');
	}

	async requestEarlyAccess(capability: EarlyAccessCapability): Promise<ApiResponse<MyEarlyAccessData>> {
		return this.request<MyEarlyAccessData>('/api/early-access', { method: 'POST', body: { capability } });
	}

	/** Every early-access request; quiet because non-admins get 403. */
	async getAdminEarlyAccess(): Promise<ApiResponse<EarlyAccessAdminData>> {
		return this.request<EarlyAccessAdminData>('/api/admin/early-access', {}, true);
	}

	/** Sends the contact-sales form; anyone can, signed in or not. Quiet: the form shows its own errors. */
	async submitContact(body: ContactRequestBody): Promise<ApiResponse<ContactReceivedData>> {
		return this.request<ContactReceivedData>('/api/contact', { method: 'POST', body }, true);
	}

	/** The latest contact-sales requests; quiet because non-admins get 403. */
	async getAdminContactRequests(): Promise<ApiResponse<ContactAdminData>> {
		return this.request<ContactAdminData>('/api/admin/contact-requests', {}, true);
	}

	/**
	 * Toggle star status of an app (different from favorite)
	 */
	async toggleAppStar(
		appId: string,
	): Promise<ApiResponse<AppStarToggleData>> {
		return this.request<AppStarToggleData>(`/api/apps/${appId}/star`, {
			method: 'POST',
		});
	}

	/**
	 * Generate a short-lived token for git clone (private repos only)
	 */
	async generateGitCloneToken(
		appId: string,
	): Promise<ApiResponse<GitCloneTokenData>> {
		return this.request<GitCloneTokenData>(`/api/apps/${appId}/git/token`, {
			method: 'POST',
		});
	}

	/**
	 * Generate a short-lived owner-preview token so the owner can open a
	 * private deployed app's URL on a preview subdomain.
	 */
	async generatePreviewToken(
		appId: string,
	): Promise<ApiResponse<PreviewTokenData>> {
		return this.request<PreviewTokenData>(`/api/apps/${appId}/preview-token`, {
			method: 'POST',
		});
	}

	// /**
	//  * Fork an app
	//  */
    // DISABLED: Has been disabled for initial alpha release, for security reasons
	// async forkApp(appId: string): Promise<ApiResponse<ForkAppData>> {
	// 	return this.request<ForkAppData>(`/api/apps/${appId}/fork`, {
	// 		method: 'POST',
	// 	});
	// }

	// ===============================
	// User API Methods
	// ===============================

	/**
	 * Get user apps with pagination
	 */
	async getUserAppsWithPagination(
		params?: UserAppsParams,
	): Promise<ApiResponse<UserAppsData>> {
		const queryParams = new URLSearchParams();
		if (params?.page) queryParams.set('page', params.page.toString());
		if (params?.limit) queryParams.set('limit', params.limit.toString());
		if (params?.sort) queryParams.set('sort', params.sort);
		if (params?.order) queryParams.set('order', params.order);
		if (params?.period) queryParams.set('period', params.period);
		if (params?.framework) queryParams.set('framework', params.framework);
		if (params?.search) queryParams.set('search', params.search);
		if (params?.visibility)
			queryParams.set('visibility', params.visibility);
		if (params?.status) queryParams.set('status', params.status);
		if (params?.publication) queryParams.set('publication', params.publication);
		if (params?.teamId) queryParams.set('teamId', params.teamId);

		const endpoint = `/api/user/apps${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
		return this.request<UserAppsData>(endpoint);
	}

	async createAgentSession(args: CodeGenArgs): Promise<AgentStreamingResponse> {
		try {
			const { response, data } = await this.requestRaw(
				'/api/agent',
				{
					method: 'POST',
					body: args,
					skipJsonParsing: true, // Don't parse JSON for streaming response
				},
				false,
				true,
			);

			// Check if response is ok
			if (!response.ok) {
				// Check if this is a usage limit error
				if (response.status === 429 && data?.error?.errorType === 'USAGE_LIMIT_EXCEEDED') {
					// Emit custom event for usage limit exceeded
					window.dispatchEvent(new CustomEvent('usage-limit-exceeded', {
						detail: {
							message: data.error.message,
							exceededLimits: data.error.exceededLimits,
							hasUserToken: data.error.hasUserToken,
						}
					}));

					const errorMessage = data.error.message || 'Free tier limits exceeded';
					throw new Error(errorMessage);
				}

				// Parse error response if available
				const errorMessage = data?.error?.message || `Agent creation failed with status: ${response.status}`;
				throw new Error(errorMessage);
			}

			return {
				success: true,
				stream: response
			};
		} catch (error) {
			// Handle any network or parsing errors
			const errorMessage = error instanceof Error ? error.message : 'Failed to create agent session';
			// A plan limit already opened the Upgrade dialog with this message.
			if (!(error instanceof ApiError && error.planLimit)) toast.error(errorMessage);

            throw new Error(errorMessage);
		}
	}

	/**
	 * Update user profile
	 */
	async updateProfile(data: {
		displayName?: string;
		username?: string;
		bio?: string;
		timezone?: string;
		theme?: 'light' | 'dark' | 'system';
	}): Promise<ApiResponse<ProfileUpdateData>> {
		return this.request<ProfileUpdateData>('/api/user/profile', {
			method: 'PUT',
			body: data,
		});
	}

	// ===============================
	// Stats API Methods
	// ===============================

	/**
	 * Get user statistics
	 */
	async getUserStats(): Promise<ApiResponse<UserStatsData>> {
		return this.request<UserStatsData>('/api/stats');
	}

	/**
	 * Get user activity timeline
	 */
	async getUserActivity(): Promise<ApiResponse<UserActivityData>> {
		return this.request<UserActivityData>('/api/stats/activity');
	}

	// ===============================
	// Analytics API Methods
	// ===============================

	/**
	 * Get user analytics (AI Gateway costs and usage)
	 */
	async getUserAnalytics(
		userId: string,
		days?: number,
	): Promise<ApiResponse<UserAnalyticsResponseData>> {
		const queryParams = days ? `?days=${days}` : '';
		return this.request<UserAnalyticsResponseData>(
			`/api/user/${userId}/analytics${queryParams}`,
		);
	}

	/**
	 * Get agent analytics (AI Gateway costs and usage for specific app/chat)
	 */
	async getAgentAnalytics(
		agentId: string,
		days?: number,
	): Promise<ApiResponse<AgentAnalyticsResponseData>> {
		const queryParams = days ? `?days=${days}` : '';
		return this.request<AgentAnalyticsResponseData>(
			`/api/agent/${agentId}/analytics${queryParams}`,
		);
	}

	// ===============================
	// Model Config API Methods
	// ===============================

	/**
	 * Get all model configurations
	 */
	async getModelConfigs(): Promise<ApiResponse<ModelConfigsData>> {
		return this.request<ModelConfigsData>('/api/model-configs');
	}

	/**
	 * Get BYOK providers and available models
	 * @param agentAction - Optional agent action to filter models by constraints
	 */
	async getByokProviders(agentAction?: string): Promise<ApiResponse<ByokProvidersData>> {
		const endpoint = agentAction
			? `/api/model-configs/byok-providers?agentAction=${encodeURIComponent(agentAction)}`
			: '/api/model-configs/byok-providers';

		return this.request<ByokProvidersData>(endpoint);
	}

	/**
	 * Get BYOK templates for dynamic provider configuration
	 */
	async getBYOKTemplates(): Promise<ApiResponse<SecretTemplatesData>> {
		return this.request<SecretTemplatesData>(
			'/api/secrets/templates?category=byok',
		);
	}

	/**
	 * Reset model configuration to default
	 */
	async resetModelConfig(
		agentAction: string,
	): Promise<ApiResponse<ModelConfigResetData>> {
		return this.request<ModelConfigResetData>(
			`/api/model-configs/${agentAction}`,
			{
				method: 'DELETE',
			},
		);
	}

	/**
	 * Reset all model configurations to defaults
	 */
	async resetAllModelConfigs(): Promise<ApiResponse<ModelConfigResetData>> {
		return this.request<ModelConfigResetData>(
			'/api/model-configs/reset-all',
			{
				method: 'POST',
			},
		);
	}

	/**
	 * Get specific model configuration
	 */
	async getModelConfig(
		actionKey: string,
	): Promise<ApiResponse<ModelConfigData>> {
		return this.request<ModelConfigData>(`/api/model-configs/${actionKey}`);
	}

	/**
	 * Update model configuration
	 */
	async updateModelConfig(
		actionKey: string,
		config: ModelConfigUpdate,
	): Promise<ApiResponse<ModelConfigUpdateData>> {
		return this.request<ModelConfigUpdateData>(
			`/api/model-configs/${actionKey}`,
			{
				method: 'PUT',
				body: config,
			},
		);
	}

	/**
	 * Test model configuration
	 */
	async testModelConfig(
		actionKey: string,
		tempConfig?: ModelConfigUpdate,
	): Promise<ApiResponse<ModelConfigTestData>> {
		return this.request<ModelConfigTestData>('/api/model-configs/test', {
			method: 'POST',
			body: {
				agentActionName: actionKey,
				useUserKeys: true,
				...(tempConfig && { tempConfig }),
			},
		});
	}

	/**
	 * Reset all model configurations
	 */
	async resetAllConfigs(): Promise<ApiResponse<ModelConfigResetData>> {
		return this.request<ModelConfigResetData>(
			'/api/model-configs/reset-all',
			{
				method: 'POST',
			},
		);
	}

	/**
	 * Get default model configurations
	 */
	async getModelDefaults(): Promise<ApiResponse<ModelConfigDefaultsData>> {
		return this.request<ModelConfigDefaultsData>(
			'/api/model-configs/defaults',
		);
	}

	/**
	 * Delete model configuration
	 */
	async deleteModelConfig(
		actionKey: string,
	): Promise<ApiResponse<ModelConfigDeleteData>> {
		return this.request<ModelConfigDeleteData>(
			`/api/model-configs/${actionKey}`,
			{
				method: 'DELETE',
			},
		);
	}

	// ===============================
	// Model Providers API Methods
	// ===============================

	/**
	 * Get all custom model providers
	 */
	async getModelProviders(): Promise<ApiResponse<ModelProvidersListData>> {
		return this.request<ModelProvidersListData>('/api/user/providers');
	}

	/**
	 * Create a new custom model provider
	 */
	async createModelProvider(
		data: CreateProviderRequest,
	): Promise<ApiResponse<ModelProviderCreateData>> {
		return this.request<ModelProviderCreateData>('/api/user/providers', {
			method: 'POST',
			body: data,
		});
	}

	/**
	 * Update an existing model provider
	 */
	async updateModelProvider(
		providerId: string,
		data: UpdateProviderRequest,
	): Promise<ApiResponse<ModelProviderUpdateData>> {
		return this.request<ModelProviderUpdateData>(
			`/api/user/providers/${providerId}`,
			{
				method: 'PUT',
				body: data,
			},
		);
	}

	/**
	 * Delete a model provider
	 */
	async deleteModelProvider(
		providerId: string,
	): Promise<ApiResponse<ModelProviderDeleteData>> {
		return this.request<ModelProviderDeleteData>(
			`/api/user/providers/${providerId}`,
			{
				method: 'DELETE',
			},
		);
	}

	/**
	 * Test a model provider connection
	 */
	async testModelProvider(
		data: TestProviderRequest,
	): Promise<ApiResponse<ModelProviderTestData>> {
		return this.request<ModelProviderTestData>('/api/user/providers/test', {
			method: 'POST',
			body: data,
		});
	}

	// ===============================
	// Secrets API Methods
	// ===============================

	/**
	 * Get secret templates for BYOK providers
	 */
	async getSecretTemplates(): Promise<ApiResponse<SecretTemplatesData>> {
		return this.request<SecretTemplatesData>('/api/secrets/templates');
	}

	// ===============================
	// Vault API Methods
	// ===============================

	async getVaultStatus(): Promise<ApiResponse<VaultStatusResponse>> {
		return this.request<VaultStatusResponse>('/api/vault/status');
	}

	async getVaultConfig(): Promise<ApiResponse<{ config: VaultConfigResponse }>> {
		return this.request<{ config: VaultConfigResponse }>('/api/vault/config');
	}

	async setupVault(data: {
		kdfAlgorithm: 'argon2id' | 'webauthn-prf';
		kdfSalt: string;
		kdfParams?: { time: number; mem: number; parallelism: number };
		prfCredentialId?: string;
		prfSalt?: string;
		encryptedRecoveryCodes?: string;
		recoveryCodesNonce?: string;
		verificationBlob: string;
		verificationNonce: string;
	}): Promise<ApiResponse<{ success: boolean }>> {
		return this.request<{ success: boolean }>('/api/vault/setup', {
			method: 'POST',
			body: data,
		});
	}

	async resetVault(): Promise<ApiResponse<{ success: boolean }>> {
		return this.request<{ success: boolean }>('/api/vault/reset', {
			method: 'POST',
		});
	}

	/**
	 * Initiate GitHub OAuth authorization for user repository access
	 * This redirects to GitHub OAuth
	 */
	initiateGitHubOAuth(): void {
		const oauthUrl = new URL('/api/github-app/authorize', window.location.origin);
		window.location.href = oauthUrl.toString();
	}

	/**
	 * Initiate GitHub export with OAuth flow
	 * Returns authorization URL for redirect
	 */
	async initiateGitHubExport(data: {
		repositoryName: string;
		description?: string;
		isPrivate?: boolean;
		agentId: string;
	}): Promise<ApiResponse<{
		authUrl?: string;
		success?: boolean;
		repositoryUrl?: string;
		skippedOAuth?: boolean;
		alreadyExists?: boolean;
		existingRepositoryUrl?: string;
	}>> {
		return this.request('/api/github-app/export', {
			method: 'POST',
			body: data,
		});
	}

	/**
	 * Check remote repository status
	 */
	async checkRemoteStatus(data: {
		repositoryUrl: string;
		agentId: string;
	}): Promise<ApiResponse<{
		compatible: boolean;
		behindBy: number;
		aheadBy: number;
		divergedCommits: Array<{
			sha: string;
			message: string;
			author: string;
			date: string;
		}>;
	}>> {
		return this.request('/api/github-app/check-remote', {
			method: 'POST',
			body: data,
		});
	}

	// ===============================
	// Agent/CodeGen API Methods
	// ===============================
	/**
	 * Connect to existing agent
	 */
	async connectToAgent(
		agentId: string,
	): Promise<ApiResponse<AgentConnectionData>> {
		return this.request<AgentConnectionData>(
			`/api/agent/${agentId}/connect`,
		);
	}

	/**
	 * Deploy preview
	 */
	async deployPreview(
		agentId: string,
	): Promise<ApiResponse<AgentPreviewResponse>> {
		return this.request<AgentPreviewResponse>(
			`/api/agent/${agentId}/preview`,
		);
	}

	// ===============================
	// App Database (DB tab) API
	// ===============================

	/**
	 * List tables in the generated app's Durable Object SQLite storage
	 * for the current branch.
	 */
	async listAppTables(
		agentId: string,
		branch?: string,
	): Promise<ApiResponse<ListAppTablesResponse>> {
		const params = new URLSearchParams();
		if (branch) params.set('branch', branch);
		const qs = params.toString();
		return this.request<ListAppTablesResponse>(
			`/api/agent/${agentId}/db/tables${qs ? `?${qs}` : ''}`,
		);
	}

	/**
	 * List the branches of the app's workspace repo (for the Repo tab's
	 * branch selector). Read-only.
	 */
	async listAppBranches(
		agentId: string,
	): Promise<ApiResponse<ListAppBranchesResponse>> {
		return this.request<ListAppBranchesResponse>(
			`/api/agent/${agentId}/branches`,
		);
	}

	/**
	 * Read rows from a table inside the App's DO. Paginated, read-only.
	 */
	async queryAppTable(
		agentId: string,
		args: {
			table: string;
			limit?: number;
			offset?: number;
			orderBy?: string;
			orderDir?: 'asc' | 'desc';
			branch?: string;
		},
	): Promise<ApiResponse<QueryAppTableResponse>> {
		const params = new URLSearchParams();
		params.set('table', args.table);
		if (args.limit !== undefined) params.set('limit', String(args.limit));
		if (args.offset !== undefined) params.set('offset', String(args.offset));
		if (args.orderBy) params.set('orderBy', args.orderBy);
		if (args.orderDir) params.set('orderDir', args.orderDir);
		if (args.branch) params.set('branch', args.branch);
		return this.request<QueryAppTableResponse>(
			`/api/agent/${agentId}/db/query?${params.toString()}`,
		);
	}

	/**
	 * Drop every user table inside the App's Durable Object. The next
	 * request to the App recreates whatever schema its startup `CREATE
	 * TABLE IF NOT EXISTS` defines.
	 */
	async wipeAppDatabase(
		agentId: string,
		opts: { branch?: string } = {},
	): Promise<ApiResponse<WipeAppDatabaseResponse>> {
		const body: Record<string, unknown> = {};
		if (opts.branch) body.branch = opts.branch;
		return this.request<WipeAppDatabaseResponse>(
			`/api/agent/${agentId}/db/wipe`,
			{
				method: 'POST',
				body: JSON.stringify(body),
			},
		);
	}

	// ===============================
	// Session Management API Methods
	// ===============================

	/**
	 * Get active user sessions
	 */
	async getActiveSessions(): Promise<ApiResponse<ActiveSessionsData>> {
		return this.request<ActiveSessionsData>('/api/auth/sessions');
	}

	/**
	 * Revoke a specific session
	 */
	async revokeSession(
		sessionId: string,
	): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			`/api/auth/sessions/${sessionId}`,
			{
				method: 'DELETE',
			},
		);
	}

	// ===============================
	// API Keys Management Methods
	// ===============================

	/**
	 * Get user API keys
	 */
	async getApiKeys(): Promise<ApiResponse<ApiKeysData>> {
		return this.request<ApiKeysData>('/api/auth/api-keys');
	}

	/**
	 * Create a new API key
	 */
	async createApiKey(data: {
		name: string;
	}): Promise<
		ApiResponse<{
			key: string;
			keyPreview: string;
			name: string;
			message: string;
		}>
	> {
		return this.request<{
			key: string;
			keyPreview: string;
			name: string;
			message: string;
		}>('/api/auth/api-keys', {
			method: 'POST',
			body: data,
		});
	}

	/**
	 * Revoke an API key
	 */
	async revokeApiKey(
		keyId: string,
	): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			`/api/auth/api-keys/${keyId}`,
			{
				method: 'DELETE',
			},
		);
	}

	// ===============================
	// Authentication API Methods
	// ===============================

	/**
	 * Login with email and password
	 */
	async loginWithEmail(credentials: {
		email: string;
		password: string;
	}): Promise<ApiResponse<LoginResponseData>> {
		return this.request<LoginResponseData>('/api/auth/login', {
			method: 'POST',
			body: credentials,
		});
	}

	/**
	 * Register a new user
	 */
	async register(data: {
		email: string;
		password: string;
		name?: string;
		acceptedTermsVersion: string;
		/** The language the visitor was using, saved on the new account. */
		locale?: Locale;
	}): Promise<ApiResponse<RegisterResponseData>> {
		return this.request<RegisterResponseData>('/api/auth/register', {
			method: 'POST',
			body: data,
		});
	}

	/** Record the signed-in user's agreement to the current terms version. */
	async acceptTerms(version: string): Promise<ApiResponse<{ user: AuthUser }>> {
		return this.request<{ user: AuthUser }>('/api/auth/accept-terms', {
			method: 'POST',
			body: { version },
		});
	}

	// The account email calls show their errors in place, so they skip the error toast.

	/** Email a password reset link. The answer is the same whether or not the account exists. */
	async forgotPassword(email: string): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			'/api/auth/forgot-password',
			{ method: 'POST', body: { email } },
			true,
		);
	}

	/** Set a new password with the token from a reset link. */
	async resetPassword(
		token: string,
		newPassword: string,
		confirmPassword: string,
	): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			'/api/auth/reset-password',
			{ method: 'POST', body: { token, newPassword, confirmPassword } },
			true,
		);
	}

	/** Confirm an email address with the token from a confirmation link. */
	async verifyEmail(token: string): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			'/api/auth/verify-email',
			{ method: 'POST', body: { token } },
			true,
		);
	}

	/** Email the signed-in user a new confirmation link. */
	async resendVerification(): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			'/api/auth/resend-verification',
			{ method: 'POST' },
			true,
		);
	}

	/**
	 * Get CSRF token
	 */
	async getCsrfToken(): Promise<ApiResponse<CsrfTokenResponseData>> {
		return this.request<CsrfTokenResponseData>('/api/auth/csrf-token');
	}

	/**
	 * Get current user profile
	 */
	async getProfile(noToast: boolean = false): Promise<ApiResponse<ProfileResponseData>> {
		return this.request<ProfileResponseData>('/api/auth/profile', undefined, noToast);
	}

	/**
	 * Logout current user
	 */
	async logout(): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>('/api/auth/logout', {
			method: 'POST',
		});
	}

	/**
	 * Get available authentication providers
	 */
	async getAuthProviders(): Promise<ApiResponse<AuthProvidersResponseData>> {
		return this.request<AuthProvidersResponseData>('/api/auth/providers');
	}

	/**
	 * Initiate OAuth flow (redirects to provider)
	 */
	initiateOAuth(provider: OAuthProvider, redirectUrl?: string): void {
		// Redirect to OAuth provider
		window.location.href = oauthStartPath(provider, redirectUrl);
	}

	/**
	 * Get the current user's linked OAuth identities
	 */
	async getLinkedIdentities(): Promise<ApiResponse<LinkedIdentitiesData>> {
		return this.request<LinkedIdentitiesData>('/api/auth/identities');
	}

	/**
	 * Unlink an OAuth provider from the current user
	 */
	async unlinkProvider(
		provider: OAuthProvider,
	): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>(
			`/api/auth/identities/${provider}`,
			{
				method: 'DELETE',
			},
		);
	}

	/**
	 * Initiate an authenticated account-link flow (redirects to provider)
	 */
	initiateProviderLink(provider: OAuthProvider): void {
		const linkUrl = new URL(
			`/api/auth/link/${provider}`,
			window.location.origin,
		);
		window.location.href = linkUrl.toString();
	}

	// ===============================
	// Usage Limits API Methods
	// ===============================

	/**
	 * Get user's usage limits and Cloudflare credits
	 */
	async getLimitsUsage(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/limits/usage');
	}

	// ===============================
	// Cloudflare Account API Methods
	// ===============================

	/**
	 * Set user's selected Cloudflare account and gateway
	 */
	async setCloudflareSelection(accountId: string, gatewayId: string): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>('/api/cloudflare/selection', {
			method: 'PUT',
			body: { accountId, gatewayId },
		});
	}

	async connectCloudflare(returnUrl?: string): Promise<ApiResponse<CloudflareConnectResponseData>> {
		const body: CloudflareConnectRequestData = { returnUrl };
		return this.request<CloudflareConnectResponseData>('/api/cloudflare/connect', {
			method: 'POST',
			body,
		}, true);
	}

	/**
	 * Disconnect the user's Cloudflare OAuth session by clearing the HttpOnly
	 * token cookie on the server.
	 */
	async disconnectCloudflare(): Promise<ApiResponse<{ message: string }>> {
		return this.request<{ message: string }>('/api/cloudflare/connection', {
			method: 'DELETE',
		});
	}

	/**
	 * Get the user's resolved AI Gateway usage preference.
	 */
	async getAiGatewayPreference(): Promise<ApiResponse<{ enabled: boolean; isExplicit: boolean }>> {
		return this.request<{ enabled: boolean; isExplicit: boolean }>('/api/cloudflare/ai-gateway-preference');
	}

	/**
	 * Set whether the user's own AI Gateway is used for inference.
	 */
	async setAiGatewayPreference(enabled: boolean): Promise<ApiResponse<{ enabled: boolean; isExplicit: boolean }>> {
		return this.request<{ enabled: boolean; isExplicit: boolean }>('/api/cloudflare/ai-gateway-preference', {
			method: 'PUT',
			body: { enabled },
		});
	}
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing/custom instances
export { ApiClient };
