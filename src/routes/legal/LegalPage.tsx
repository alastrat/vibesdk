import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { Eyebrow } from '@/components/public-site/primitives';
import { PageMeta } from '@/components/public-site/solution-page';
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/content/legal/legal-documents';
import { legalPage } from '@/content/public-pages';

/** A legal text in a narrow reading column, like 1Password's Legal Center. */
export function LegalPage({ slug }: { slug: LegalSlug }) {
	const document = LEGAL_DOCUMENTS[slug];
	return (
		<article className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-24">
			<PageMeta {...legalPage(slug)} />
			<Eyebrow>Legal</Eyebrow>
			<h1 className="mt-4 text-4xl leading-[1.1] font-light tracking-[-0.02em] text-public-ink sm:text-5xl">{document.title}</h1>
			<p className="mt-4 text-sm text-public-muted">
				Version {document.version} · Last updated {document.updated}
			</p>
			<div className="prose prose-neutral mt-10 max-w-none text-[17px] leading-[1.7] font-light text-public-ink prose-headings:font-normal prose-headings:tracking-[-0.01em] prose-headings:text-public-ink prose-a:text-public-blue prose-a:underline-offset-4 prose-strong:font-medium prose-li:marker:text-public-muted">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }]]}>
					{document.body}
				</ReactMarkdown>
			</div>
		</article>
	);
}
