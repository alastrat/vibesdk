import { t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import { Link } from 'react-router';
import {
	ArmchairIcon,
	ArrowsClockwiseIcon,
	ChartLineUpIcon,
	ChatCircleTextIcon,
	ChatsCircleIcon,
	CoatHangerIcon,
	CodeIcon,
	CompassIcon,
	CreditCardIcon,
	DiamondIcon,
	DownloadSimpleIcon,
	EnvelopeSimpleIcon,
	FlowerLotusIcon,
	ForkKnifeIcon,
	HandSoapIcon,
	ListMagnifyingGlassIcon,
	MagicWandIcon,
	MagnifyingGlassIcon,
	MegaphoneIcon,
	MountainsIcon,
	PackageIcon,
	PaperPlaneTiltIcon,
	PawPrintIcon,
	PercentIcon,
	RobotIcon,
	ShoppingCartIcon,
	StorefrontIcon,
	TruckIcon,
	TranslateIcon,
	UsersThreeIcon,
	type Icon,
} from '@phosphor-icons/react';
import { LEGAL_CONTACT } from '@/api-types';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { GROUP_UNDERLINE_FILL, GROUP_UNDERLINE_GROW } from '@/components/public-site/primitives';
import { INDUSTRIES, industryPath, type IndustrySlug } from '@/content/industries';
import { CAPABILITIES, PLATFORM_CAPABILITIES, type CapabilityId } from '@/lib/capabilities';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION, type NavIcon, type NavItem } from '@/lib/site-nav';
import { cn } from '@/lib/utils';

export type MenuId = 'solutions' | 'creators';

const NAV_ICONS: Readonly<Record<NavIcon, Icon>> = {
	storefront: StorefrontIcon,
	package: PackageIcon,
	download: DownloadSimpleIcon,
	repeat: ArrowsClockwiseIcon,
	users: UsersThreeIcon,
	code: CodeIcon,
	megaphone: MegaphoneIcon,
};

const INDUSTRY_ICONS: Readonly<Record<IndustrySlug, Icon>> = {
	'beauty-personal-care': HandSoapIcon,
	'fashion-apparel': CoatHangerIcon,
	'health-wellness': FlowerLotusIcon,
	'food-beverage': ForkKnifeIcon,
	'home-living': ArmchairIcon,
	'jewelry-accessories': DiamondIcon,
	'sports-outdoors': MountainsIcon,
	pets: PawPrintIcon,
};

const CAPABILITY_ICONS: Readonly<Record<CapabilityId, Icon>> = {
	'store-builder': MagicWandIcon,
	'agentic-commerce': ChatsCircleIcon,
	'operations-agents': RobotIcon,
	'personalized-shopping': ShoppingCartIcon,
	'product-catalog': TruckIcon,
	payments: CreditCardIcon,
	'order-management': PackageIcon,
	'store-translations': TranslateIcon,
	'digital-products': UsersThreeIcon,
	'developer-templates': CodeIcon,
	'content-creators': MegaphoneIcon,
	subscriptions: ArrowsClockwiseIcon,
	'email-marketing': PaperPlaneTiltIcon,
	'web-analytics': ChartLineUpIcon,
	'search-optimization': ListMagnifyingGlassIcon,
};

/** One item in a menu column: every item has an icon; some add a line of description or a status tag. */
interface MenuLink {
	to: string;
	label: string;
	icon: Icon;
	description?: string;
	tag?: CapabilityId;
}

interface PlainLink {
	to: string;
	label: string;
}

interface FooterLink {
	/** A page in the app, or a mailto: address. */
	href: string;
	label: string;
	icon: Icon;
}

interface MenuFeature {
	image: string;
	/** Keeps the subject in view when the photo is cropped to the card. */
	position: string;
	title: string;
	link: PlainLink;
}

