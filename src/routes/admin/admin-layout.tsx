import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Tabs, Table, buttonVariants } from '@cloudflare/kumo';
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	ShieldCheckIcon,
} from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { ADMIN_CATALOG_ORDERS_PATH } from '@/api-types';
import { msg, t, tn, useI18n } from '@/lib/i18n';
import './admin.css';

const sections = [
	{ id: 'reviews', path: '/admin/reviews', label: msg('Reviews') },
	{
		id: 'early-access',
		path: '/admin/early-access',
		label: msg('Early access'),
	},
	{
		id: 'contact-requests',
		path: '/admin/contact-requests',
		label: msg('Contact requests'),
	},
	{
		id: 'catalog-orders',
		path: ADMIN_CATALOG_ORDERS_PATH,
		label: msg('Catalog orders'),
	},
	{ id: 'flags', path: '/admin/flags', label: msg('Feature flags') },
] as const;
export type AdminSection = (typeof sections)[number]['id'];

/** Shared navigation is presentation only: every page retains its server-authorized query and error handling. */
export function AdminPage({
	section,
	title,
	description,
	children,
	refreshing,
	onRefresh,
}: {
	section: AdminSection;
	title: string;
	description?: string;
	children: ReactNode;
	refreshing?: boolean;
	onRefresh?: () => void;
}) {
	useI18n();
	const navigate = useNavigate();
	return (
		<section className="admin-workspace">
			<title>{pageTitle(title)}</title>
			<header className="admin-page-heading">
				<div>
					<p className="admin-eyebrow">{t('Administration')}</p>
					<div className="admin-page-title">
						<span>
							<ShieldCheckIcon size={22} />
						</span>
						<h1>{title}</h1>
					</div>
					{description && (
						<p className="admin-description">{description}</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/apps"
						className={buttonVariants({
							variant: 'ghost',
							size: 'sm',
						})}
					>
						<ArrowLeftIcon size={16} />
						{t('My stores')}
					</Link>
					{onRefresh && (
						<Button
							size="sm"
							variant="secondary"
							disabled={refreshing}
							loading={refreshing}
							onClick={onRefresh}
						>
							<ArrowClockwiseIcon size={16} />
							{t('Refresh')}
						</Button>
					)}
				</div>
			</header>
			<nav
				className="admin-navigation"
				aria-label={t('Administration navigation')}
			>
				<Tabs
					variant="underline"
					value={section}
					onValueChange={(value) => {
						const target = sections.find(
							(item) => item.id === value,
						);
						if (target) navigate(target.path);
					}}
					tabs={sections.map((item) => ({
						value: item.id,
						label: t(item.label),
					}))}
				/>
			</nav>
			<div className="admin-page-content">{children}</div>
		</section>
	);
}

export function AdminPanel({
	title,
	description,
	actions,
	children,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="admin-panel">
			<header className="admin-panel-heading">
				<div>
					<h2>{title}</h2>
					{description && <p>{description}</p>}
				</div>
				{actions}
			</header>
			<div className="admin-panel-content">{children}</div>
		</section>
	);
}

/** One contained toolbar and horizontal scroll area for all administrative datasets. */
export function AdminTablePanel({
	title,
	count,
	actions,
	children,
}: {
	title: string;
	count?: number;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="admin-panel">
			<header className="admin-panel-heading">
				<h2>{title}</h2>
				<div className="flex flex-wrap items-center gap-3">
					{count !== undefined && (
						<span className="text-xs text-kumo-subtle">
							{tn('{count} record', '{count} records', count)}
						</span>
					)}
					{actions}
				</div>
			</header>
			<div className="admin-table-scroll">{children}</div>
		</section>
	);
}
export { Table };
