import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StoreWorkspacePreview } from './store-workspace';
import { Button, Input } from '@cloudflare/kumo';
import {
	ArrowLeftIcon,
	ArrowSquareOutIcon,
	BellIcon,
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	CheckIcon,
	CompassIcon,
	EnvelopeSimpleIcon,
	GearIcon,
	GlobeIcon,
	HouseIcon,
	MagnifyingGlassIcon,
	PackageIcon,
	PlusIcon,
	QuestionIcon,
	ReceiptIcon,
	SidebarSimpleIcon,
	SparkleIcon,
	TranslateIcon,
	UserIcon,
	XIcon,
} from '@phosphor-icons/react';
import './style.css';

export type Store = {
	id: number;
	name: string;
	category: string;
	initials: string;
	color: string;
	status: 'Published' | 'Draft';
	updated: string;
};
const INITIAL_STORES: Store[] = [
	{
		id: 1,
		name: 'North Ridge Coffee',
		category: 'Food & beverage',
		initials: 'nr',
		color: '#e8e1d6',
		status: 'Published',
		updated: 'Today, 9:24 AM',
	},
	{
		id: 2,
		name: 'The Everyday Edit',
		category: 'Fashion & apparel',
		initials: 'ee',
		color: '#e8e9f2',
		status: 'Published',
		updated: 'Yesterday, 4:12 PM',
	},
	{
		id: 3,
		name: 'Fieldwork Supply',
		category: 'Home & living',
		initials: 'fw',
		color: '#e2e9df',
		status: 'Draft',
		updated: 'Oct 21, 2026',
	},
	{
		id: 4,
		name: 'Sunday Objects',
		category: 'Art & design',
		initials: 'so',
		color: '#f2e7df',
		status: 'Draft',
		updated: 'Oct 20, 2026',
	},
];
type Panel =
	| 'agent'
	| 'new'
	| 'help'
	| 'notifications'
	| 'profile'
	| Store
	| null;

