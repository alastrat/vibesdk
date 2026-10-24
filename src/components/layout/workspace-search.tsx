import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button, Dialog, Input, Loader } from '@cloudflare/kumo';
import { ArrowRightIcon, MagnifyingGlassIcon, StorefrontIcon, XIcon } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/auth-context';
import { useApps } from '@/hooks/use-apps';
import { useFlag } from '@/hooks/use-flag';
import { useI18n } from '@/lib/i18n';
import { storeWorkspaceLocation } from './store-workspace-location';
import { workspaceSearchItems } from './workspace-search-model';

/** Command-K and the top-bar button open the same real store and page search. */
export function WorkspaceSearch() {
	const { t } = useI18n();
	const { user } = useAuth();
	const { apps, loading, error, refetch } = useApps();
	const catalogPaused = useFlag('catalog-paused');
	const location = useLocation();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const resultsId = useId();
	const list = useRef<HTMLUListElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const store = storeWorkspaceLocation(location.pathname, location.search);
	const results = workspaceSearchItems(apps, user?.id ?? null, query, { section: store?.section, catalogPaused });

	const changeOpen = (next: boolean) => { setOpen(next); if (!next) setQuery(''); };
	useEffect(() => {
		if (!user) return;
		const onKey = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				setOpen((current) => !current);
				setQuery('');
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [user]);

	const keyInResults = (event: KeyboardEvent<HTMLUListElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const links = Array.from(list.current?.querySelectorAll('a') ?? []);
		const current = links.findIndex((link) => link === document.activeElement);
		if (current < 0) return;
		event.preventDefault();
		const next = current + (event.key === 'ArrowDown' ? 1 : -1);
		if (next < 0) input.current?.focus();
		else links[Math.min(next, links.length - 1)]?.focus();
	};

	return (
		<Dialog.Root open={open} onOpenChange={changeOpen}>
			<Dialog.Trigger render={(props) => <Button {...props} variant="secondary" size="sm" className="workspace-search-trigger" aria-label={t('Search workspace')}><MagnifyingGlassIcon size={17} /><span className="workspace-search-label">{t('Search workspace')}</span><kbd aria-hidden="true">⌘ K</kbd></Button>} />
			<Dialog size="lg" className="workspace-search-dialog max-w-[calc(100vw-2rem)] p-0">
				<div className="relative border-b border-kumo-line p-4">
					<Dialog.Title className="mb-3 pr-10 text-base font-semibold">{t('Search workspace')}</Dialog.Title>
					<Dialog.Description className="sr-only">{t('Find your stores and workspace pages.')}</Dialog.Description>
					<Input ref={input} type="search" aria-label={t('Search workspace')} aria-controls={resultsId} placeholder={t('Search stores and pages')} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full" onKeyDown={(event) => {
						if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector('a')?.focus(); }
						if (event.key === 'Enter' && results[0]) { event.preventDefault(); navigate(results[0].path); changeOpen(false); }
					}} />
					<Dialog.Close render={(props) => <Button {...props} variant="ghost" shape="square" size="sm" className="absolute right-3 top-3" aria-label={t('Close dialog')} icon={<XIcon size={18} />} />} />
				</div>
				{loading && <div className="flex items-center gap-2 px-4 pt-3 text-xs text-kumo-subtle" role="status"><Loader />{t('Loading stores')}</div>}
				{error && <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm text-kumo-subtle"><span>{t("Couldn't load your stores")}</span><Button variant="ghost" size="sm" onClick={refetch}>{t('Retry')}</Button></div>}
				<ul id={resultsId} ref={list} className="workspace-search-list" aria-label={t('Search results')} onKeyDown={keyInResults}>
					{results.map((item) => <li key={item.id}><Link className="workspace-search-result" to={item.path} onClick={() => changeOpen(false)}>{item.kind === 'store' ? <StorefrontIcon size={19} className="shrink-0" /> : <ArrowRightIcon size={19} className="shrink-0" />}<span className="min-w-0 truncate">{item.label}</span><small>{item.kind === 'store' ? t('Store workspace') : t('Workspace')}</small></Link></li>)}
				</ul>
				{!results.length && <p className="px-5 pb-5 text-sm text-kumo-subtle" role="status">{t('No matching stores or pages.')}</p>}
			</Dialog>
		</Dialog.Root>
	);
}
