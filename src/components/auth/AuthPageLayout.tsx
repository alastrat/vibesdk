import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { PageMeta } from '@/components/public-site/solution-page';
import { AuthPhoto, type PhotoView } from './AuthPhoto';

/**
 * The sign-up and sign-in pages: the view's photo filling the left half on wide screens, and on the right the logo
 * (back to the home page) above the heading and form, centred.
 */
export function AuthPageLayout({
	view,
	pageTitle,
	title,
	description,
	children,
}: {
	view: PhotoView;
	pageTitle: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-svh bg-kumo-base font-public text-kumo-default">
			<PageMeta title={pageTitle} description={description} />
			<AuthPhoto view={view} className="hidden lg:block lg:w-1/2" />
			<main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 sm:px-12 sm:py-8">
				<Link to="/" aria-label="Estori home" className="w-fit text-public-brand dark:text-white">
					<EstoriLogo className="h-7 w-auto" />
				</Link>
				<div className="mx-auto my-auto w-full max-w-[26rem] py-10">
					<h1 className="text-[32px] leading-tight font-normal tracking-[-0.02em]">{title}</h1>
					<p className="mt-2 text-[15px] text-kumo-subtle">{description}</p>
					{children}
				</div>
			</main>
		</div>
	);
}