/** Review-only shell: sample data and local interactions, with no account mutations. */
export default function LayoutPreview() {
	const [params, setParams] = useSearchParams();
	const [page, setPage] = useState<'stores' | 'profile'>('stores');
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState('All stores');
	const [stores, setStores] = useState(INITIAL_STORES);
	const [selected, setSelected] = useState<number[]>([]);
	const [panel, setPanel] = useState<Panel>(null);
	const [name, setName] = useState('Alex Morgan');
	const [agentSent, setAgentSent] = useState(false);
	const dialog = useRef<HTMLDialogElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (panel) dialog.current?.showModal();
		else dialog.current?.close();
	}, [panel]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMobileOpen(false);
			if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
				event.preventDefault();
				searchRef.current?.focus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
	const visible = stores.filter(
		(store) =>
			(filter === 'All stores' || store.status === filter) &&
			`${store.name} ${store.category}`
				.toLowerCase()
				.includes(search.toLowerCase()),
	);
	const choosePage = (next: typeof page) => {
		setPage(next);
		setSearch('');
		setMobileOpen(false);
	};
	const toggleRow = (id: number) =>
		setSelected((previous) =>
			previous.includes(id)
				? previous.filter((value) => value !== id)
				: [...previous, id],
		);
	const allSelected =
		visible.length > 0 &&
		visible.every((store) => selected.includes(store.id));
	const activeStore = stores.find(
		(store) => String(store.id) === params.get('store'),
	);
	if (activeStore)
		return (
			<StoreWorkspacePreview
				key={activeStore.id}
				store={activeStore}
				stores={stores}
			/>
		);
	return (
		<div className={`layout-lab ${collapsed ? 'lab-collapsed' : ''}`}>
			<a href="#preview-content" className="lab-skip">
				Skip to content
			</a>
			<div className="lab-preview-banner">
				<span>
					<span className="lab-preview-dot" /> Layout preview
				</span>
				<span>Customer.io-inspired workspace · Sample data</span>
				<Link to="/profile">
					<ArrowLeftIcon /> Back to current app
				</Link>
			</div>
			<div className="lab-shell">
				<aside
					className={`lab-sidebar ${mobileOpen ? 'lab-mobile-open' : ''}`}
					aria-label="Workspace navigation"
				>
					<button
						className="lab-workspace"
						onClick={() => setPanel('profile')}
						title="Workspace profile"
					>
						<img
							src="/favicon.ico"
							alt=""
							onError={(event) => {
								event.currentTarget.style.display = 'none';
							}}
						/>
						<span>
							<small>Estori workspace</small>
							<strong>The Everyday Studio</strong>
						</span>
						<CaretDownIcon className="lab-workspace-caret" />
					</button>
					<nav>
						<button
							aria-label="Home"
							title="Home"
							onClick={() => choosePage('stores')}
						>
							<HouseIcon />
							<span>Home</span>
						</button>
						<button
							aria-label="Estori agent"
							title="Estori agent"
							onClick={() => {
								setAgentSent(false);
								setPanel('agent');
							}}
						>
							<SparkleIcon />
							<span>Estori agent</span>
							<span className="lab-new">AI</span>
						</button>
						<p>Build & manage</p>
						<button
							aria-label="My stores"
							title="My stores"
							className={page === 'stores' ? 'lab-active' : ''}
							aria-current={
								page === 'stores' ? 'page' : undefined
							}
							onClick={() => choosePage('stores')}
						>
							<GlobeIcon
								weight={page === 'stores' ? 'fill' : 'regular'}
							/>
							<span>My stores</span>
							<span className="lab-count">{stores.length}</span>
						</button>
						<Link
							aria-label="Catalog"
							title="Catalog"
							to="/catalog"
						>
							<PackageIcon />
							<span>Catalog</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
						<Link aria-label="Orders" title="Orders" to="/orders">
							<ReceiptIcon />
							<span>Orders</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
						<p>Reach your customers</p>
						<Link aria-label="Emails" title="Emails" to="/emails">
							<EnvelopeSimpleIcon />
							<span>Emails</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
						<Link
							aria-label="Translations"
							title="Translations"
							to="/translations"
						>
							<TranslateIcon />
							<span>Translations</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
						<p>Explore</p>
						<Link
							aria-label="Discover"
							title="Discover"
							to="/discover"
						>
							<CompassIcon />
							<span>Discover</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
						<p>Your workspace</p>
						<button
							aria-label="Profile"
							title="Profile"
							className={page === 'profile' ? 'lab-active' : ''}
							aria-current={
								page === 'profile' ? 'page' : undefined
							}
							onClick={() => choosePage('profile')}
						>
							<UserIcon
								weight={page === 'profile' ? 'fill' : 'regular'}
							/>
							<span>Profile</span>
						</button>
						<Link
							aria-label="Settings"
							title="Settings"
							to="/settings"
						>
							<GearIcon />
							<span>Settings</span>
							<ArrowSquareOutIcon className="lab-external" />
						</Link>
					</nav>
					<div className="lab-sidebar-bottom">
						<div className="lab-account">
							<span className="lab-avatar">AM</span>
							<span>
								<strong>{name}</strong>
								<small>Sample workspace</small>
							</span>
						</div>
						<button
							className="lab-collapse"
							aria-label={
								collapsed
									? 'Expand navigation'
									: 'Collapse navigation'
							}
							onClick={() => setCollapsed(!collapsed)}
						>
							<SidebarSimpleIcon />
							<span>Collapse navigation</span>
						</button>
					</div>
				</aside>
				{mobileOpen && (
					<button
						className="lab-mobile-scrim"
						aria-label="Close navigation"
						onClick={() => setMobileOpen(false)}
					/>
				)}
				<div className="lab-work-area">
					<header className="lab-topbar">
						<button
							className="lab-mobile-toggle"
							aria-label="Open navigation"
							onClick={() => {
								setCollapsed(false);
								setMobileOpen(true);
							}}
						>
							<SidebarSimpleIcon />
						</button>
						<div className="lab-breadcrumb">
							Workspace <span>/</span>{' '}
							<strong>
								{page === 'stores' ? 'My stores' : 'Profile'}
							</strong>
						</div>
						<div className="lab-global-search">
							<MagnifyingGlassIcon />
							<input
								ref={searchRef}
								aria-label="Search stores"
								placeholder="Search stores, products, and more"
								value={search}
								onChange={(event) => {
									setPage('stores');
									setSearch(event.target.value);
								}}
							/>
							<kbd>⌘ K</kbd>
						</div>
						<div className="lab-top-actions">
							<button onClick={() => setPanel('help')}>
								<QuestionIcon />
								<span>Need help?</span>
							</button>
							<button
								aria-label="Notifications"
								className="lab-notifications"
								onClick={() => setPanel('notifications')}
							>
								<BellIcon />
								<i />
							</button>
							<button
								aria-label="Open profile preview"
								onClick={() => choosePage('profile')}
							>
								<GearIcon />
							</button>
						</div>
					</header>
					<main id="preview-content" className="lab-canvas">
						<div className="lab-page-heading">
							<div className="lab-page-title">
								<span className="lab-page-icon">
									{page === 'stores' ? (
										<GlobeIcon weight="fill" />
									) : (
										<UserIcon weight="fill" />
									)}
								</span>
								<h1>
									{page === 'stores'
										? 'My stores'
										: 'Profile'}
								</h1>
							</div>
							<div className="lab-page-actions">
								{page === 'stores' ? (
									<>
										<Link
											className="lab-button-secondary"
											to="/discover"
										>
											<CompassIcon /> Browse Discover
										</Link>
										<Button
											variant="primary"
											onClick={() => setPanel('new')}
											className="lab-primary"
										>
											<PlusIcon /> New store
										</Button>
									</>
								) : (
									<Button
										variant="primary"
										className="lab-primary"
										onClick={() => setPanel('profile')}
									>
										Edit profile
									</Button>
								)}
							</div>
						</div>
						{page === 'stores' ? (
							<>
								<p className="lab-page-description">
									A home for every idea you’re bringing to
									life.
								</p>
								<div className="lab-data-panel">
									<div className="lab-filter-row">
										<span>View</span>
										<div
											className="lab-segment"
											aria-label="Store status"
										>
											{[
												'All stores',
												'Published',
												'Draft',
											].map((status) => (
												<button
													key={status}
													aria-pressed={
														filter === status
													}
													className={
														filter === status
															? 'lab-segment-active'
															: ''
													}
													onClick={() =>
														setFilter(status)
													}
												>
													{status}
												</button>
											))}
										</div>
									</div>
									<div className="lab-search-row">
										<MagnifyingGlassIcon />
										<input
											aria-label="Find a store"
											placeholder="Find a store by name or category…"
											value={search}
											onChange={(event) =>
												setSearch(event.target.value)
											}
										/>
										{search && (
											<button
												aria-label="Clear search"
												onClick={() => setSearch('')}
											>
												<XIcon />
											</button>
										)}
										<span className="lab-autosave">
											<CheckIcon /> All changes saved
										</span>
									</div>
									<div className="lab-table-toolbar">
										<strong>
											{selected.length
												? `${selected.length} selected`
												: `${visible.length} ${visible.length === 1 ? 'store' : 'stores'}`}
										</strong>
										{selected.length > 0 && (
											<button
												onClick={() => setSelected([])}
											>
												Clear selection
											</button>
										)}
										<span>
											{visible.length
												? `1–${visible.length} of ${visible.length}`
												: '0 results'}
										</span>
										<button
											aria-label="Previous page"
											disabled
										>
											<CaretLeftIcon />
										</button>
										<button aria-label="Next page" disabled>
											<CaretRightIcon />
										</button>
									</div>
									<div className="lab-table-scroll">
										<table>
											<thead>
												<tr>
													<th>
														<input
															type="checkbox"
															aria-label="Select all visible stores"
															checked={
																allSelected
															}
															onChange={() =>
																setSelected(
																	(
																		previous,
																	) =>
																		allSelected
																			? previous.filter(
																					(
																						id,
																					) =>
																						!visible.some(
																							(
																								store,
																							) =>
																								store.id ===
																								id,
																						),
																				)
																			: [
																					...new Set(
																						[
																							...previous,
																							...visible.map(
																								(
																									store,
																								) =>
																									store.id,
																							),
																						],
																					),
																				],
																)
															}
														/>
													</th>
													<th>Store name</th>
													<th>Status</th>
													<th>Category</th>
													<th>Last updated</th>
													<th />
												</tr>
											</thead>
											<tbody>
												{visible.map((store) => (
													<tr
														key={store.id}
														className={
															selected.includes(
																store.id,
															)
																? 'lab-row-selected'
																: ''
														}
													>
														<td>
															<input
																type="checkbox"
																aria-label={`Select ${store.name}`}
																checked={selected.includes(
																	store.id,
																)}
																onChange={() =>
																	toggleRow(
																		store.id,
																	)
																}
															/>
														</td>
														<td>
															<button
																className="lab-store-name"
																onClick={() =>
																	setParams({
																		store: String(
																			store.id,
																		),
																		section:
																			'home',
																	})
																}
															>
																<span
																	className="lab-store-avatar"
																	style={{
																		background:
																			store.color,
																	}}
																>
																	{
																		store.initials
																	}
																</span>
																{store.name}
															</button>
														</td>
														<td>
															<span
																className={`lab-status ${store.status === 'Published' ? 'lab-published' : ''}`}
															>
																<i />
																{store.status}
															</span>
														</td>
														<td>
															{store.category}
														</td>
														<td>{store.updated}</td>
														<td>
															<button
																aria-label={`View ${store.name}`}
																onClick={() =>
																	setParams({
																		store: String(
																			store.id,
																		),
																		section:
																			'home',
																	})
																}
															>
																<CaretRightIcon />
															</button>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									{!visible.length && (
										<div className="lab-empty">
											<MagnifyingGlassIcon />
											<h2>No stores found</h2>
											<p>
												Try a different name or change
												your filter.
											</p>
											<Button
												variant="secondary"
												onClick={() => {
													setSearch('');
													setFilter('All stores');
												}}
											>
												Clear filters
											</Button>
										</div>
									)}
								</div>
								<div className="lab-under-table">
									<span>
										Showing sample stores for this layout
										preview.
									</span>
									<span>1 page</span>
								</div>
								<div className="lab-tip">
									<span className="lab-tip-icon">
										<SparkleIcon />
									</span>
									<div>
										<strong>
											Your next idea starts with a
											conversation.
										</strong>
										<p>
											Describe what you have in mind.
											Estori helps you bring it to life.
										</p>
									</div>
									<button
										onClick={() => {
											setAgentSent(false);
											setPanel('agent');
										}}
									>
										Ask Estori <CaretRightIcon />
									</button>
								</div>
							</>
						) : (
							<div className="lab-profile">
								<div className="lab-profile-summary">
									<span className="lab-profile-avatar">
										AM
									</span>
									<div>
										<h2>{name}</h2>
										<p>
											Your ideas. Your stores. Your corner
											of the internet.
										</p>
										<span className="lab-verified">
											<CheckIcon /> Verified account
										</span>
									</div>
								</div>
								<div className="lab-profile-tabs">
									<button className="lab-profile-tab-active">
										About
									</button>
									<button
										onClick={() => choosePage('stores')}
									>
										Stores <span>{stores.length}</span>
									</button>
								</div>
								<div className="lab-profile-information">
									<h2>Profile information</h2>
									<p>
										A few details that make your workspace
										yours.
									</p>
									<dl>
										<div>
											<dt>Display name</dt>
											<dd>{name}</dd>
										</div>
										<div>
											<dt>Email</dt>
											<dd>alex@example.com</dd>
										</div>
										<div>
											<dt>Member since</dt>
											<dd>October 2026</dd>
										</div>
										<div>
											<dt>Bio</dt>
											<dd>
												Building thoughtful brands, one
												idea at a time.
											</dd>
										</div>
									</dl>
								</div>
							</div>
						)}
					</main>
					<footer className="lab-footer">
						<span>
							estori<span className="lab-brand-dot">.</span>
						</span>
						<span>
							Preview · No changes are saved to your account
						</span>
						<button
							aria-label="Ask Estori"
							title="Ask Estori"
							onClick={() => {
								setAgentSent(false);
								setPanel('agent');
							}}
						>
							<SparkleIcon /> Ask Estori
						</button>
					</footer>
				</div>
			</div>
			<dialog
				ref={dialog}
				className="lab-drawer"
				onCancel={() => setPanel(null)}
				onClick={(event) => {
					if (event.target === event.currentTarget) setPanel(null);
				}}
				aria-labelledby="lab-drawer-title"
			>
				<div className="lab-drawer-inner">
					<header>
						<span className="lab-drawer-symbol">
							<SparkleIcon />
						</span>
						<button
							aria-label="Close panel"
							onClick={() => setPanel(null)}
						>
							<XIcon />
						</button>
					</header>
					<p className="lab-drawer-eyebrow">
						ESTORI WORKSPACE PREVIEW
					</p>
					<h2 id="lab-drawer-title">
						{panel === 'new'
							? 'Give your next idea a home.'
							: panel === 'profile'
								? 'Make yourself at home.'
								: panel === 'help'
									? 'A little help along the way.'
									: panel === 'notifications'
										? 'You’re all caught up.'
										: typeof panel === 'object' && panel
											? panel.name
											: 'What are we building today?'}
					</h2>
					{panel === 'new' ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const data = new FormData(event.currentTarget);
								const title = String(
									data.get('storeName'),
								).trim();
								if (!title) return;
								setStores((previous) => [
									...previous,
									{
										id: Date.now(),
										name: title,
										category: 'Your next idea',
										initials: title
											.slice(0, 2)
											.toLowerCase(),
										color: '#e4eaff',
										status: 'Draft',
										updated: 'Just now',
									},
								]);
								setSearch('');
								setFilter('All stores');
								setPanel(null);
							}}
						>
							<p>
								Add a sample draft to try the new layout. It
								stays in this preview.
							</p>
							<label htmlFor="sample-store-name">
								Store name
							</label>
							<Input
								id="sample-store-name"
								name="storeName"
								required
								maxLength={80}
								placeholder="Your next great idea"
							/>
							<Button
								type="submit"
								variant="primary"
								className="lab-primary"
							>
								Create sample draft
							</Button>
						</form>
					) : panel === 'profile' ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const data = new FormData(event.currentTarget);
								const displayName = String(
									data.get('displayName'),
								).trim();
								if (displayName) setName(displayName);
								setPanel(null);
							}}
						>
							<p>
								Try editing your sample profile. Your account
								details stay unchanged.
							</p>
							<label htmlFor="sample-display-name">
								Display name
							</label>
							<Input
								id="sample-display-name"
								name="displayName"
								defaultValue={name}
								required
								maxLength={80}
							/>
							<Button
								type="submit"
								variant="primary"
								className="lab-primary"
							>
								Update preview
							</Button>
						</form>
					) : panel === 'agent' ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								setAgentSent(true);
							}}
						>
							<p>
								One place to ask questions, shape your store,
								and plan what comes next.
							</p>
							<div className="lab-agent-note">
								<SparkleIcon />
								{agentSent
									? 'That’s how a conversation starts. In the full app, Estori would help you take the next step. This preview uses no AI credits.'
									: 'Try the drawer while keeping your workspace in view.'}
							</div>
							<label htmlFor="sample-agent-prompt">
								Your idea
							</label>
							<textarea
								id="sample-agent-prompt"
								required
								placeholder="Help me prepare my store for launch…"
							/>
							<Button
								variant="primary"
								type="submit"
								className="lab-primary"
							>
								Try conversation
							</Button>
						</form>
					) : panel === 'help' ? (
						<>
							<p>
								Search, filter, and select stores. Open a
								store’s details, try the agent drawer, or switch
								to Profile in the sidebar.
							</p>
							<p>
								Links with an arrow open the existing Estori
								pages. This preview is the first step toward a
								shared workspace layout.
							</p>
						</>
					) : panel === 'notifications' ? (
						<p>
							Nothing needs your attention. New store updates and
							important account messages would appear here.
						</p>
					) : typeof panel === 'object' && panel ? (
						<>
							<p>{panel.category}</p>
							<span
								className={`lab-status ${panel.status === 'Published' ? 'lab-published' : ''}`}
							>
								<i />
								{panel.status}
							</span>
							<div
								className="lab-store-detail-art"
								style={{ background: panel.color }}
							>
								{panel.initials}
								<small>{panel.name}</small>
							</div>
							<p>
								This sample store shows how details could open
								alongside your workspace, without losing your
								place.
							</p>
						</>
					) : null}
				</div>
			</dialog>
		</div>
	);
}
