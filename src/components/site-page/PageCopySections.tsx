import type { ReactNode } from 'react';
import type { SitePageCopy } from '@/api-types';

interface PageCopySectionsProps {
	copy: SitePageCopy | null;
	/** Shown as About when there is no page text. */
	fallbackDescription: string | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-semibold text-kumo-strong">{title}</h2>
			{children}
		</section>
	);
}

/** Page text rendered as plain text: About, Features, What's included and Made for. */
export function PageCopySections({ copy, fallbackDescription }: PageCopySectionsProps) {
	const about = copy?.about ?? (fallbackDescription ? fallbackDescription.split(/\n\s*\n/).filter(Boolean) : []);
	return (
		<div className="grid gap-8">
			{about.length > 0 && (
				<Section title="About">
					{about.map((paragraph, index) => (
						<p key={index} className="text-sm leading-relaxed text-kumo-default">
							{paragraph}
						</p>
					))}
				</Section>
			)}
			{copy && (
				<Section title="Features">
					<ul className="grid list-disc gap-1.5 pl-5 text-sm text-kumo-default">
						{copy.features.map((feature) => (
							<li key={feature}>{feature}</li>
						))}
					</ul>
				</Section>
			)}
			{copy && (
				<Section title="What's included">
					<dl className="grid gap-3 text-sm">
						{copy.includes.map((item) => (
							<div key={item.name} className="grid gap-0.5">
								<dt className="font-medium text-kumo-default">{item.name}</dt>
								<dd className="text-kumo-subtle">{item.detail}</dd>
							</div>
						))}
					</dl>
				</Section>
			)}
			{copy && (
				<Section title="Made for">
					<ul className="flex flex-wrap gap-2">
						{copy.madeFor.map((item) => (
							<li key={item} className="rounded-full px-3 py-1 text-sm text-kumo-default ring ring-kumo-hairline">
								{item}
							</li>
						))}
					</ul>
				</Section>
			)}
		</div>
	);
}
