import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { CAPABILITIES, PLATFORM_CAPABILITIES } from '@/lib/capabilities';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION, type NavItem } from '@/lib/site-nav';

export type MenuId = 'solutions' | 'creators';

const PANEL = 'absolute inset-x-0 top-full whitespace-normal border-b border-public-line bg-white shadow-[0_24px_40px_rgba(0,0,0,0.08)]';
const COLUMN_TITLE = 'px-3 text-xs uppercase tracking-[0.02em] text-public-ink/80';
const ITEM = 'block rounded-lg px-3 py-2.5 text-public-ink hover:bg-[#f4f4f5] focus-visible:outline-2 focus-visible:outline-public-blue';

/** `showTag={false}` for the audience column: audiences aren't capabilities; the Platform column carries the tags. */
function DescribedLink({ item, showTag = true }: { item: NavItem; showTag?: boolean }) {
	return (
		<Link to={item.to} className={ITEM}>
			<span className="flex flex-wrap items-center gap-2 text-[15px]">
				{item.label}
				{showTag && item.capability && <CapabilityTag id={item.capability} />}
			</span>
			<span className="mt-0.5 block text-sm font-light text-public-muted">{item.description}</span>
		</Link>
	);
}

function Column({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<p className={COLUMN_TITLE}>{title}</p>
			<ul className="mt-3 grid gap-1">{children}</ul>
		</div>
	);
}

/** 1Password's Business panel, Estori-style: who it's for, then the platform with each capability's status. */
export function SolutionsMenuPanel({ id }: { id: string }) {
	return (
		<div id={id} className={PANEL}>
			<div className="mx-auto grid max-w-[1248px] gap-10 px-6 py-8 lg:grid-cols-2">
				<Column title="Estori for">
					{AUDIENCES.map((item) => (
						<li key={item.to}>
							<DescribedLink item={item} showTag={false} />
						</li>
					))}
				</Column>
				<Column title="Platform">
					{PLATFORM_CAPABILITIES.map((capabilityId) => {
						const capability = CAPABILITIES[capabilityId];
						return (
							<li key={capabilityId}>
								<Link to={capability.path} className={`${ITEM} flex items-center justify-between gap-4 text-[15px]`}>
									{capability.name}
									<CapabilityTag id={capabilityId} />
								</Link>
							</li>
						);
					})}
				</Column>
			</div>
		</div>
	);
}

export function CreatorsMenuPanel({ id }: { id: string }) {
	return (
		<div id={id} className={PANEL}>
			<div className="mx-auto max-w-[1248px] px-6 py-8">
				<p className="px-3 text-sm font-light text-public-muted">{CREATORS_CAPTION}</p>
				<ul className="mt-3 grid gap-1 lg:grid-cols-2">
					{CREATOR_ITEMS.map((item) => (
						<li key={item.to}>
							<DescribedLink item={item} />
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

/** The open panel for a top-bar menu, rendered right after its trigger so keyboard focus moves into it. */
export function MenuPanel({ id }: { id: MenuId }) {
	return id === 'solutions' ? <SolutionsMenuPanel id={`menu-${id}`} /> : <CreatorsMenuPanel id={`menu-${id}`} />;
}

function MobileGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="py-2">
			<p className="py-1 text-xs uppercase tracking-[0.02em] text-public-ink/80">{title}</p>
			<ul className="grid">{children}</ul>
		</div>
	);
}

const MOBILE_LINK = 'flex flex-wrap items-center gap-2 py-2 text-lg text-public-charcoal';

/** The same groups as the desktop panels, stacked for the phone menu. */
export function MobileMenuGroups() {
	return (
		<>
			<MobileGroup title="Solutions">
				{AUDIENCES.map((item) => (
					<li key={item.to}>
						<Link to={item.to} className={MOBILE_LINK}>
							{item.label}
						</Link>
					</li>
				))}
			</MobileGroup>
			<MobileGroup title="Platform">
				{PLATFORM_CAPABILITIES.map((capabilityId) => (
					<li key={capabilityId}>
						<Link to={CAPABILITIES[capabilityId].path} className={MOBILE_LINK}>
							{CAPABILITIES[capabilityId].name}
							<CapabilityTag id={capabilityId} />
						</Link>
					</li>
				))}
			</MobileGroup>
			<MobileGroup title="For creators">
				{CREATOR_ITEMS.map((item) => (
					<li key={item.to}>
						<Link to={item.to} className={MOBILE_LINK}>
							{item.label}
							{item.capability && <CapabilityTag id={item.capability} />}
						</Link>
					</li>
				))}
			</MobileGroup>
		</>
	);
}
