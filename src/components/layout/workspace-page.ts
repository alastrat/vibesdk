import { msg } from '@/lib/i18n';

/** Human page names for the shared workspace breadcrumb. */
export function workspacePageLabel(pathname: string): string {
	if (pathname === '/' || pathname === '/apps') return msg('My stores');
	if (pathname.startsWith('/stores/')) return msg('Store workspace');
	if (pathname.startsWith('/chat/')) return msg('Store builder');
	if (pathname === '/build') return msg('Estori agent');
	if (pathname.startsWith('/app/')) return msg('Store preview');
	if (pathname.startsWith('/settings/billing')) return msg('Plan and billing');
	if (pathname.startsWith('/settings')) return msg('Settings');
	if (pathname.startsWith('/profile')) return msg('Profile');
	if (pathname.startsWith('/catalog')) return msg('Catalog');
	if (pathname.startsWith('/orders/')) return msg('Order');
	if (pathname === '/orders') return msg('Orders');
	if (pathname.startsWith('/discover')) return msg('Discover');
	if (pathname.startsWith('/admin/')) return msg('Administration');
	if (pathname === '/emails') return msg('Emails');
	if (pathname === '/translations') return msg('Translations');
	return msg('Workspace');
}
