import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { LEGAL_CONTACT, LEGAL_ENTITY } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';

export function SiteFooter() {
	return (
		<footer className="border-t border-kumo-line bg-kumo-canvas">
			<div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-[1fr_auto] sm:px-6">
				<div className="grid gap-3">
					<EstoriLogo className="h-5 w-auto text-kumo-strong" />
					<p className="max-w-sm text-sm text-kumo-subtle">Build online stores with AI, and sell them as templates.</p>
					<a href={`mailto:${LEGAL_CONTACT.support}`} className="text-sm text-kumo-default hover:text-kumo-strong">
						{LEGAL_CONTACT.support}
					</a>
				</div>
				<nav className="flex flex-wrap items-start gap-x-6 gap-y-2 text-sm text-kumo-default">
					<Link to="/discover" className="hover:text-kumo-strong">Discover</Link>
					<Link to="/pricing" className="hover:text-kumo-strong">Pricing</Link>
					{LEGAL_LINKS.map((link) => (
						<Link key={link.slug} to={link.path} className="hover:text-kumo-strong">
							{link.label}
						</Link>
					))}
				</nav>
			</div>
			<div className="border-t border-kumo-line">
				<p className="mx-auto max-w-6xl px-4 py-6 text-xs text-kumo-subtle sm:px-6">
					© {new Date().getFullYear()} {LEGAL_ENTITY.name}
				</p>
			</div>
		</footer>
	);
}
