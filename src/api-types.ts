/**
 * Centralized API types - imports and re-exports types from worker
 * This file serves as the single source of truth for frontend-worker API communication
 */
import { SessionResponse } from 'worker/types/auth-types';
import { AuthUser } from './api-types';
import type { SessionTelemetry } from '../shared/types/telemetry.js';

export type { SecretTemplate } from 'worker/types/secretsTemplates';
export type { StorePublicationStatus, StorePublicationSummary, StoreWorkspaceProducts, StoreWorkspaceProduct, StoreWorkspaceVariant } from '../shared/types/store-workspace';

export type { StoreLiveAnalytics, StoreTrafficAnalytics, StoreTrafficBreakdown, StoreTrafficBucket, StoreTrafficEvent } from '../shared/types/store-analytics';

// Base API Response Types
export type { ControllerResponse, ApiResponse } from 'worker/api/controllers/types';

// Database Types
export type {
  PaginationInfo,
  EnhancedAppData,
  AppWithFavoriteStatus,
  TimePeriod,
  AppSortOption,
  SortOrder,
  AppQueryOptions,
  PublicAppQueryOptions
} from 'worker/database/types';

// App-related API Types
export type { 
  AppsListData,
  PublicAppsData, 
  SingleAppData,
  FavoriteToggleData,
  CreateAppData,
  UpdateAppVisibilityData,
  AppDeleteData,
  AppWithUserAndStats
} from 'worker/api/controllers/apps/types';

export type {
  AppDetailsData,
  AppReuseView,
  AppStarToggleData,
  GeneratedCodeFile,
  GitCloneTokenData,
  PreviewTokenData,
  StartedFromView
} from 'worker/api/controllers/appView/types';

// User-related API Types
export type {
  UserAppsData,
  ProfileUpdateData,
  LocalePreferenceData,
} from 'worker/api/controllers/user/types';

// Stats API Types
export type {
  UserStatsData,
  UserActivityData
} from 'worker/api/controllers/stats/types';

// Analytics API Types
export type {
  UserAnalyticsResponseData,
  AgentAnalyticsResponseData,
} from 'worker/api/controllers/analytics/types';

export type { PlatformStatusData } from 'worker/api/controllers/status/types';

export type { CapabilitiesData } from 'worker/api/controllers/capabilities/types';

export type {
  ViewMode,
  FeatureCapabilities,
  FeatureDefinition,
  ViewDefinition,
  PlatformCapabilities,
  PlatformCapabilitiesConfig,
  ThinkModelOption,
} from 'worker/agents/core/features/types';

export type { ModelUnavailableNotice } from 'worker/agents/think/model-config';

export {
  DEFAULT_FEATURE_DEFINITIONS,
  getBehaviorTypeForProject,
} from 'worker/agents/core/features';

// Model Config API Types
export type {
  ModelConfigsData,
  ModelConfigData,
  ModelConfigUpdateData,
  ModelConfigTestData,
  ModelConfigResetData,
  ModelConfigDefaultsData,
  ModelConfigDeleteData,
  ByokProvidersData,
  UserProviderStatus,
  ModelsByProvider
} from 'worker/api/controllers/modelConfig/types';

// Model Provider API Types
export type {
  ModelProvidersListData,
  ModelProviderData,
  ModelProviderCreateData,
  ModelProviderUpdateData,
  ModelProviderDeleteData,
  ModelProviderTestData,
  CreateProviderRequest,
  UpdateProviderRequest,
  TestProviderRequest
} from 'worker/api/controllers/modelProviders/types';

// Frontend model config update interface that matches backend schema
export interface ModelConfigUpdate {
  modelName?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  reasoningEffort?: string | null;
  fallbackModel?: string | null;
  isUserOverride?: boolean;
}

// Secrets API Types
export type { SecretTemplatesData } from 'worker/api/controllers/secrets/types';

// Vault API Types
export type {
	VaultConfig,
	VaultConfigResponse,
	VaultStatusResponse,
	SetupVaultRequest,
	KdfAlgorithm,
	Argon2Params,
	SecretMetadata,
} from 'worker/services/secrets/vault-types';

// Agent/CodeGen API Types
export type {
  AgentConnectionData,
} from 'worker/api/controllers/agent/types';

