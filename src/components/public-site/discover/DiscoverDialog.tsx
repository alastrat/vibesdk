import { t, msg } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@cloudflare/kumo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, PauseIcon, PlayIcon, XIcon } from '@phosphor-icons/react';
import { useReducedMotion } from 'framer-motion';
import type { DiscoverEntry } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useDiscoverCategories, useDiscoverCatalog, useDiscoverEntry } from '@/hooks/use-public-discover';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { DiscoverCard } from './DiscoverCard';
import { discoverPrice } from './catalog-utils';
import './discover.css';

function CatalogAction({ entry, onLogin }: { entry: DiscoverEntry; onLogin: () => void }) {
 const { user, isAuthenticated } = useAuth();
 const signedIn = !!(isAuthenticated && user && !user.isAnonymous);
 const queryClient = useQueryClient();
 const [params, setParams] = useSearchParams();
 const sessionId = params.get('session_id');
 const attempted = useRef('');
 const access = useQuery({ queryKey: queryKeys.discoverCatalog.access(entry.slug, user?.id ?? 'anonymous'), queryFn: () => unwrap(apiClient.getDiscoverAccess(entry.slug), t('Could not check your access.')), enabled: signedIn, retry: false });
 const checkout = useMutation({ mutationFn: () => unwrap(apiClient.createDiscoverCheckout(entry.slug), t('Could not start checkout.')), onSuccess: (data) => window.location.assign(data.url) });
 const confirmation = useMutation({ mutationFn: (id: string) => unwrap(apiClient.confirmDiscoverCheckout(id), t('Could not verify payment.')), onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.discoverCatalog.access(entry.slug, user?.id ?? 'anonymous') });
  setParams((current) => { const next = new URLSearchParams(current); next.delete('session_id'); return next; }, { replace: true });
 } });
 const confirm = confirmation.mutate;
 useEffect(() => {
  if (!sessionId || !signedIn || attempted.current === sessionId) return;
  attempted.current = sessionId;
  confirm(sessionId);
 }, [sessionId, signedIn, confirm]);
 const error = checkout.error ?? confirmation.error ?? access.error;
 return <div className="discover-purchase">
  <div className="discover-purchase-price">{discoverPrice(entry)} <span>{t(entry.tier === 'premium' ? 'one-time purchase' : 'source included')}</span></div>
  {confirmation.isPending ? <p role="status">{t("Verifying your payment…")}</p> : !signedIn ? <button className="discover-primary" onClick={onLogin}>{t(entry.tier === 'premium' ? 'Sign in to purchase' : 'Sign in to download')}<ArrowRightIcon /></button> : access.isPending ? <p role="status">{t("Checking access…")}</p> : access.data?.canDownload ? <a className="discover-primary" href={`/api/discover/catalog/${encodeURIComponent(entry.slug)}/download`}>{t("Download source")}<ArrowDownIcon /></a> : access.data?.checkoutEnabled ? <button className="discover-primary" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? t('Opening checkout…') : t('Get {title}', { title: entry.title })}<ArrowRightIcon /></button> : !access.isError ? <p className="discover-notice">{t("Purchases are unavailable in this environment. You can explore the full preview.")}</p> : null}
  {error && <p role="alert" className="discover-error">{t(error.message)} {confirmation.isError && sessionId && <button onClick={() => confirmation.mutate(sessionId)}>{t("Try again")}</button>}{access.isError && <button onClick={() => void access.refetch()}>{t("Try again")}</button>}</p>}
  <p className="discover-small">{t("Includes source files and setup instructions.")} {entry.kind === 'store' ? t('Connect your own commerce backend when you launch.') : t('Make it your own with the included HTML, CSS and JavaScript.')}</p>
 </div>;
}

function DetailPreview({ entry }: { entry: DiscoverEntry }) {
 const frame = useRef<HTMLIFrameElement>(null);
 const reduced = useReducedMotion();
 const [paused, setPaused] = useState(false);
 const [hidden, setHidden] = useState(false);
 const stopped = paused || !!reduced || hidden;
 useEffect(() => { const update = () => setHidden(document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
 useEffect(() => { frame.current?.contentWindow?.postMessage({ type: 'discover-motion', paused: stopped }, '*'); }, [stopped]);
 return <div className="discover-detail-preview">
  <div className="discover-preview-toolbar"><span><i /><i /><i /></span><span>{t("Interactive preview")}</span><button aria-label={t(stopped ? 'Play preview motion' : 'Pause preview motion')} aria-pressed={!stopped} disabled={!!reduced} onClick={() => setPaused(!paused)}>{stopped ? <PlayIcon /> : <PauseIcon />}</button></div>
  <iframe key={entry.slug} ref={frame} title={t('{title} interactive preview', { title: entry.title })} src={entry.previewUrl} sandbox="allow-scripts" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'discover-motion', paused: stopped }, '*')} />
 </div>;
}

