import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { COMPANY_SIZES, CONTACT_FIELD_LIMITS, CONTACT_TOPICS, isCompanySize, isContactTopic, type ContactRequestBody } from '@/api-types';
import { pillClass } from '@/components/public-site/primitives';
import { useSubmitContact } from '@/hooks/use-contact';
import { contactPrefill } from '@/lib/contact';
import { formatCredits } from '@/lib/plans';
import { cn } from '@/lib/utils';

const LABEL = 'text-[12px] font-medium tracking-[0.06em] text-public-ink uppercase';
const INPUT =
	'mt-2 block w-full rounded-[10px] border border-[#c9ced8] bg-white px-4 py-3 text-[15px] text-public-ink outline-none transition-shadow placeholder:text-[#9aa3b2] focus:border-public-blue focus:ring-2 focus:ring-public-blue/25';

function Field({ label, required, children, className }: { label: string; required?: boolean; children: (id: string) => ReactNode; className?: string }) {
	const id = useId();
	return (
		<div className={className}>
			<label htmlFor={id} className={LABEL}>
				{label}
				{required && <span aria-hidden> *</span>}
			</label>
			{children(id)}
		</div>
	);
}

/** 1Password's contact form: first and last name, work email, company, size, topic and a message, with a confirmation once sent. */
export function ContactForm() {
	const location = useLocation();
	const prefill = contactPrefill(location.search);
	const submit = useSubmitContact();
	const [topic, setTopic] = useState<string>(prefill.topic ?? '');
	const [sent, setSent] = useState<{ firstName: string; email: string } | null>(null);
	const confirmationRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (sent) confirmationRef.current?.focus();
	}, [sent]);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const text = (name: string) => String(data.get(name) ?? '');
		const companySize = text('companySize');
		const chosenTopic = text('topic');
		if (!isCompanySize(companySize) || !isContactTopic(chosenTopic)) return;
		const body: ContactRequestBody = {
			firstName: text('firstName'),
			lastName: text('lastName'),
			email: text('email'),
			company: text('company'),
			companySize,
			topic: chosenTopic,
			message: text('message'),
			premiumCredits: chosenTopic === 'premium' ? prefill.premiumCredits : null,
			website: text('website'),
		};
		submit.mutate(body, { onSuccess: () => setSent({ firstName: body.firstName.trim(), email: body.email.trim() }) });
	};

	if (sent) {
		return (
			<div ref={confirmationRef} tabIndex={-1} role="status" className="scroll-mt-36 rounded-[25px] bg-[#f4f6fb] p-8 outline-none sm:p-10">
				<CheckCircleIcon weight="fill" className="size-10 text-[#16a34a]" aria-hidden />
				<h2 className="mt-5 text-3xl font-light tracking-[-0.02em] text-public-ink">Thanks, {sent.firstName}. We got your message.</h2>
				<p className="mt-4 text-[17px] font-light text-public-muted">
					We've emailed {sent.email} a confirmation, and we'll be in touch soon.
				</p>
				<Link to="/pricing" className="mt-8 inline-block text-[15px] text-public-ink underline underline-offset-[5px]">
					Back to pricing
				</Link>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} className="relative rounded-[25px] bg-[#f4f6fb] p-8 sm:p-10">
			<h2 className="text-3xl leading-[1.15] font-light tracking-[-0.02em] text-balance text-public-ink">Talk to the Estori team</h2>
			<div className="mt-8 grid gap-5 sm:grid-cols-2">
				<Field label="First name" required>
					{(id) => <input id={id} name="firstName" required maxLength={CONTACT_FIELD_LIMITS.name} autoComplete="given-name" className={INPUT} />}
				</Field>
				<Field label="Last name" required>
					{(id) => <input id={id} name="lastName" required maxLength={CONTACT_FIELD_LIMITS.name} autoComplete="family-name" className={INPUT} />}
				</Field>
				<Field label="Work email" required className="sm:col-span-2">
					{(id) => <input id={id} name="email" type="email" required maxLength={CONTACT_FIELD_LIMITS.email} autoComplete="email" className={INPUT} />}
				</Field>
				<Field label="Company" required>
					{(id) => <input id={id} name="company" required maxLength={CONTACT_FIELD_LIMITS.company} autoComplete="organization" className={INPUT} />}
				</Field>
				<Field label="Company size" required>
					{(id) => (
						<select id={id} name="companySize" required defaultValue="" className={cn(INPUT, 'appearance-none')}>
							<option value="" disabled>
								Select…
							</option>
							{COMPANY_SIZES.map((size) => (
								<option key={size} value={size}>
									{size}
								</option>
							))}
						</select>
					)}
				</Field>
				<Field label="What can we help with?" required className="sm:col-span-2">
					{(id) => (
						<select
								id={id}
								name="topic"
								required
								value={topic}
								onChange={(event) => setTopic(event.target.value)}
								className={cn(INPUT, 'appearance-none')}
							>
							<option value="" disabled>
								Select…
							</option>
							{CONTACT_TOPICS.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.label.charAt(0).toUpperCase() + entry.label.slice(1)}
								</option>
							))}
						</select>
					)}
				</Field>
				{topic === 'premium' && prefill.premiumCredits !== null && (
					<p className="-mt-2 text-[14px] text-public-muted sm:col-span-2">
						You picked Premium with {formatCredits(prefill.premiumCredits)} AI credits a month.
					</p>
				)}
				<Field label="Message" className="sm:col-span-2">
					{(id) => (
						<textarea
							id={id}
							name="message"
							rows={4}
							maxLength={CONTACT_FIELD_LIMITS.message}
							placeholder="Tell us about your stores and what you need"
							className={cn(INPUT, 'resize-y')}
						/>
					)}
				</Field>
				{/* Honeypot: hidden from people, keyboards and screen readers, so only bots fill it in. */}
				<div aria-hidden className="absolute -left-[10000px] size-px overflow-hidden">
					<label>
						Website
						<input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
					</label>
				</div>
			</div>
			{submit.error && (
				<p role="alert" className="mt-6 rounded-[10px] bg-[#fdecec] px-4 py-3 text-[14px] text-[#b42318]">
					{submit.error.message}
				</p>
			)}
			<p className="mt-6 text-[13px] text-public-muted">
				We'll use these details to reply to you. See our{' '}
				<Link to="/privacy" className="underline underline-offset-4">
					privacy policy
				</Link>
				.
			</p>
			<button type="submit" disabled={submit.isPending} className={pillClass('blue', 'mt-6 w-full disabled:cursor-wait disabled:opacity-70 sm:w-auto')}>
				{submit.isPending ? 'Sending…' : 'Send message'}
			</button>
		</form>
	);
}