// Template Types
export type {
  TemplateDetails,
} from 'worker/services/sandbox/sandboxTypes';

// WebSocket Types
export type {
  WebSocketMessage,
  WebSocketMessageData,
  CodeFixEdits,
  ModelConfigsInfoMessage,
  AgentDisplayConfig,
  ModelConfigsInfo,
  CloudflareDeploymentErrorCode,
  BuildActivity,
  BuildProgress,
  ReferenceCard,
} from 'worker/api/websocketTypes';

// Database/Schema Types commonly used in frontend
export type { 
  App,
  User,
  UserModelConfig,
  UserModelProvider
} from 'worker/database/schema';

export type {
  FavoriteToggleResult,
  UserStats,
  UserActivity,
  UserModelConfigWithMetadata,
  ModelTestResult
} from 'worker/database/types';

// Agent/Generator Types
export type {
  Blueprint as BlueprintType,
  PhasicBlueprint,
  CodeReviewOutputType,
  FileConceptType,
  FileOutputType as GeneratedFile,
} from 'worker/agents/schemas';

export type {
  AgentState,
  PhasicState
} from 'worker/agents/core/state';

export type {
  BehaviorType,
  ProjectType
} from 'worker/agents/core/types';
export { isAgenticLikeBehavior } from 'worker/agents/core/types';

export type {
  ConversationMessage,
} from 'worker/agents/inferutils/common';

export type { 
  RuntimeError,
  StaticAnalysisResponse 
} from 'worker/services/sandbox/sandboxTypes';

// Config/Inference Types
export type { 
  AgentActionKey,
  AgentConfig,
  ModelConfig,
  ReasoningEffortType as ReasoningEffort,
  ProviderOverrideType as ProviderOverride
} from 'worker/agents/inferutils/config.types';

export type { RateLimitError } from "worker/services/rate-limit/errors";
export type { AgentPreviewResponse, CodeGenArgs } from 'worker/api/controllers/agent/types';
export { MAX_AGENT_QUERY_LENGTH } from 'worker/api/controllers/agent/types';

