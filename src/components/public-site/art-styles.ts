/**
 * Product photos from Unsplash, under its free license (unsplash.com/license), cropped square and
 * bundled. Unsplash photo ids: wool socks 1615486364462, insulated bottle 1602143407151, trail
 * daypack 1509762774605, brass compass 1516503424803, house blend 1695245503558, ceramic dripper
 * 1759259639356, Ethiopia Guji 1712402832925.
 */
export const PHOTOS = {
	socks: '/marketing/products/wool-socks.webp',
	bottle: '/marketing/products/insulated-bottle.webp',
	daypack: '/marketing/products/trail-daypack.webp',
	compass: '/marketing/products/brass-compass.webp',
	houseBlend: '/marketing/products/house-blend.webp',
	dripper: '/marketing/products/ceramic-dripper.webp',
	guji: '/marketing/products/ethiopia-guji.webp',
} as const;

/** A store on desktop and on a phone, for the live preview card: the desktop shot cropped to its top, the phone shot at the frame's size. */
export const PREVIEW_SHOTS = {
	desktop: '/marketing/preview-desktop.webp',
	phone: '/marketing/preview-phone.webp',
} as const;

/** A store in Discover, its home page cropped to the top, for the Start from Discover card. */
export const DISCOVER_SHOT = '/marketing/discover-garden.webp';

/** 1Password's floating panels: white, softly shadowed. */
export const PANEL = 'rounded-[18px] bg-white shadow-[0_2px_6px_rgba(17,24,39,0.05),0_14px_40px_rgba(17,24,39,0.09)] ring-1 ring-black/[0.04]';
export const FIELDS = 'divide-y divide-[#e7e8ec] rounded-[14px] ring-1 ring-[#e2e4e9]';
export const MUTED = 'text-[#6b7280]';
