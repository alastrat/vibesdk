import { Navigate, type RouteObject } from 'react-router';

import App from './App';
import RootIndex, { AppShell } from './routes/root-index';
import Chat from './routes/chat/chat';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import AppsPage from './routes/apps';
import CatalogPage from './routes/catalog';
import AppView from './routes/app';
import DiscoverPage from './routes/discover';
import SitePage from './routes/discover/site';
import AdminReviewsPage from './routes/admin/reviews';
import AdminEarlyAccessPage from './routes/admin/early-access';
import AdminContactRequestsPage from './routes/admin/contact-requests';
import AdminCatalogOrdersPage from './routes/admin/catalog-orders';
import AdminCatalogOrderPage from './routes/admin/catalog-order';
import SellerOrdersPage from './routes/orders/orders';
import SellerOrderPage from './routes/orders/order';
import { ProtectedRoute } from './routes/protected-route';
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
import EmailMarketingPage from './routes/platform/email-marketing';
import WebAnalyticsPage from './routes/platform/web-analytics';
import SearchOptimizationPage from './routes/platform/seo';
import AgenticCommercePage from './routes/agentic-commerce';
import DevelopersPage from './routes/creators/developers';
import ContentCreatorsPage from './routes/creators/content';
import ResetPasswordPage from './routes/auth/ResetPasswordPage';
import VerifyEmailPage from './routes/auth/VerifyEmailPage';

const PublicShell = () => <PublicLayout />;

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				Component: AppShell,
				children: [
					{ index: true, Component: RootIndex },
					{
						path: 'chat/:chatId',
						Component: Chat,
					},
					{
						path: 'profile',
						element: (
							<ProtectedRoute>
								<Profile />
							</ProtectedRoute>
						),
					},
					{
						path: 'settings',
						element: (
							<ProtectedRoute>
								<Settings />
							</ProtectedRoute>
						),
					},
					{
						path: 'apps',
						element: (
							<ProtectedRoute>
								<AppsPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'catalog',
						element: (
							<ProtectedRoute>
								<CatalogPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'orders',
						element: (
							<ProtectedRoute>
								<SellerOrdersPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'orders/:id',
						element: (
							<ProtectedRoute>
								<SellerOrderPage />
							</ProtectedRoute>
						),
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
						element: (
							<ProtectedRoute>
								<AdminReviewsPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'admin/early-access',
						element: (
							<ProtectedRoute>
								<AdminEarlyAccessPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'admin/contact-requests',
						element: (
							<ProtectedRoute>
								<AdminContactRequestsPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'admin/catalog-orders',
						element: (
							<ProtectedRoute>
								<AdminCatalogOrdersPage />
							</ProtectedRoute>
						),
					},
					{
						path: 'admin/catalog-orders/:id',
						element: (
							<ProtectedRoute>
								<AdminCatalogOrderPage />
							</ProtectedRoute>
						),
					},
				],
			},
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
