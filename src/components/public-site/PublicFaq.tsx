import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { Eyebrow } from './primitives';

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
	{ question: 'Is Estori free?', answer: 'Yes. Building, editing and publishing are free within daily limits. Estori only earns a fee when you sell a store design.' },
	{ question: 'Can my store take payments?', answer: 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.' },
	{ question: 'Who owns the store I build?', answer: 'You do. Keep editing it, keep it private, or publish it to Discover.' },
	{ question: 'Can I resell a store I bought?', answer: "No. A store you buy is yours to adapt for your own business, but it can't be republished or resold." },
	{ question: 'What does Estori charge sellers?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{
		question: "What if a store I bought doesn't work?",
		answer: (
			<>
				If it can't be used, email us within 14 days and we'll fix it or refund you. See the{' '}
				<Link to="/refunds" className="underline underline-offset-4">
					refund policy
				</Link>
				.
			</>
		),
	},
];

/** The launch questions, shared by the landing and pricing pages. */
export function PublicFaq() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] gap-10 lg:grid-cols-[1fr_2fr]">
				<div>
					<Eyebrow>FAQ</Eyebrow>
					<h2 className="mt-4 text-4xl leading-[1.1] font-light tracking-[-0.02em] text-public-ink sm:text-5xl">Questions, answered</h2>
				</div>
				<div className="divide-y divide-public-line border-y border-public-line">
					{FAQ.map((item) => (
						<details key={item.question} className="group py-5">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-normal text-public-ink [&::-webkit-details-marker]:hidden">
								{item.question}
								<span className="text-2xl font-light text-public-muted transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden>
									+
								</span>
							</summary>
							<p className="mt-3 max-w-2xl text-base leading-relaxed font-light text-public-muted">{item.answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