// App Database (DB tab) types
export type {
  AppDatabaseColumn,
  AppDatabaseTable,
  AppDatabaseReadResult,
  ListAppTablesResponse,
  QueryAppTableResponse,
  WipeAppDatabaseResponse,
} from 'worker/api/controllers/appDatabase/types';
export type {
  CreateDraftRequest,
  RenameDraftRequest,
  DraftStart,
  DraftSummary,
  DraftsSnapshot,
} from 'worker/api/controllers/drafts/types';
export { MAIN_DRAFT_ID, DRAFT_NAME_MAX_LENGTH, DRAFT_LIMIT, STORE_DRAFTS_PAUSED_MESSAGE } from '../shared/types/drafts.js';
export type {
	PaidPlanId,
	PlanAccount,
	PlanAccountInput,
	PlanId,
	PlanLimitKey,
	PlanLimitOverrides,
	PlanLimitRefusal,
	PlanLimits,
} from '../shared/types/plans.js';
export {
	EXTRA_CREDITS,
	GRACE_PERIOD_DAYS,
	LEGACY_CREDIT_FACTOR,
	PAID_PLAN_IDS,
	PLAN_IDS,
	PLAN_LIMIT_CODE,
	PLAN_LIMITS,
	PLAN_PRICES_CENTS,
	PLAN_YEARLY_PRICES_CENTS,
	YEARLY_DISCOUNT_PERCENT,
	BILLING_INTERVALS,
	isBillingInterval,
	planPriceCents,
	isPlanCreditAmount,
	planCreditOptions,
	creditsForPlanChange,
	planChangeStartsNow,
	type BillingInterval,
	assertWithinLimit,
	extraCreditsPriceCents,
	extraCreditsPriceLabel,
	formatBillingDate,
	formatCredits,
	formatUsd,
	isExtraCreditsAmount,
	isPaidPlanId,
	isPlanLimitRefusal,
	limitFeatures,
	limitsFor,
	planLimitOverridesFrom,
	planName,
	storeAllowance,
} from '../shared/types/plans.js';
export type {
	BillingChangeRequested,
	BillingCreditsView,
	BillingSource,
	BillingView,
	CardOnFile,
	CardSetupMode,
	CardSetupStart,
	CheckoutClientStart,
	CheckoutConsentRequest,
	CheckoutOrder,
	CheckoutSessionState,
	CheckoutStatusView,
	CheckoutTermsView,
	CreditsRequest,
	InvoicePaymentResult,
	InvoiceView,
	PlanRequest,
	PromotionTerms,
	PurchaseView,
	SubscriptionStatus,
} from '../shared/types/billing.js';
export {
	BILLING_CARD_PATH,
	BILLING_CARD_RETURN_PATH,
	BILLING_CHECKOUT_PATH,
	BILLING_CHECKOUT_RETURN_PATH,
	BILLING_HISTORY_LIMIT,
	BILLING_NOT_OPEN_MESSAGE,
	BILLING_PATH,
	CHECKOUT_EXPIRED_MESSAGE,
	EXTRA_CREDITS_DISCLOSURE,
	PAYMENTS_NOT_SET_UP_MESSAGE,
	PLAN_LIMIT_ERROR_CODE,
} from '../shared/types/billing.js';
export type { ListAppBranchesResponse } from 'worker/api/controllers/artifacts/types';
export type { RateLimitErrorResponse } from 'worker/api/responses';
export { RateLimitExceededError, SecurityError, SecurityErrorType } from '../shared/types/errors.js';
export type { StoreOrdersData, StoreOrderSummary, CatalogItemProgress, StoreRefundRequest, StoreRefundResponse, PayoutInterval } from '../shared/types/store-payments';
export type {
	SellerCarrier,
	SellerOrderDetail,
	SellerOrderLine,
	SellerOrderModeFilter,
	SellerOrderRow,
	SellerOrdersData,
	SellerOrderView,
	SellerShipmentRequest,
	StorePaymentStatus,
} from '../shared/types/store-payments';
export { SELLER_CARRIER_NAMES, SELLER_CARRIERS, SELLER_ORDERS_PATH, sellerOrderPath } from '../shared/types/store-payments';
export type {
	RecentShopperEmail,
	ShopperEmailKind,
	ShopperEmailPreview,
	ShopperEmailSettings,
	ShopperEmailsData,
	ShopperEmailStatus,
	ShopperEmailStoreOption,
	ShopperEmailStoresData,
	ShopperEmailTemplate,
	ShopperEmailTemplateFields,
	ShopperEmailTemplateView,
	ShopperEmailTestResult,
} from '../shared/types/shopper-emails';
export { DEFAULT_SHOPPER_EMAIL_TEMPLATES, SHOPPER_EMAIL_KINDS, SHOPPER_EMAIL_LABELS, SHOPPER_EMAIL_LIMITS, SHOPPER_EMAIL_STATUSES, SHOPPER_EMAILS_PATH } from '../shared/types/shopper-emails';
export type { TaskKind, TaskPauseReason, TaskProgressView, TaskStatus, TaskView, TaskViewPayloads } from '../shared/types/tasks';
export { TASK_FAILED_MESSAGE, TASK_KINDS, TASK_STATUSES, UNFINISHED_TASK_STATUSES, isUnfinishedStatus } from '../shared/types/tasks';
export type {
	StoreLanguageStatus,
	StoreText,
	StoreTranslationOrigin,
	StoreTranslationOverview,
	StoreTranslationPage,
	StoreTranslationRow,
	StoreTranslationRun,
	StoreTranslationSettings,
	StoreTranslationSettingsPatch,
	StoreTranslationStoreSummary,
	StoreTranslationTextRequest,
} from '../shared/types/store-translations';
export { MAX_TEXT_CHARS, STORE_TRANSLATION_ORIGINS, STORE_TRANSLATION_PAGE_SIZE, STORE_TRANSLATIONS_PATH, UNTOUCHED_SETTINGS_VERSION } from '../shared/types/store-translations';
export type { CatalogProductsData, CatalogProductView, CatalogVariantView } from '../shared/types/catalog';
export type {
	AdminCatalogOrderDetail,
	AdminCatalogOrderItem,
	AdminCatalogOrderRow,
	AdminCatalogOrderRunner,
	AdminCatalogOrdersData,
	AdminCatalogOrderView,
	CatalogItemStatus,
	CatalogOrderStatus,
	ShippingAddress,
} from '../shared/types/catalog';
export { ADMIN_CATALOG_ORDERS_PATH, CATALOG_PAUSED_MESSAGE } from '../shared/types/catalog';

