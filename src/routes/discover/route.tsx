import { t } from '@/lib/i18n';
import { Loader } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import DiscoverPage from './index';
import PublicDiscoverPage from './public';
import { DiscoverDialog } from '@/components/public-site/discover/DiscoverDialog';

/** The public catalog is separate from the signed-in published-app marketplace. */
export default function DiscoverRoute() {
 const { isLoading, isAuthenticated, user } = useAuth();
 if (isLoading) return <div className="grid h-svh place-items-center" role="status" aria-label={t("Loading Discover")}><Loader /></div>;
 if (isAuthenticated && user && !user.isAnonymous) return <><DiscoverPage /><DiscoverDialog /></>;
 return <PublicDiscoverPage />;
}
