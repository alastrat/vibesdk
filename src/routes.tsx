import { Navigate, type RouteObject } from 'react-router';

import App from './App';
import RootIndex, { AppShell } from './routes/root-index';
import Chat from './routes/chat/chat';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import AppsPage from './routes/apps';
import AppView from './routes/app';
import DiscoverPage from './routes/discover';
import SitePage from './routes/discover/site';
import AdminReviewsPage from './routes/admin/reviews';
import AdminEarlyAccessPage from './routes/admin/early-access';
import { ProtectedRoute } from './routes/protected-route';
import { PublicLayout } from './components/layout/PublicLayout';
import { TermsPage, PrivacyPage, RefundsPage, CopyrightPage } from './routes/legal';
import PricingPage from './routes/pricing';
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
				],
			},
			{
				Component: PublicShell,
				children: [
					{
						path: 'pricing',
						Component: PricingPage,
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
