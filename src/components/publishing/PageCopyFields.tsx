import { useEffect, useMemo, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { useDraftPageCopy } from '@/hooks/use-site-page';
import {
	EMPTY_PAGE_COPY_FORM,
	fromPageCopyForm,
	isEmptyPageCopyForm,
	toPageCopyForm,
	type PageCopyForm,
} from '@/lib/page-copy-form';
import {
	SITE_PAGE_LIMITS,
	validatePageCopy,
	type SitePageCopy,
	type SitePageField,
} from '@/api-types';

export interface PageCopyState {
	/** The text to save; null saves no text. */
	payload: SitePageCopy | null;
	valid: boolean;
}

interface PageCopyFieldsProps {
	appId: string;
	initialCopy: SitePageCopy | null;
	inReview: boolean;
	/** Saving changed text sends a new version of the paid listing for review. */
	reviewedOnChange: boolean;
	onChange: (state: PageCopyState) => void;
}

interface FieldSpec {
	key: SitePageField;
	label: string;
	hint: string;
	rows: number;
	/** What the counter measures: characters for About, items for the lists. */
	count: (copy: SitePageCopy) => number;
	max: number;
}

const FIELDS: FieldSpec[] = [
	{
		key: 'about',
		label: 'About',
		hint: `Up to ${SITE_PAGE_LIMITS.aboutParagraphs.max} paragraphs, separated by a blank line`,
		rows: 5,
		count: (copy) => copy.about.join('').length,
		max: SITE_PAGE_LIMITS.aboutTotal,
	},
	{
		key: 'features',
		label: 'Features',
		hint: `One per line, ${SITE_PAGE_LIMITS.features.min} to ${SITE_PAGE_LIMITS.features.max}, each up to ${SITE_PAGE_LIMITS.features.each} characters`,
		rows: 4,
		count: (copy) => copy.features.length,
		max: SITE_PAGE_LIMITS.features.max,
	},
	{
		key: 'includes',
		label: "What's included",
		hint: `One per line, as "Name: what it has", name up to ${SITE_PAGE_LIMITS.includes.name} and line up to ${SITE_PAGE_LIMITS.includes.detail} characters`,
		rows: 4,
		count: (copy) => copy.includes.length,
		max: SITE_PAGE_LIMITS.includes.max,
	},
	{
		key: 'madeFor',
		label: 'Made for',
		hint: `One per line, ${SITE_PAGE_LIMITS.madeFor.min} to ${SITE_PAGE_LIMITS.madeFor.max}, each up to ${SITE_PAGE_LIMITS.madeFor.each} characters`,
		rows: 3,
		count: (copy) => copy.madeFor.length,
		max: SITE_PAGE_LIMITS.madeFor.max,
	},
];

/** The product page text: drafted by AI on first open, edited by the creator, checked against the shared limits. */
export function PageCopyFields({ appId, initialCopy, inReview, reviewedOnChange, onChange }: PageCopyFieldsProps) {
	const draft = useDraftPageCopy(appId);
	const [form, setForm] = useState<PageCopyForm>(() => toPageCopyForm(initialCopy));
	const [lastDraft, setLastDraft] = useState<PageCopyForm | null>(null);
	const empty = isEmptyPageCopyForm(form);
	const parsed = useMemo(() => fromPageCopyForm(form), [form]);
	const validation = useMemo(() => validatePageCopy(parsed), [parsed]);

	useEffect(() => {
		if (empty) onChange({ payload: null, valid: true });
		else onChange(validation.ok ? { payload: validation.value, valid: true } : { payload: null, valid: false });
	}, [empty, validation, onChange]);

	const requestDraft = () =>
		draft.mutate(undefined, {
			onSuccess: (result) => {
				const next = toPageCopyForm(result.copy);
				setForm(next);
				setLastDraft(next);
			},
		});

	// Drafts once when the dialog opens for a site without page text.
	useEffect(() => {
		if (!initialCopy) requestDraft();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const redraft = () => {
		const edited = !empty && JSON.stringify(form) !== JSON.stringify(lastDraft ?? EMPTY_PAGE_COPY_FORM);
		if (edited && !window.confirm('Replace your page text with a new draft?')) return;
		requestDraft();
	};

	const edit = (key: keyof PageCopyForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

	const error = !empty && !validation.ok ? validation : null;

	return (
		<div className="grid gap-3 rounded-lg p-3 ring ring-kumo-hairline">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium text-kumo-default">Page</span>
				<Button size="sm" variant="secondary" loading={draft.isPending} onClick={redraft}>
					Redraft with AI
				</Button>
			</div>
			{inReview && <p className="text-xs text-kumo-subtle">Your page text is in review</p>}
			{reviewedOnChange && (
				<p className="text-xs text-kumo-subtle">Changes to the page text go to review with the price.</p>
			)}
			{draft.isPending && <p className="text-xs text-kumo-subtle">Drafting…</p>}
			{draft.isError && <p className="text-xs text-kumo-subtle">{draft.error.message}</p>}
			<label className="grid gap-1">
				<span className="flex justify-between text-xs text-kumo-subtle">
					<span>Tagline</span>
					<span>
						{form.tagline.trim().length}/{SITE_PAGE_LIMITS.tagline}
					</span>
				</span>
				<input
					value={form.tagline}
					readOnly={draft.isPending}
					onChange={(event) => edit('tagline', event.target.value)}
					className="rounded-md bg-kumo-base px-2 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline"
				/>
				{error?.field === 'tagline' && <span className="text-xs text-kumo-danger">{error.error}</span>}
			</label>
			{FIELDS.map((field) => (
				<label key={field.key} className="grid gap-1">
					<span className="flex justify-between text-xs text-kumo-subtle">
						<span>
							{field.label} · {field.hint}
						</span>
						<span>
							{field.count(parsed)}/{field.max}
						</span>
					</span>
					<textarea
						rows={field.rows}
						value={form[field.key]}
						readOnly={draft.isPending}
						onChange={(event) => edit(field.key, event.target.value)}
						className="rounded-md bg-kumo-base px-2 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline"
					/>
					{error?.field === field.key && <span className="text-xs text-kumo-danger">{error.error}</span>}
				</label>
			))}
			{error && error.field === null && <span className="text-xs text-kumo-danger">{error.error}</span>}
		</div>
	);
}
