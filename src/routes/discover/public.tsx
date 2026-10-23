import { t, tn } from '@/lib/i18n';
import { catalogFilters } from '@/components/public-site/discover/catalog-utils';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeftIcon, ArrowRightIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon, SparkleIcon, XIcon } from '@phosphor-icons/react';
import type { DiscoverEntry } from '@/api-types';
import { useDiscoverCatalog, useDiscoverCategories } from '@/hooks/use-public-discover';
import { DiscoverCard } from '@/components/public-site/discover/DiscoverCard';
import { DiscoverDialog } from '@/components/public-site/discover/DiscoverDialog';
import { PageMeta } from '@/components/public-site/solution-page';
import '@/components/public-site/discover/discover.css';


export default function PublicDiscoverPage() {
 const [params, setParams] = useSearchParams();
 const filters = catalogFilters(params);
 const [search, setSearch] = useState(filters.search ?? '');
 const [paused, setPaused] = useState(false);
 useEffect(() => { setSearch(filters.search ?? ''); }, [filters.search]);
 const rail = useRef<HTMLDivElement>(null);
 const resultsRef = useRef<HTMLElement>(null);
 const catalog = useDiscoverCatalog(filters);
 const categories = useDiscoverCategories();
 const filter = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (!value) next.delete(key); else next.set(key, value); return next; });
 const openEntry = (entry: DiscoverEntry) => filter('item', entry.slug);
 const entries = catalog.data?.entries ?? [];
 const isFiltered = !!(filters.search || filters.category || filters.kind || filters.tier);
 const featuredStores = entries.filter((entry) => entry.featured && entry.kind === 'store');
 const featuredMotion = entries.filter((entry) => entry.featured && entry.kind === 'component');
 const featured = [featuredStores[0], featuredMotion[0], featuredStores[2], featuredMotion[4]].filter((entry): entry is DiscoverEntry => !!entry);
 const scrollResults = () => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
 return <div className="public-discover">
  <PageMeta title={t("Discover store templates & animated components")} description={t("Find your next store idea. Explore original storefront templates and animated components, with free and premium designs for every kind of business.")} />
  <section className="discover-hero"><div className="discover-hero-grid" aria-hidden="true" /><p className="discover-eyebrow"><SparkleIcon weight="fill" /> {t("A LITTLE INSPIRATION. ENDLESS POSSIBILITIES.")}</p><h1>{t("Good ideas start here.")}</h1><p className="discover-hero-description">{t("Discover stores, motion and the people you could bring together.")}</p>
   <form className="discover-search" onSubmit={(event) => { event.preventDefault(); filter('q', search.trim()); scrollResults(); }}><label htmlFor="discover-search" className="sr-only">{t("Search Discover")}</label><MagnifyingGlassIcon size={23} /><input id="discover-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder={t("What would you love to create?")} /><button type="submit">{t("Explore")} <ArrowRightIcon /></button></form>
   <div className="discover-suggestions">{[{ title: t('My first store'), kind: 'store' }, { title: t('Something with motion'), kind: 'component' }, { title: t('A place to connect'), category: 'learning-communities' }].map((suggestion) => <button key={suggestion.title} onClick={() => { setParams(suggestion.kind ? { kind: suggestion.kind } : { category: suggestion.category! }); setSearch(''); scrollResults(); }}>{suggestion.title}<ArrowRightIcon /></button>)}</div>
  </section>
  <section className="discover-topics" aria-label={t("Explore topics")}><div className="discover-section-heading"><h2>{t("EXPLORE YOUR WORLD")} <SparkleIcon /></h2><div className="discover-rail-controls"><button aria-label={t("Previous topics")} onClick={() => rail.current?.scrollBy({ left: -600, behavior: 'smooth' })}><ArrowLeftIcon /></button><button aria-label={t("Next topics")} onClick={() => rail.current?.scrollBy({ left: 600, behavior: 'smooth' })}><ArrowRightIcon /></button></div></div>
   <div ref={rail} className="discover-topic-rail">{categories.isPending ? Array.from({ length: 5 }, (_, i) => <div className="discover-topic-skeleton" key={i} />) : categories.data?.map((category, index) => <button key={category.id} className="discover-topic-card" style={{ backgroundColor: category.color }} onClick={() => filter('topic', category.slug)}>
    {category.coverUrl && <img src={category.coverUrl} alt="" loading="lazy" />}<span className="discover-topic-shade" /><span className="discover-topic-number">{t('{number} / EXPLORE', { number: String(index + 1).padStart(2, '0') })}</span><strong>{t(category.title)}</strong><span className="discover-topic-meta">{tn('{count} idea to make your own', '{count} ideas to make your own', category.count)} <ArrowRightIcon /></span>
   </button>)}</div>{categories.isError && <p role="alert">{t("Topics couldn’t load.")} <button onClick={() => void categories.refetch()}>{t("Try again")}</button></p>}
  </section>
  <section ref={resultsRef} className="discover-results" aria-label={t("Discover catalog")}>
   <div className="discover-filter-row"><div className="discover-type-tabs" aria-label={t("Item type")}>{[{ value: '', label: t('Everything') }, { value: 'store', label: t('Store templates') }, { value: 'component', label: t('Animated components') }].map((kind) => <button key={kind.value} aria-pressed={(filters.kind ?? '') === kind.value} onClick={() => filter('kind', kind.value)}>{kind.label}</button>)}</div><div className="discover-filter-actions"><label className="sr-only" htmlFor="discover-tier">{t("Price")}</label><select id="discover-tier" value={filters.tier ?? ''} onChange={(event) => filter('tier', event.target.value)}><option value="">{t("Any price")}</option><option value="free">{t("Free")}</option><option value="premium">{t("Premium")}</option></select><button className="discover-icon-button" aria-label={t(paused ? 'Enable card animations' : 'Pause card animations')} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <PlayIcon /> : <PauseIcon />}</button></div></div>
   <div className="discover-category-filters" aria-label={t("Topics")}><button aria-pressed={!filters.category} onClick={() => filter('category', '')}>{t("All topics")}</button>{categories.data?.map((category) => <button key={category.id} aria-pressed={filters.category === category.slug} onClick={() => filter('category', category.slug)}>{t(category.title)}</button>)}</div>
   {catalog.isPending ? <div className="discover-grid" role="status" aria-label={t("Loading ideas")}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="discover-loading-card" />)}</div> : catalog.isError ? <div className="discover-empty" role="alert"><h2>{t("We couldn’t load your inspiration.")}</h2><p>{t(catalog.error.message)}</p><button className="discover-primary" onClick={() => void catalog.refetch()}>{t("Try again")}<ArrowRightIcon /></button></div> : entries.length === 0 ? <div className="discover-empty"><h2>{t("A different search might spark something.")}</h2><p>{t("No matches for these filters. Explore another topic or start fresh.")}</p><button className="discover-primary" onClick={() => { setParams({}); setSearch(''); }}>{t("Explore everything")}<ArrowRightIcon /></button></div> : <>
    {!isFiltered && featured.length > 0 && <div className="discover-collection"><div className="discover-collection-heading"><div><p className="discover-eyebrow">{t("THE EDIT")}</p><h2>{t("Ideas we’re loving.")}</h2><p>{t("A few standouts to get your imagination going.")}</p></div><span className="discover-editor-tag"><SparkleIcon /> {t("Curated by Estori")}</span></div><div className="discover-grid">{featured.map((entry) => <DiscoverCard key={entry.id} entry={entry} onOpen={openEntry} paused={paused} />)}</div></div>}
    <div className="discover-collection"><div className="discover-collection-heading"><div><h2>{t(isFiltered ? filters.category ? categories.data?.find((category) => category.slug === filters.category)?.title ?? 'Your discoveries' : 'Your discoveries' : 'Find your next favorite.')}</h2><p>{filters.search ? t('Results for “{search}”', { search: filters.search }) : t('Original storefronts and little details that make a big difference.')}</p></div><div className="discover-result-count" aria-live="polite">{tn('{count} idea', '{count} ideas', catalog.data?.total ?? 0)}{isFiltered && <button onClick={() => { setParams({}); setSearch(''); }} aria-label={t("Clear all filters")}><XIcon /></button>}</div></div><div className="discover-grid">{entries.map((entry) => <DiscoverCard key={entry.id} entry={entry} onOpen={openEntry} paused={paused} />)}</div></div>
   </>}
  </section>
  <div className="discover-bottom-note"><SparkleIcon size={28} /><p>{t("Start with a spark.")}<br /><strong>{t("Make it entirely yours.")}</strong></p><span>{t("Built for curious people with something to share.")}</span></div>
  <DiscoverDialog />
 </div>;
}
