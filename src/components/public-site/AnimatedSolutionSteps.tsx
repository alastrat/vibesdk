import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

const STEP_DURATION_MS = 4000;
const READING_PAUSE_MS = 2500;

function AnimatedStep({ text, index, phase }: { text: string; index: number; phase: number }) {
	const words = text.split(/\s+/);
	const state = index < phase ? 'complete' : index === phase ? 'active' : 'pending';
	return (
		<li data-state={state} className="solution-step">
			<span aria-hidden="true" className="block h-0.5 overflow-hidden bg-[#d9e0d7]">
				<span className="solution-step-fill block size-full origin-left bg-[#426249]" />
			</span>
			<span aria-hidden="true" className="mt-5 block text-sm text-[#56715c]">
				{String(index + 1).padStart(2, '0')}
			</span>
			<h3 className="mt-4 max-w-xs text-2xl font-light leading-snug text-public-ink">
				<span className="sr-only">{text}</span>
				<span aria-hidden="true">
					{words.map((word, wordIndex) => (
						<span
							key={`${wordIndex}-${word}`}
							className="solution-step-word mr-[0.25em] inline-block"
							style={{ '--word-delay': `${(wordIndex * 3000) / words.length}ms` } as CSSProperties}
						>
							{word}
						</span>
					))}
				</span>
			</h3>
		</li>
	);
}

/** Loop the steps in sequence, leaving a reading pause before starting again. */
export function AnimatedSolutionSteps({ steps }: { steps: readonly string[] }) {
	const id = useId();
	const ref = useRef<HTMLElement>(null);
	const [visible, setVisible] = useState(false);
	const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
	const [phase, setPhase] = useState(0);
	const remaining = useRef({ phase: 0, ms: STEP_DURATION_MS });

	useEffect(() => {
		const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => setReducedMotion(preference.matches);
		preference.addEventListener('change', update);
		return () => preference.removeEventListener('change', update);
	}, []);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!visible || reducedMotion || !steps.length) return;
		if (remaining.current.phase !== phase) {
			remaining.current = { phase, ms: phase === steps.length ? READING_PAUSE_MS : STEP_DURATION_MS };
		}
		const startedAt = performance.now();
		const timer = window.setTimeout(() => {
			setPhase((current) => (current + 1) % (steps.length + 1));
		}, remaining.current.ms);
		return () => {
			window.clearTimeout(timer);
			remaining.current.ms = Math.max(0, remaining.current.ms - (performance.now() - startedAt));
		};
	}, [phase, reducedMotion, steps.length, visible]);

	return (
		<section
			ref={ref}
			id="steps"
			aria-labelledby={`${id}-title`}
			data-running={visible && !reducedMotion}
			className="scroll-mt-[calc(var(--public-header-h)+1rem)] border-t border-public-line bg-white px-4 py-14 sm:px-6 sm:py-20"
		>
			<div className="mx-auto max-w-[1248px]">
				<h2 id={`${id}-title`} className="text-xs uppercase tracking-[0.18em] text-public-muted">
					From idea to storefront
				</h2>
				<ol className="mt-8 grid gap-8 md:grid-cols-3">
					{steps.map((text, index) => (
						<AnimatedStep key={text} text={text} index={index} phase={phase} />
					))}
				</ol>
			</div>
		</section>
	);
}
