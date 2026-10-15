import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
	ChatCircleTextIcon,
	CodeIcon,
	DownloadSimpleIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	MegaphoneIcon,
	PackageIcon,
	StorefrontIcon,
	type Icon,
} from '@phosphor-icons/react';
import { LEGAL_CONTACT } from '@/api-types';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { INDUSTRIES, industryPath } from '@/content/industries';
import { CAPABILITIES, PLATFORM_CAPABILITIES } from '@/lib/capabilities';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION, type NavIcon, type NavItem } from '@/lib/site-nav';
import { cn } from '@/lib/utils';

export type MenuId = 'solutions' | 'creators';

const NAV_ICONS: Readonly<Record<NavIcon, Icon>> = {
	storefront: StorefrontIcon,
	package: PackageIcon,
	download: DownloadSimpleIcon,
	code: CodeIcon,
	megaphone: MegaphoneIcon,
};

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
const MENU_EXTRAS: Readonly<Record<MenuId, { links?: readonly PlainLink[]; feature: MenuFeature }>> = {
	solutions: {
		feature: {
			image: '/marketing/auth-signup.webp',
			position: 'object-center',
			title: 'From first idea to first order.',
			link: { to: '/signup', label: 'Start building free' },
		},
	},
	creators: {
		links: [
			{ to: '/discover', label: 'Templates in Discover' },
			{ to: '/pricing#developers', label: 'Fees for template sales' },
		],
		feature: {
			image: '/marketing/auth-signin.webp',
			position: 'object-[82%_center]',
			title: 'Sell the stores you design.',
			link: { to: '/creators/developers', label: 'See how it works' },
		},
	},
};

/** The bar along the bottom of every panel, as on 1Password: plans on the left, help on the right. */
const FOOTER_LINKS: { start: FooterLink; end: readonly FooterLink[] } = {
	start: { href: '/pricing#compare', label: 'Compare plans', icon: MagnifyingGlassIcon },
	end: [
		{ href: `mailto:${LEGAL_CONTACT.support}`, label: 'Email support', icon: EnvelopeSimpleIcon },
		{ href: '/contact', label: 'Talk to sales', icon: ChatCircleTextIcon },
	],
};

const COLUMN_TITLE = 'text-[13px] tracking-[0.06em] text-public-muted uppercase';
const FOCUS = 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-public-blue focus-visible:ring-offset-2';
const HOVER_TEXT = 'underline-offset-4 transition-colors group-hover:text-public-blue group-hover:underline';

/** An item with its icon and a line of description: icon and title turn blue, and the title underlines, on hover. */
function IconItem({ item, showTag }: { item: NavItem; showTag: boolean }) {
	const Glyph = NAV_ICONS[item.icon];
	return (
		<Link to={item.to} className={cn('group flex gap-3 py-2', FOCUS)}>
			<Glyph className="mt-0.5 size-5 shrink-0 text-public-ink transition-colors group-hover:text-public-blue" aria-hidden />
			<span className="min-w-0">
				<span className="flex flex-wrap items-center gap-2">
					<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{item.label}</span>
					{showTag && item.capability && <CapabilityTag id={item.capability} />}
				</span>
				<span className="mt-1 block text-sm font-light text-public-muted">{item.description}</span>
			</span>
		</Link>
	);
}

function TextItem({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link to={to} className={cn('group flex flex-wrap items-center gap-2 py-2', FOCUS)}>
			{children}
		</Link>
	);
}

function Column({ title, caption, className, children }: { title: string; caption?: string; className?: string; children: ReactNode }) {
	return (
		<div className={className}>
			<p className={COLUMN_TITLE}>{title}</p>
			{caption && <p className="mt-2 text-sm font-light text-public-muted">{caption}</p>}
			<ul className="mt-4 grid gap-1">{children}</ul>
		</div>
	);
}

/** A column of plain links, each turning blue and underlining on hover. */
function LinksColumn({ title, links, className }: { title: string; links: readonly PlainLink[]; className?: string }) {
	return (
		<Column title={title} className={className}>
			{links.map((link) => (
				<li key={link.to}>
					<TextItem to={link.to}>
						<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{link.label}</span>
					</TextItem>
				</li>
			))}
		</Column>
	);
}

/** A menu's columns, shared by the desktop panel and the phone menu's page for it. */
function MenuColumns({ id, columnClassName }: { id: MenuId; columnClassName?: string }) {
	const { links } = MENU_EXTRAS[id];

	if (id === 'creators') {
		return (
			<>
				<Column title="For creators" caption={CREATORS_CAPTION} className={columnClassName}>
					{CREATOR_ITEMS.map((item) => (
						<li key={item.to}>
							<IconItem item={item} showTag />
						</li>
					))}
				</Column>
				{links && <LinksColumn title="Get started" links={links} className={columnClassName} />}
			</>
		);
	}
	return (
		<>
			{/* Audiences aren't capabilities; the Platform column carries the status tags. */}
			<Column title="Estori for" className={columnClassName}>
				{AUDIENCES.map((item) => (
					<li key={item.to}>
						<IconItem item={item} showTag={false} />
					</li>
				))}
			</Column>
			<Column title="Industries" className={columnClassName}>
				{INDUSTRIES.map((industry) => (
					<li key={industry.slug}>
						<TextItem to={industryPath(industry.slug)}>
							<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{industry.name}</span>
						</TextItem>
					</li>
				))}
			</Column>
			<Column title="Platform" className={columnClassName}>
				{PLATFORM_CAPABILITIES.map((capabilityId) => (
					<li key={capabilityId}>
						<TextItem to={CAPABILITIES[capabilityId].path}>
							<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{CAPABILITIES[capabilityId].name}</span>
							<CapabilityTag id={capabilityId} />
						</TextItem>
					</li>
				))}
			</Column>
		</>
	);
}

/** A photo card with a caption and an underlined call to action; the photo eases in a little on hover. */
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
				<span className="block text-xl leading-snug text-balance">{feature.title}</span>
				<span className="mt-4 inline-block border-b border-white pb-0.5 text-[15px]">{feature.link.label}</span>
			</span>
		</Link>
	);
}

function FooterItem({ link }: { link: FooterLink }) {
	const content = (
		<>
			<link.icon className="size-5 text-public-ink transition-colors group-hover:text-public-blue" aria-hidden />
			<span className={cn('text-[16px] text-public-ink', HOVER_TEXT)}>{link.label}</span>
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
	solutions: 'lg:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_22rem]',
	creators: 'lg:grid-cols-2 xl:grid-cols-[repeat(2,minmax(0,1fr))_22rem]',
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
