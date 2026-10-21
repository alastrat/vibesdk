import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { PageMeta } from '@/components/public-site/solution-page';
import { AuthPhoto, type PhotoView } from './AuthPhoto';
import { LanguagePicker } from './LanguagePicker';

/**
 * The sign-up and sign-in pages: the view's photo filling the left half on wide screens, and on the right the logo
 * (back to the home page) above the heading and form. The logo sits centred on smaller screens and at the right on wide
 * ones, away from the photo. The language picker sits under the logo on smaller screens and opposite it on wide ones.
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
			<main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 sm:px-12 sm:py-8">
				<Link to="/" aria-label="Estori home" className="self-center text-public-brand lg:self-end dark:text-white">
					<EstoriLogo className="h-7 w-auto" />
				</Link>
				<div className="mt-3 self-center lg:absolute lg:left-12 lg:top-8 lg:mt-0">
					<LanguagePicker />
				</div>
				<div className="mx-auto my-auto w-full max-w-[26rem] py-10">
					<h1 className="text-[32px] leading-tight font-normal tracking-[-0.02em]">{title}</h1>
					<p className="mt-2 text-[15px] text-kumo-subtle">{description}</p>
					{children}
				</div>
			</main>
		</div>
	);
}
