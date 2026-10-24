import { useState } from 'react';
import { Outlet } from 'react-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from './contexts/auth-context';
import { AuthModalProvider } from './components/auth/AuthModalProvider';
import { TermsGate } from './components/auth/TermsGate';
import { UpgradeDialogHost } from './components/billing/UpgradeDialog';
import { ThemeProvider } from './contexts/theme-context';
import { LimitsProvider } from './contexts/limits-context';
import { Toaster } from './components/ui/sonner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FeatureProvider } from './features';
import { Toasty } from '@cloudflare/kumo';
import { createQueryClient, queryPersistOptions } from './lib/query-client';
import { useAppsQuerySync } from './hooks/use-apps';
import { AppLinkProvider } from './components/providers/app-link-provider';
import { AccountSettingsProvider } from './components/account-settings';
import { PostHogSync } from './components/analytics/PostHogSync';

function AppsQuerySync() {
	useAppsQuerySync();
	return null;
}

export default function App() {
	const [queryClient] = useState(createQueryClient);

	return (
		<ErrorBoundary>
			<PersistQueryClientProvider
				client={queryClient}
				persistOptions={queryPersistOptions}
			>
				<ThemeProvider>
					<FeatureProvider>
						<AuthProvider>
							<AppsQuerySync />
							<PostHogSync />
							<LimitsProvider>
								<AuthModalProvider>
									<Toasty>
										<AppLinkProvider>
											<AccountSettingsProvider>
												<Outlet />
											</AccountSettingsProvider>
										</AppLinkProvider>
									</Toasty>
									<Toaster richColors position="top-right" />
									<TermsGate />
									<UpgradeDialogHost />
								</AuthModalProvider>
							</LimitsProvider>
						</AuthProvider>
					</FeatureProvider>
				</ThemeProvider>
			</PersistQueryClientProvider>
		</ErrorBoundary>
	);
}
