import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, Empty, Loader } from '@cloudflare/kumo';
import { ArrowRightIcon, StorefrontIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { useI18n } from '@/lib/i18n';

type StoreToolLauncherProps = {
	title: string;
	description: string;
	section: 'emails' | 'translations';
	stores: readonly { appId: string; title: string }[] | undefined;
	loading: boolean;
	error: Error | null;
	retrying: boolean;
	onRetry: () => void;
	emptyTitle: string;
	emptyDescription: string;
	notice?: ReactNode;
};

/** Legacy links lead to an explicit store choice; they never load a store's private tools themselves. */
export function StoreToolLauncher({ title, description, section, stores, loading, error, retrying, onRetry, emptyTitle, emptyDescription, notice }: StoreToolLauncherProps) {
	const { t } = useI18n();
	return (
		<div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6">
			<title>{pageTitle(title)}</title>
			<header className="grid gap-2">
				<h1 className="text-2xl font-semibold tracking-tight text-kumo-strong">{title}</h1>
				<p className="text-sm text-kumo-subtle">{description}</p>
			</header>
			{notice ?? (stores ? (
				stores.length ? (
					<ul className="divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
						{stores.map((store) => (
							<li key={store.appId}>
								<Link className="flex items-center gap-3 p-4 text-sm text-kumo-strong transition-colors hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-ring" to={`/stores/${encodeURIComponent(store.appId)}?section=${section}`}>
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-kumo-tint"><StorefrontIcon size={20} /></span>
									<span className="min-w-0 flex-1 truncate font-medium">{store.title.trim() || t('Untitled store')}</span>
									<ArrowRightIcon size={18} aria-hidden="true" />
								</Link>
							</li>
						))}
					</ul>
				) : <Empty title={emptyTitle} description={emptyDescription} contents={<Link className="text-sm underline underline-offset-4" to="/apps">{t('All stores')}</Link>} />
			) : loading ? (
				<div className="flex justify-center py-16"><Loader /></div>
			) : (
				<Empty title={t("Couldn't load your stores")} description={error?.message} contents={<Button size="sm" variant="secondary" loading={retrying} disabled={retrying} onClick={onRetry}>{t('Retry')}</Button>} />
			))}
		</div>
	);
}
