import NotFoundPage from './routes/not-found';
import LayoutPreview from './routes/layout-preview/route';
import { Navigate, type RouteObject } from 'react-router';
import { BILLING_CARD_PATH, BILLING_CARD_RETURN_PATH, BILLING_CHECKOUT_PATH, BILLING_CHECKOUT_RETURN_PATH, BILLING_PATH } from './api-types';

import App from './App';
import RootIndex, { AppShell } from './routes/root-index';
import Chat from './routes/chat/chat';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import BillingPage from './routes/settings/billing';
import BillingCheckoutPage from './routes/settings/billing-checkout';
import BillingCheckoutReturnPage from './routes/settings/billing-checkout-return';
import BillingCardPage from './routes/settings/billing-card';
import BillingCardReturnPage from './routes/settings/billing-card-return';
import AppsPage from './routes/apps';
import BuilderHome from './routes/home';
import StoreWorkspace from './routes/store-workspace';
import CatalogPage from './routes/catalog';
import AppView from './routes/app';
import DiscoverPage from './routes/discover/route';
import SitePage from './routes/discover/site';
import AdminReviewsPage from './routes/admin/reviews';
import AdminEarlyAccessPage from './routes/admin/early-access';
import AdminContactRequestsPage from './routes/admin/contact-requests';
import AdminCatalogOrdersPage from './routes/admin/catalog-orders';
import AdminCatalogOrderPage from './routes/admin/catalog-order';
import AdminFlagsPage from './routes/admin/flags';
import SellerOrdersPage from './routes/orders/orders';
import SellerOrderPage from './routes/orders/order';
import ShopperEmailsPage from './routes/emails/emails';
import TranslationsPage from './routes/translations/translations';
import { protectedPage } from './routes/protected-page';
import { PublicLayout } from './components/layout/PublicLayout';
import { TermsPage, PrivacyPage, RefundsPage, CopyrightPage } from './routes/legal';
import PricingPage from './routes/pricing';
import PricingCalculatorPage from './routes/pricing-calculator';
import ContactPage from './routes/contact';
import BlogPage from './routes/blog/BlogPage';
import BlogPostPage from './routes/blog/BlogPostPage';
import IndustriesPage from './routes/industries/IndustriesPage';
import IndustryPage from './routes/industries/IndustryPage';
import SignupPage from './routes/auth/SignupPage';
import LoginPage from './routes/auth/LoginPage';
import BrandsPage from './routes/solutions/brands';
import ResellersPage from './routes/solutions/resellers';
import DigitalPage from './routes/solutions/digital';
import SubscriptionsPage from './routes/solutions/subscriptions';
import CommunitiesPage from './routes/solutions/communities';
import CatalogFulfillmentPage from './routes/platform/catalog-fulfillment';
import PaymentsPage from './routes/platform/payments';
import StoreTranslationsPage from './routes/platform/store-translations';
import EmailMarketingPage from './routes/platform/email-marketing';
import WebAnalyticsPage from './routes/platform/web-analytics';
import SearchOptimizationPage from './routes/platform/seo';
import AgenticCommercePage from './routes/agentic-commerce';
import DevelopersPage from './routes/creators/developers';
import ContentCreatorsPage from './routes/creators/content';
import ResetPasswordPage from './routes/auth/ResetPasswordPage';
import VerifyEmailPage from './routes/auth/VerifyEmailPage';

const PublicShell = () => <PublicLayout />;