export type {
	AdminSalesData,
	ConfirmPurchaseData,
	ConfirmPurchaseRequest,
	DiscoverRemovalData,
	DiscoverRemovalRequest,
	ShowcaseChangeData,
	ShowcaseChangeRequest,
	MyPaidListing,
	MyPaidListingsData,
	OwnerPaidListing,
	PaidListingVersionView,
	PaidVersionActionData,
	PendingReview,
	PendingReviewsData,
	PublishSiteData,
	PublishSiteRequest,
	RejectVersionRequest,
	ReviewVersionFileData,
	ReviewVersionFilesData,
	SaleView,
	ShowcaseRefreshData,
	SiteCheckoutData,
	SitePublishingData,
} from 'worker/api/controllers/publishing/types';
export type { StripeConnectStatusData, StripeLinkData } from 'worker/api/controllers/payments/types';
export type {
	DiscoverPricing,
	TemplateCategory,
	TemplateListingStatus,
	TemplateVersionStatus,
} from '../shared/types/templates.js';
export {
	DISCOVER_PRICING_FILTERS,
	PLATFORM_FEE_LABEL,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	formatTemplatePrice,
	platformFeeCents,
} from '../shared/types/templates.js';
export { EARLY_ACCESS_CAPABILITIES, isEarlyAccessCapability } from '../shared/types/early-access.js';
export type { EarlyAccessCapability } from '../shared/types/early-access.js';
export {
	LEGAL_CONTACT,
	LEGAL_ENTITY,
	TERMS_OUTDATED_MESSAGE,
	TERMS_REQUIRED_MESSAGE,
	TERMS_VERSION,
	isCurrentTermsVersion,
	legalAddressLine,
} from '../shared/types/legal.js';
export type { SellerReadiness, SellerSetupStep } from '../shared/types/seller-setup.js';
export { SELLER_SETUP_MESSAGES, SELLER_SETUP_PATH, SELLER_TERMS_VERSION, sellerSetupStep } from '../shared/types/seller-setup.js';
export type { SellerAccountCosts, SellerLevel, SellerLimitsData } from '../shared/types/seller-levels.js';
export { COMPLETED_ORDER_MIN_AGE_DAYS, DEFAULT_SELLER_LIMITS } from '../shared/types/seller-levels.js';
export type { AddStoreDomainRequest, LiveStoreView, PublishLiveStoreRequest, StoreDomainRecord, StoreDomainView } from '../shared/types/live-stores.js';
export { SLUG_MAX_LENGTH, recordHost, slugProblem } from '../shared/types/live-stores.js';
export {
	CONFIRM_LINK_INVALID_MESSAGE,
	FORGOT_PASSWORD_MESSAGE,
	RESET_LINK_INVALID_MESSAGE,
	RESET_PASSWORD_PATH,
	VERIFY_EMAIL_PATH,
} from '../shared/types/account-email.js';
export type {
	PageCopyValidation,
	SitePageCopy,
	SitePageField,
	SitePageInclude,
} from '../shared/types/site-page.js';
export {
	PAGE_DRAFT_FAILED_MESSAGE,
	SITE_PAGE_LIMITS,
	SITE_PAGE_UNAVAILABLE_MESSAGE,
	validatePageCopy,
} from '../shared/types/site-page.js';

export type { AIModels } from 'worker/agents/inferutils/config.types';
// Model selection types
export type ModelSelectionMode = 'platform' | 'byok' | 'custom';

// Match chat FileType interface
export interface FileType {
	filePath: string;
	fileContents: string;
	explanation?: string;
	isGenerating?: boolean;
	needsFixing?: boolean;
	hasErrors?: boolean;
	language?: string;
}

// Streaming response wrapper types for agent session creation
export interface StreamingResponse {
  success: boolean;
  stream: Response;
}

export type AgentStreamingResponse = StreamingResponse;

export {
	type ImageAttachment, 
	isSupportedImageType, 
	MAX_IMAGE_SIZE_BYTES,
	MAX_IMAGES_PER_MESSAGE,
	SUPPORTED_IMAGE_MIME_TYPES
} from 'worker/types/image-attachment';

