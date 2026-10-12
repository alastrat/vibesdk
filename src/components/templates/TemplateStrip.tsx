import { useNavigate } from 'react-router';
import { useTemplateGallery } from '@/hooks/use-templates';
import { TemplateCard } from './TemplateCard';

/** "Start from a template" row under the home prompt; hidden until templates exist. */
export function TemplateStrip() {
	const navigate = useNavigate();
	const gallery = useTemplateGallery({ category: null, search: '', limit: 6 });
	const templates = gallery.data?.pages[0]?.templates ?? [];
	if (templates.length === 0) return null;

	return (
		<section className="mt-8 grid gap-3" aria-label="Start from a template">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-kumo-default">Start from a template</h2>
				<button
					type="button"
					className="text-sm text-kumo-subtle hover:text-kumo-default"
					onClick={() => navigate('/templates')}
				>
					Browse all
				</button>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{templates.map((template) => (
					<TemplateCard
						key={template.id}
						template={template}
						compact
						onOpen={(slug) => navigate(`/templates/${slug}`)}
					/>
				))}
			</div>
		</section>
	);
}