/** A child route's path from an app path: the router's child paths carry no leading slash. */
const childPath = (path: string): string => path.replace(/^\//, '');

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				Component: AppShell,
				children: [
					{ index: true, Component: RootIndex },
					{ path: 'build', Component: protectedPage(BuilderHome) },
					{ path: 'stores/:id', Component: protectedPage(StoreWorkspace) },
					{ path: 'stores/:storeId/orders/:id', Component: protectedPage(SellerOrderPage) },
					{
						path: 'chat/:chatId',
						Component: Chat,
					},
					{
						path: 'profile',
						Component: protectedPage(Profile),
					},
					{
						path: 'settings',
						Component: protectedPage(Settings),
					},
					{
						path: childPath(BILLING_PATH),
						Component: protectedPage(BillingPage),
					},
					{
						path: childPath(BILLING_CHECKOUT_PATH),
						Component: protectedPage(BillingCheckoutPage),
					},
					{
						path: childPath(BILLING_CHECKOUT_RETURN_PATH),
						Component: protectedPage(BillingCheckoutReturnPage),
					},
					{
						path: childPath(BILLING_CARD_PATH),
						Component: protectedPage(BillingCardPage),
					},
					{
						path: childPath(BILLING_CARD_RETURN_PATH),
						Component: protectedPage(BillingCardReturnPage),
					},
					{
						path: 'apps',
						Component: protectedPage(AppsPage),
					},
					{
						path: 'catalog',
						Component: protectedPage(CatalogPage),
					},
					{
						path: 'orders',
						Component: protectedPage(SellerOrdersPage),
					},
					{
						path: 'orders/:id',
						Component: protectedPage(SellerOrderPage),
					},
					{
						path: 'emails',
						Component: protectedPage(ShopperEmailsPage),
					},
					{
						path: 'translations',
						Component: protectedPage(TranslationsPage),
					},
					{
						path: 'app/:id',
						Component: AppView,
					},
					{
						path: 'discover',
						Component: DiscoverPage,
					},
					{
						path: 'discover/:appId',
						Component: SitePage,
					},
					{
						path: 'templates',
						element: <Navigate to="/discover" replace />,
					},
					{
						path: 'templates/:slug',
						element: <Navigate to="/discover" replace />,
					},
					{
						path: 'admin/templates',
						element: <Navigate to="/admin/reviews" replace />,
					},
					{
						path: 'admin/reviews',
						Component: protectedPage(AdminReviewsPage),
					},
					{
						path: 'admin/early-access',
						Component: protectedPage(AdminEarlyAccessPage),
					},
					{
						path: 'admin/contact-requests',
						Component: protectedPage(AdminContactRequestsPage),
					},
					{
						path: 'admin/catalog-orders',
						Component: protectedPage(AdminCatalogOrdersPage),
					},
					{
						path: 'admin/catalog-orders/:id',
						Component: protectedPage(AdminCatalogOrderPage),
					},
					{
						path: 'admin/flags',
						Component: protectedPage(AdminFlagsPage),
					},
				],
			},
			{ path: 'layout-preview', Component: import.meta.env.DEV ? LayoutPreview : protectedPage(LayoutPreview) },
			{ path: '*', Component: NotFoundPage },
			// Signing up and in: full pages of their own, outside the site header and footer.
			{
				path: 'signup',
				Component: SignupPage,
			},
			{
				path: 'login',
				Component: LoginPage,
			},
			{
				Component: PublicShell,
				children: [
					{
						path: 'pricing',
						Component: PricingPage,
					},
					{
						path: 'pricing/calculator',
						Component: PricingCalculatorPage,
					},
					{
						path: 'contact',
						Component: ContactPage,
					},
					{
						path: 'blog',
						Component: BlogPage,
					},
					{
						path: 'blog/:slug',
						Component: BlogPostPage,
					},
					{
						path: 'industries',
						Component: IndustriesPage,
					},
					{
						path: 'industries/:slug',
						Component: IndustryPage,
					},
					{
						path: 'solutions/brands',
						Component: BrandsPage,
					},
					{
						path: 'solutions/resellers',
						Component: ResellersPage,
					},
					{
						path: 'solutions/digital',
						Component: DigitalPage,
					},
					{
						path: 'solutions/subscriptions',
						Component: SubscriptionsPage,
					},
					{
						path: 'solutions/communities',
						Component: CommunitiesPage,
					},
					{
						path: 'platform/catalog-fulfillment',
						Component: CatalogFulfillmentPage,
					},
					{
						path: 'platform/payments',
						Component: PaymentsPage,
					},
					{
						path: 'platform/store-translations',
						Component: StoreTranslationsPage,
					},
					{
						path: 'platform/email-marketing',
						Component: EmailMarketingPage,
					},
					{
						path: 'platform/web-analytics',
						Component: WebAnalyticsPage,
					},
					{
						path: 'platform/seo',
						Component: SearchOptimizationPage,
					},
					{
						path: 'agentic-commerce',
						Component: AgenticCommercePage,
					},
					{
						path: 'creators/developers',
						Component: DevelopersPage,
					},
					{
						path: 'creators/content',
						Component: ContentCreatorsPage,
					},
					{
						path: 'terms',
						Component: TermsPage,
					},
					{
						path: 'privacy',
						Component: PrivacyPage,
					},
					{
						path: 'refunds',
						Component: RefundsPage,
					},
					{
						path: 'copyright',
						Component: CopyrightPage,
					},
					{
						path: 'reset-password',
						Component: ResetPasswordPage,
					},
					{
						path: 'verify-email',
						Component: VerifyEmailPage,
					},
				],
			},
		],
	},
] satisfies RouteObject[];

export { routes };