// Auth types imported from worker
export type { 
  AuthSession, 
  ApiKeyInfo, 
  AuthResult, 
  AuthUser,
  OAuthProvider 
} from 'worker/types/auth-types';
export type { 
  SessionResponse 
} from 'worker/types/auth-types';

// Auth API Response Types (using existing worker types)
export type LoginResponseData = SessionResponse;

export type RegisterResponseData = SessionResponse & {
  requiresVerification?: boolean;
};

export type ProfileResponseData = {
  user: AuthUser;
  sessionId: string;
  telemetry: SessionTelemetry;
};

export interface AuthProvidersResponseData {
  providers: {
    google: boolean;
    github: boolean;
    cloudflare: boolean;
    email: boolean;
    /** Whether the server can send account emails such as reset and confirmation links. */
    emailSending: boolean;
  };
  hasOAuth: boolean;
  requiresEmailAuth: boolean;
  csrfToken?: string;
  csrfExpiresIn?: number;
}

export interface CsrfTokenResponseData {
  token: string;
  headerName: string;
  expiresIn?: number;
}

export interface CloudflareConnectRequestData {
  returnUrl?: string;
}

export interface CloudflareConnectResponseData {
  authUrl: string;
}

// Active Sessions Response - matches getUserSessions + isCurrent from controller
export interface ActiveSessionsData {
  sessions: Array<{
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    lastActivity: Date;
    createdAt: Date;
    isCurrent: boolean;
  }>;
}

// Linked OAuth Identities Response - matches getLinkedIdentities controller format
export interface LinkedIdentitiesData {
  identities: Array<{
    provider: string;
    email: string | null;
    emailVerified: boolean;
    createdAt: Date | null;
  }>;
}

// API Keys Response - matches controller response format
export interface ApiKeysData {
  keys: Array<{
    id: string;
    name: string;
    keyPreview: string;
    createdAt: Date | null;
    lastUsed: Date | null;
    isActive: boolean;
  }>;
}

export type {
    GitHubExportOptions,
    GitHubExportResult,
} from 'worker/services/github/types';

export type {
    PageCopyDraftData,
    SitePageCard,
    SitePageData,
    SitePageOffer,
} from 'worker/api/controllers/sitePage/types';

export type {
    EarlyAccessAdminData,
    EarlyAccessAdminRequest,
    MyEarlyAccessData,
} from 'worker/api/controllers/earlyAccess/types';
export type { ContactAdminData, ContactAdminRequest, ContactReceivedData } from 'worker/api/controllers/contact/types';
export {
	COMPANY_SIZES,
	CONTACT_FAILED_MESSAGE,
	CONTACT_LIMITED_MESSAGE,
	CONTACT_FIELD_LIMITS,
	CONTACT_TOPICS,
	contactTopicLabel,
	isCompanySize,
	isContactTopic,
	isPremiumCredits,
} from '../shared/types/contact.js';
export type { CompanySize, ContactRequestBody, ContactTopic } from '../shared/types/contact.js';
export type { PublicPlanLimits } from '../shared/types/plan.js';
export type { AmountBand, PersonProperties, ServerEventName, ServerEventProperties } from '../shared/types/analytics-events.js';
export type { ClientFlagKey, ClientFlagValues, FlagKey, FlagKind, FlagValues } from '../shared/types/feature-flags.js';
export { FEATURE_FLAGS, FLAG_KEYS } from '../shared/types/feature-flags.js';
export * from '../shared/types/pauses';
export type {
	AdminFlagRow,
	AdminFlagsData,
	AnalyticsOptOutSource,
	AnalyticsPreferenceData,
	SessionTelemetry,
	TelemetryConfigData,
} from '../shared/types/telemetry.js';
export { GPC_ANALYTICS_MESSAGE } from '../shared/types/telemetry.js';
export type { Locale } from '../shared/i18n/locales.js';
export { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale, negotiateLocale } from '../shared/i18n/locales.js';

export type { DiscoverKind, DiscoverTier, DiscoverCategory, DiscoverEntry, DiscoverCatalogFilters, DiscoverCatalogPage, DiscoverEntryDetail, DiscoverAccess, DiscoverCheckout } from '../shared/types/discover-catalog';
