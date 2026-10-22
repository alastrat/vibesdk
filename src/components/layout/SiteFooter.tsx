import { marketingCopy } from '@/content/marketing-copy';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';

const LINK_COLUMNS = [
	{
		title: marketingCopy.footer.solutions.title,
		links: [
			{ to: '/solutions/brands', label: marketingCopy.footer.solutions.links.brands },
			{ to: '/solutions/resellers', label: marketingCopy.footer.solutions.links.resellers },
			{ to: '/solutions/digital', label: marketingCopy.footer.solutions.links.digital },
			{ to: '/industries', label: marketingCopy.footer.solutions.links.industries },
			{ to: '/agentic-commerce', label: marketingCopy.footer.solutions.links['agentic-commerce'] },
			{ to: '/pricing', label: marketingCopy.footer.solutions.links.pricing },
			{ to: '/contact', label: marketingCopy.footer.solutions.links.contact },
			{ to: '/blog', label: marketingCopy.footer.solutions.links.blog },
		],
	},
	{
		title: marketingCopy.footer.creators.title,
		links: [
			{ to: '/creators/developers', label: marketingCopy.footer.creators.links.developers },
			{ to: '/creators/content', label: marketingCopy.footer.creators.links.content },
			{ to: '/discover', label: marketingCopy.footer.creators.links.discover },
		],
	},
] as const;

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<h2 className="text-[15px] font-medium">{title}</h2>
			<ul className="mt-4 grid gap-3 text-[15px] font-light text-white/75">{children}</ul>
		</div>
	);
}

/** Dark footer of every public page, as on 1Password: link columns, contacts, a large wordmark and the legal line. */
export function SiteFooter() {
	return (
		<footer className="bg-public-charcoal text-white">
			<div className="mx-auto max-w-[1296px] px-4 pt-16 pb-8 sm:px-6">
				<div className="grid grid-cols-2 gap-10 md:grid-cols-4">
					{LINK_COLUMNS.map((column) => (
						<FooterColumn key={column.title} title={column.title}>
							{column.links.map((link) => (
								<li key={link.label}>
									<Link to={link.to} className="hover:text-white">{link.label}</Link>
								</li>
							))}
						</FooterColumn>
					))}
					<FooterColumn title={marketingCopy.footer.legal}>
						{LEGAL_LINKS.map((link) => (
							<li key={link.slug}>
								<Link to={link.path} className="hover:text-white">{link.label}</Link>
							</li>
						))}
					</FooterColumn>
					<FooterColumn title={marketingCopy.footer.contact}>
						{Object.values(LEGAL_CONTACT).map((address) => (
							<li key={address}>
								<a href={`mailto:${address}`} className="[overflow-wrap:anywhere] hover:text-white">{address}</a>
							</li>
						))}
					</FooterColumn>
				</div>
				<EstoriLogo className="mt-16 h-14 w-auto text-white sm:h-[76px]" />
				<div className="mt-6 flex flex-col gap-4 border-t border-white/15 pt-6 text-[13px] text-white/70 md:flex-row md:items-center md:justify-between">
					<nav aria-label={marketingCopy.footer.legal} className="flex flex-wrap gap-x-5 gap-y-2">
						{LEGAL_LINKS.map((link) => (
							<Link key={link.slug} to={link.path} className="hover:text-white">{link.label}</Link>
						))}
					</nav>
					<p>
						© {new Date().getFullYear()} {LEGAL_ENTITY.name} · {legalAddressLine()}
					</p>
				</div>
			</div>
		</footer>
	);
}
