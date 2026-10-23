import { t } from '@/lib/i18n';
import { discoverPrice } from './catalog-utils';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRightIcon, PlayIcon } from '@phosphor-icons/react';
import { useReducedMotion } from 'framer-motion';
import type { DiscoverEntry } from '@/api-types';



export function DiscoverCard({ entry, onOpen, paused = false }: { entry: DiscoverEntry; onOpen: (entry: DiscoverEntry) => void; paused?: boolean }) {
 const [active, setActive] = useState(false);
 const ref = useRef<HTMLButtonElement>(null);
 const reduced = useReducedMotion();
 useEffect(() => {
  const observer = new IntersectionObserver(([target]) => { if (!target.isIntersecting) setActive(false); });
  if (ref.current) observer.observe(ref.current);
  const hide = () => { if (document.hidden) setActive(false); };
  document.addEventListener('visibilitychange', hide);
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', hide); };
 }, []);
 return <button ref={ref} type="button" className="discover-card" onClick={() => onOpen(entry)} onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)} onFocus={() => setActive(true)} onBlur={() => setActive(false)} aria-label={t('Explore {title}', { title: entry.title })}>
  <span className="discover-card-art" style={{ backgroundColor: entry.palette[0] ?? '#f1f1f1' }}>
   <img src={entry.coverUrl} alt="" loading="lazy" width="800" height="600" />
   {active && !paused && !reduced && entry.kind === 'component' && <iframe title={t('{title} motion preview', { title: entry.title })} src={entry.previewUrl} sandbox="allow-scripts" tabIndex={-1} className="discover-card-frame" />}
   <span className="discover-card-kind">{entry.kind === 'component' ? <><PlayIcon weight="fill" /> {t("Animated component")}</> : t('Store template')}</span>
   <span className="discover-card-arrow"><ArrowUpRightIcon /></span>
  </span>
  <span className="discover-card-caption"><span><strong>{entry.title}</strong><span className="discover-card-category">{t(entry.categoryTitle)}</span></span><span className={entry.tier === 'premium' ? 'discover-price premium' : 'discover-price'}>{discoverPrice(entry)}</span></span>
 </button>;
}