/** URL-driven dialog also handles purchase continuation over the signed-in gallery. */
export function DiscoverDialog() {
 const [params, setParams] = useSearchParams();
 const slug = params.get('item');
 const topic = params.get('topic');
 const isOpen = !!(slug || topic);
 const detail = useDiscoverEntry(slug);
 const categories = useDiscoverCategories();
 const topicItems = useDiscoverCatalog({ category: topic ?? '', limit: 48 }, !!topic && !slug);
 const category = categories.data?.find((value) => value.slug === topic);
 const { requireAuth } = useAuthGuard();
 const focusOrigin = useRef<HTMLElement | null>(null);
 useEffect(() => {
  if (!isOpen) return;
  focusOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return () => { const origin = focusOrigin.current; if (origin?.isConnected) requestAnimationFrame(() => origin.focus()); };
 }, [isOpen]);
 const close = () => setParams((current) => { const next = new URLSearchParams(current); next.delete('item'); next.delete('topic'); next.delete('session_id'); return next; }, { replace: true });
 const openEntry = (entry: DiscoverEntry) => setParams((current) => { const next = new URLSearchParams(current); next.set('item', entry.slug); next.delete('topic'); return next; });
 const entry = detail.data?.entry;
 return <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
  <Dialog className="public-site discover-dialog" size="xl">
   <div className="discover-dialog-top"><span>{t("ESTORI DISCOVER")} <span>/ {t(slug ? 'THE DETAILS' : 'EXPLORE A TOPIC')}</span></span><Dialog.Close aria-label={t("Close details")} className="discover-icon-button"><XIcon size={22} /></Dialog.Close></div>
   {slug ? detail.isPending ? <div className="discover-modal-message" role="status"><Dialog.Title>{t("Opening your inspiration…")}</Dialog.Title></div> : detail.isError || !entry ? <div className="discover-modal-message"><Dialog.Title>{t("This item couldn’t be loaded.")}</Dialog.Title><p>{detail.error && t(detail.error.message)}</p><button onClick={() => void detail.refetch()}>{t("Try again")}</button></div> : <>
    <div className="discover-detail-heading"><div><p className="discover-eyebrow">{t(entry.categoryTitle)} <span>·</span> {t(entry.kind === 'store' ? 'Store template' : 'Animated component')}</p><Dialog.Title>{entry.title}</Dialog.Title><Dialog.Description>{t(entry.summary)}</Dialog.Description></div><span className="discover-badge">{t(entry.tier === 'premium' ? 'Premium' : 'Free')}</span></div>
    <DetailPreview entry={entry} />
    <div className="discover-detail-body"><div><h3>{t("Made for your next idea.")}</h3><p>{t(entry.description)}</p><h3>{t("What’s inside")}</h3><ul>{entry.features.map((feature) => <li key={feature}><CheckIcon />{t(feature)}</li>)}</ul><div className="discover-tags">{entry.tags.map((tag) => <span key={tag}>{t(tag)}</span>)}</div></div><CatalogAction key={entry.slug} entry={entry} onLogin={() => {
     const intended = new URLSearchParams(params);
     intended.set('item', entry.slug);
     const intendedUrl = `/discover?${intended}`;
     if (!requireAuth({ requireFullAuth: true, actionContext: msg('Sign in to get this Discover item'), intendedUrl })) close();
    }} /></div>
    {!!detail.data?.related.length && <div className="discover-related"><h3>{t("Keep exploring")}</h3><div className="discover-grid">{detail.data.related.slice(0, 4).map((item) => <DiscoverCard key={item.id} entry={item} onOpen={openEntry} paused />)}</div></div>}
   </> : <div className="discover-topic-detail">
    <p className="discover-eyebrow">{t("A PLACE FOR YOUR NEXT IDEA")}</p><Dialog.Title>{t(category?.title ?? 'Explore this topic')}</Dialog.Title><Dialog.Description>{category?.description && t(category.description)}</Dialog.Description>
    <button className="discover-primary" onClick={() => setParams((current) => { const next = new URLSearchParams(current); if (topic) next.set('category', topic); next.delete('topic'); next.delete('item'); return next; }, { replace: true })}>{t("Explore this topic")}<ArrowRightIcon /></button>
    {topicItems.isPending ? <p role="status">{t("Loading ideas…")}</p> : topicItems.isError ? <p role="alert">{t("Couldn’t load this topic.")} <button onClick={() => void topicItems.refetch()}>{t("Try again")}</button></p> : <div className="discover-grid">{topicItems.data?.entries.map((item) => <DiscoverCard key={item.id} entry={item} onOpen={openEntry} paused />)}</div>}
   </div>}
  </Dialog>
 </Dialog.Root>;
}
