import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, cn, Empty, Input, Loader } from '@cloudflare/kumo';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { BrandEmphasisIcon } from '@/components/shared/BrandEmphasisIcon';
import { TemplateCard } from '@/components/templates/TemplateCard';
import { useTemplateGallery } from '@/hooks/use-templates';
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '@/api-types';

export default function TemplatesPage() {
	const navigate = useNavigate();
	const [category, setCategory] = useState<TemplateCategory | null>(null);
	const [searchInput, setSearchInput] = useState('');
	const [search, setSearch] = useState('');
	const gallery = useTemplateGallery({ category, search, limit: 24 });
	const templates = gallery.data?.pages.flatMap((page) => page.templates) ?? [];

	return (
		<div className="size-full">
			<title>{pageTitle('Templates')}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8">
				<div className="mb-8 mt-6">
					<h1 className="flex items-center gap-2 text-6xl font-funky-mono font-bold mb-3 text-brand-emphasis">
						<BrandEmphasisIcon icon={SquaresFourIcon} weight="duotone" />
						Templates
					</h1>
					<p className="text-kumo-subtle text-lg font-funky-mono tracking-tight">
						Start from a site that already works, then make it yours
					</p>
				</div>

				<form
					className="mb-4 flex max-w-md gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setSearch(searchInput.trim());
					}}
				>
					<Input
						aria-label="Search templates"
						placeholder="Search templates..."
						value={searchInput}
						onChange={(event) => setSearchInput(event.target.value)}
					/>
					<Button type="submit" variant="secondary">
						Search
					</Button>
				</form>

				<div className="mb-8 flex flex-wrap gap-2">
					<CategoryChip label="All" active={category === null} onClick={() => setCategory(null)} />
					{TEMPLATE_CATEGORIES.map((value) => (
						<CategoryChip
							key={value}
							label={TEMPLATE_CATEGORY_LABELS[value]}
							active={category === value}
							onClick={() => setCategory(value)}
						/>
					))}
				</div>

				{gallery.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : gallery.isError ? (
					<Empty title="Templates didn't load" description={gallery.error.message} />
				) : templates.length === 0 ? (
					<Empty
						icon={<SquaresFourIcon size={40} weight="duotone" className="text-kumo-inactive" />}
						title="No templates yet"
						description="Published templates will show up here."
					/>
				) : (
					<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{templates.map((template) => (
							<TemplateCard
								key={template.id}
								template={template}
								onOpen={(slug) => navigate(`/templates/${slug}`)}
							/>
						))}
					</div>
				)}

				{gallery.hasNextPage && (
					<div className="mt-8 flex justify-center">
						<Button
							variant="secondary"
							loading={gallery.isFetchingNextPage}
							onClick={() => void gallery.fetchNextPage()}
						>
							Load more
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				'rounded-full px-3 py-1 text-sm ring transition',
				active ? 'ring-2 ring-brand font-medium text-kumo-strong' : 'ring-kumo-hairline text-kumo-default hover:bg-kumo-elevated',
			)}
		>
			{label}
		</button>
	);
}
