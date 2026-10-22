import { marketingCopy } from '@/content/marketing-copy';
import { PHOTOS } from '@/components/public-site/art-styles';

const marketArt = {
	us: { latitude: 38, longitude: -97, image: PHOTOS.bottle, lang: 'en' },
	br: { latitude: -14, longitude: -52, image: PHOTOS.houseBlend, lang: 'pt-BR' },
	co: { latitude: 4.6, longitude: -74.1, image: PHOTOS.dripper, lang: 'es-CO' },
	cl: { latitude: -33.4, longitude: -70.7, image: PHOTOS.daypack, lang: 'es-CL' },
	ar: { latitude: -34.6, longitude: -58.4, image: PHOTOS.socks, lang: 'es-AR' },
	mx: { latitude: 23.6, longitude: -102.5, image: PHOTOS.compass, lang: 'es-MX' },
	es: { latitude: 40.4, longitude: -3.7, image: PHOTOS.guji, lang: 'es-ES' },
};
type MarketId = keyof typeof marketArt;
export const GLOBAL_MARKETS = Object.entries(marketingCopy.home.globalCommerce.markets).map(([id, copy]) => ({
	id,
	...copy,
	...marketArt[id as MarketId],
	label: copy.shortName,
	flag: `/marketing/flags/${id}.svg`,
}));
