import { Navigate, type RouteObject } from 'react-router';

import App from './App';
import Home from './routes/home';
import Chat from './routes/chat/chat';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import AppsPage from './routes/apps';
import AppView from './routes/app';
import DiscoverPage from './routes/discover';
import SitePage from './routes/discover/site';
import AdminReviewsPage from './routes/admin/reviews';
import { ProtectedRoute } from './routes/protected-route';
import { AppLayout } from './components/layout/app-layout';
import { PublicLayout } from './components/layout/PublicLayout';
import { TermsPage, PrivacyPage, RefundsPage, CopyrightPage } from './routes/legal';

const AppShell = () => <AppLayout />;
const PublicShell = () => <PublicLayout />;

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				index: true,
				element: (
					<AppLayout>
						<Home />
					</AppLayout>
				),
			},
			{
				Component: AppShell,
				children: [
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
				],
			},
			{
				Component: PublicShell,
				children: [
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
				],
			},
		],
	},
] satisfies RouteObject[];

export { routes };
