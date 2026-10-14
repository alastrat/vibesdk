import type { ReactNode } from 'react';

/**
 * The frame of the pages opened from account emails: a centered card on the public layout.
 * app-theme-scope keeps its Kumo components in the app theme under the light public page.
 */
export function AccountEmailCard({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="app-theme-scope mx-auto w-full max-w-md px-4 py-16 sm:px-6 sm:py-24">
			<div className="rounded-3xl bg-kumo-elevated p-6 ring ring-kumo-hairline sm:p-8">
				<h1 className="text-3xl font-light tracking-[-0.025em] text-kumo-strong">{title}</h1>
				<div className="mt-6 grid gap-4">{children}</div>
			</div>
		</section>
	);
}
