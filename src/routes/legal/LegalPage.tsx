import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { pageTitle } from '@/brand';
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/content/legal/legal-documents';

export function LegalPage({ slug }: { slug: LegalSlug }) {
	const document = LEGAL_DOCUMENTS[slug];
	return (
		<article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
			<title>{pageTitle(document.title)}</title>
			<meta name="description" content={`${document.title} for Estori.`} />
			<p className="text-xs uppercase tracking-[0.18em] text-kumo-subtle">Last updated {document.updated}</p>
			<h1 className="mt-3 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl">{document.title}</h1>
			<div className="prose prose-neutral mt-10 max-w-none dark:prose-invert prose-headings:font-normal prose-headings:tracking-tight prose-a:text-[var(--estori-link)]">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }]]}>
					{document.body}
				</ReactMarkdown>
			</div>
		</article>
	);
}