/** Each menu's photo card, and a Get started column where the menu has one. */
const MENU_EXTRAS: Readonly<Record<MenuId, { links?: readonly MenuLink[]; feature: MenuFeature }>> = {
	solutions: {
		feature: {
			image: '/marketing/auth-signup.webp',
			position: 'object-center',
			title: marketingCopy.navigation.menus.solutions.feature.title,
			link: { to: '/signup', label: marketingCopy.navigation.menus.solutions.feature.link.label },
		},
	},
	creators: {
		links: [
			{ to: '/discover', label: marketingCopy.navigation.menus.creators.links.discover, icon: CompassIcon },
			{ to: '/pricing#developers', label: marketingCopy.navigation.menus.creators.links.fees, icon: PercentIcon },
		],
		feature: {
			image: '/marketing/auth-signin.webp',
			position: 'object-[82%_center]',
			title: marketingCopy.navigation.menus.creators.feature.title,
			link: { to: '/creators/developers', label: marketingCopy.navigation.menus.creators.feature.link.label },
		},
	},
};

/** The bar along the bottom of every panel, as on 1Password: plans on the left, help on the right. */
const FOOTER_LINKS: { start: FooterLink; end: readonly FooterLink[] } = {
	start: { href: '/pricing#compare', label: marketingCopy.navigation.menuFooter.start.label, icon: MagnifyingGlassIcon },
	end: [
		{ href: `mailto:${LEGAL_CONTACT.support}`, label: marketingCopy.navigation.menuFooter.end.support, icon: EnvelopeSimpleIcon },
		{ href: '/contact', label: marketingCopy.navigation.menuFooter.end.sales, icon: ChatCircleTextIcon },
	],
};

/** A registry item as a menu link; `showTag` adds its capability's status. */
function fromNavItem(item: NavItem, showTag: boolean): MenuLink {
	return { to: item.to, label: item.label, icon: NAV_ICONS[item.icon], description: item.description, tag: showTag ? item.capability : undefined };
}

// Audiences aren't capabilities; the Platform column carries the status tags.
const AUDIENCE_LINKS = AUDIENCES.map((item) => fromNavItem(item, false));
const CREATOR_LINKS = CREATOR_ITEMS.map((item) => fromNavItem(item, true));
const INDUSTRY_LINKS: readonly MenuLink[] = INDUSTRIES.map((industry) => ({
	to: industryPath(industry.slug),
	label: industry.name,
	icon: INDUSTRY_ICONS[industry.slug],
}));
const PLATFORM_LINKS: readonly MenuLink[] = PLATFORM_CAPABILITIES.map((capabilityId) => ({
	to: CAPABILITIES[capabilityId].path,
	label: CAPABILITIES[capabilityId].name,
	icon: CAPABILITY_ICONS[capabilityId],
	tag: capabilityId,
}));

const COLUMN_TITLE = 'text-[13px] tracking-[0.06em] text-public-muted uppercase';
const FOCUS = 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-public-blue focus-visible:ring-offset-2';
const ICON = 'size-5 shrink-0 text-public-ink transition-colors group-hover:text-public-blue';
/** A hovered item's label turns blue and its underline draws in from the left, like the announcement's link. */
const HOVER_TEXT = `group-hover:text-public-blue ${GROUP_UNDERLINE_GROW}`;

/** A menu item: its icon, its label with any status tag, and any description; icon and label turn blue on hover. */
function MenuItem({ link }: { link: MenuLink }) {
	const Glyph = link.icon;
	return (
		<Link to={link.to} className={cn('group flex gap-3 py-2', FOCUS)}>
			<Glyph className={cn('mt-0.5', ICON)} aria-hidden />
			<span className="min-w-0">
				<span className="flex flex-wrap items-center gap-2">
					<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{t(link.label)}</span>
					{link.tag && <CapabilityTag id={link.tag} />}
				</span>
				{link.description && <span className="mt-1 block text-sm font-light text-public-muted">{t(link.description)}</span>}
			</span>
		</Link>
	);
}

function Column({ title, caption, links, className }: { title: string; caption?: string; links: readonly MenuLink[]; className?: string }) {
	return (
		<div className={className}>
			<p className={COLUMN_TITLE}>{t(title)}</p>
			{caption && <p className="mt-2 text-sm font-light text-public-muted">{t(caption)}</p>}
			<ul className="mt-4 grid gap-1">
				{links.map((link) => (
					<li key={link.to}>
						<MenuItem link={link} />
					</li>
				))}
			</ul>
		</div>
	);
}

