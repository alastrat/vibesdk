import { Link } from 'react-router';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { FREE_PLAN_ANSWER, PAYMENTS_ANSWER, type FaqItem } from '@/content/positioning';
import { cn } from '@/lib/utils';

const LAUNCH_FAQ: readonly FaqItem[] = [
	{ question: 'Is Estori free?', answer: `Yes. ${FREE_PLAN_ANSWER}` },
	{ question: 'What does Coming soon mean?', answer: "A capability or plan we're building. It isn't part of Estori until it launches, and its details may change before then." },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
	{ question: 'Does Estori take a cut of my store sales?', answer: 'No. When store payments launch, only Stripe charges for card processing.' },
	{ question: 'Who owns the store I build?', answer: 'You do. Keep editing it, keep it private, or publish it to Discover.' },
	{ question: 'What does Estori charge for template sales?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{ question: 'Can I resell a store I bought?', answer: "No. A store you buy is yours to adapt for your own business, but it can't be republished or resold." },
	{
		question: "What if a store I bought doesn't work?",
		answer: (
			<>
				If it can't be used, email us within 14 days and we'll fix it or refund you. See the{' '}
				<Link to="/refunds">
					refund policy
				</Link>
				.
			</>
		),
	},
];

function Question({ item }: { item: FaqItem }) {
	return (
		<details className="group py-7">
			<summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg leading-snug font-medium text-public-ink sm:text-xl [&::-webkit-details-marker]:hidden">
				{item.question}
				<PlusIcon weight="light" className="mt-0.5 size-6 shrink-0 group-open:hidden" aria-hidden />
				<MinusIcon weight="light" className="mt-0.5 hidden size-6 shrink-0 group-open:block" aria-hidden />
			</summary>
			<p className="mt-5 max-w-xl text-[15px] leading-relaxed text-public-ink/80 [&_a]:text-public-blue [&_a]:underline [&_a]:underline-offset-4">
				{item.answer}
			</p>
		</details>
	);
}

/**
 * 1Password's FAQ: a lavender panel with a big heading, then the questions in two columns of plus and minus rows. The
 * launch questions by default, or a page's own; `leading` puts a page's questions before the launch ones.
 */
export function PublicFaq({ items = LAUNCH_FAQ, leading = [] }: { items?: readonly FaqItem[]; leading?: readonly FaqItem[] }) {
	const questions = [...leading, ...items];
	const half = Math.ceil(questions.length / 2);
	// Down the left column, then the right, so reading order matches what people see.
	const columns = [questions.slice(0, half), questions.slice(half)];
	return (
		<section aria-labelledby="faq-title" className="bg-white px-3 py-6 sm:px-6">
			<div className="mx-auto max-w-[1392px] rounded-[25px] bg-[#e4e8f8] px-6 py-16 sm:px-12 sm:py-20 lg:px-[72px] lg:py-28">
				<h2 id="faq-title" className="text-4xl leading-[1.1] font-normal tracking-[-0.02em] text-public-ink sm:text-5xl lg:text-[64px]">
					Frequently asked questions
				</h2>
				<div className="mt-12 grid gap-x-12 lg:mt-16 lg:grid-cols-2">
					{columns.map((column, index) => (
						// Stacked on phones, the first column's bottom line would double the second's top one.
						<div key={index} className={cn('divide-y divide-public-ink/60 border-y border-public-ink/60', index === 0 && 'max-lg:border-b-0')}>
							{column.map((item) => (
								<Question key={item.question} item={item} />
							))}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