/** A menu's columns, shared by the desktop panel and the phone menu's page for it. */
function MenuColumns({ id, columnClassName }: { id: MenuId; columnClassName?: string }) {
	const { links } = MENU_EXTRAS[id];

	if (id === 'creators') {
		return (
			<>
				<Column title={t("For creators")} caption={CREATORS_CAPTION} links={CREATOR_LINKS} className={columnClassName} />
				{links && <Column title={t(marketingCopy.navigation.getStarted)} links={links} className={cn(columnClassName, 'hidden')} />}
			</>
		);
	}
	return (
		<>
			<Column title={t(marketingCopy.navigation.estoriFor)} links={AUDIENCE_LINKS} className={columnClassName} />
			<Column title={t(marketingCopy.common.industries)} links={INDUSTRY_LINKS} className={columnClassName} />
			<Column title={t(marketingCopy.navigation.platform)} links={PLATFORM_LINKS} className={cn(columnClassName, 'hidden')} />
		</>
	);
}

/** A photo card with a caption and an underlined call to action; on hover the photo eases in and the underline redraws. */
function FeatureCard({ feature }: { feature: MenuFeature }) {
	return (
		<Link to={feature.link.to} className={cn('group relative block h-full min-h-[22rem] overflow-hidden rounded-2xl', FOCUS)}>
			<img
				src={feature.image}
				alt=""
				className={cn('absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none', feature.position)}
			/>
			<span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
			<span className="absolute inset-x-0 bottom-0 p-6 text-white">
				<span className="block text-xl leading-snug text-balance">{t(feature.title)}</span>
				<span className={cn('mt-4 inline-block text-[15px]', GROUP_UNDERLINE_FILL)}>{t(feature.link.label)}</span>
			</span>
		</Link>
	);
}

function FooterItem({ link }: { link: FooterLink }) {
	const content = (
		<>
			<link.icon className={ICON} aria-hidden />
			<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{t(link.label)}</span>
		</>
	);
	const className = cn('group inline-flex items-center gap-3', FOCUS);
	return link.href.startsWith('mailto:') ? (
		<a href={link.href} className={className}>
			{content}
		</a>
	) : (
		<Link to={link.href} className={className}>
			{content}
		</Link>
	);
}

const PANEL = 'absolute inset-x-4 top-full mx-auto mt-2 max-w-[1400px] overflow-hidden whitespace-normal rounded-2xl border border-public-line bg-white shadow-[0_24px_48px_rgba(0,0,0,0.12)] motion-safe:animate-public-menu-in';

const PANEL_GRIDS: Readonly<Record<MenuId, string>> = {
	solutions: 'lg:grid-cols-2 xl:grid-cols-[repeat(2,minmax(0,1fr))_22rem]',
	creators: 'lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem]',
};

/**
 * The open panel for a top-bar menu, as on 1Password: columns split by thin lines, a photo card on wide screens, and a
 * bar of links along the bottom. It renders right after its trigger, so keyboard focus moves into it.
 */
export function MenuPanel({ id }: { id: MenuId }) {
	return (
		<div id={`menu-${id}`} className={PANEL}>
			<div className={cn('grid divide-x divide-public-line', PANEL_GRIDS[id])}>
				<MenuColumns id={id} columnClassName="px-8 py-8" />
				<div className="hidden p-6 xl:block">
					<FeatureCard feature={MENU_EXTRAS[id].feature} />
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-4 border-t border-public-line px-8 py-5">
				<FooterItem link={FOOTER_LINKS.start} />
				<div className="flex flex-wrap items-center gap-8">
					{FOOTER_LINKS.end.map((link) => (
						<FooterItem key={link.href} link={link} />
					))}
				</div>
			</div>
		</div>
	);
}

/** A menu's page in the phone menu: the same columns, stacked, two across from sm. */
export function MobileMenuSection({ id }: { id: MenuId }) {
	return (
		<div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
			<MenuColumns id={id} />
		</div>
	);
}
