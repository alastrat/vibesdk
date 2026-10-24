import { t } from '@/lib/i18n';
import type { ReactNode } from 'react';
import { ChatCircleTextIcon, EnvelopeSimpleIcon, StorefrontIcon, type Icon } from '@phosphor-icons/react';
import { EstoriLogo } from '@/brand';
import { ContactForm } from '@/components/contact/ContactForm';
import { GlobeWalk } from '@/components/contact/GlobeWalk';
import { Eyebrow, HEADING_HERO, LEAD } from '@/components/public-site/primitives';
import { PageMeta } from '@/components/public-site/solution-page';
import { CONTACT_PAGE } from '@/content/public-pages';
import { cn } from '@/lib/utils';

function NextStep({ icon: Glyph, title, children }: { icon: Icon; title: string; children: ReactNode }) {
	return (
		<li className="flex gap-4">
			<span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-public-blue">
				<Glyph className="size-5" aria-hidden />
			</span>
			<span>
				<span className="block text-[17px] text-public-ink">{t(title)}</span>
				<span className="mt-1 block text-[15px] font-light text-public-muted">{children}</span>
			</span>
		</li>
	);
}

/** 1Password's contact-sales page: the pitch beside the form, then the walk toward the globe with a word from the team. */
export default function ContactPage() {
	return (
		<div>
			<PageMeta {...CONTACT_PAGE} />
			<section className="bg-white px-4 pt-16 pb-16 sm:px-6 sm:pt-24 sm:pb-20">
				<div className="mx-auto grid max-w-[1248px] grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
					<div>
						<Eyebrow>{t("Contact sales")}</Eyebrow>
						<h1 className={cn(HEADING_HERO, 'mt-4 text-balance text-public-ink sm:text-[72px]')}>{t("Let's grow your stores together")}</h1>
						<p className={cn(LEAD, 'mt-6 max-w-xl text-pretty text-public-muted')}>{t("Running many stores, or need more credits than Premium? Tell us about your business and we'll help you pick the right plan.")}</p>
						<div className="mt-10 rounded-[25px] bg-[#e6f6f1] p-8">
							<h2 className="text-[13px] font-medium tracking-[0.06em] text-public-ink uppercase">{t("What happens next")}</h2>
							<ul className="mt-6 grid gap-6">
								<NextStep icon={EnvelopeSimpleIcon} title={t("We read every request")}>{t("A person on the Estori team reads yours, and you get an email confirming we have it.")}</NextStep>
								<NextStep icon={ChatCircleTextIcon} title={t("We reply by email")}>{t("With answers to your questions and the plan that fits your stores.")}</NextStep>
								<NextStep icon={StorefrontIcon} title={t("We help you get started")}>{t("From sizing your credits to building your first store with the AI.")}</NextStep>
							</ul>
						</div>
					</div>
					<ContactForm />
				</div>
			</section>
			<section className="bg-white px-3 pb-6 sm:px-6">
				<div className="mx-auto grid max-w-[1392px] overflow-hidden rounded-[25px] lg:grid-cols-2">
					<GlobeWalk className="aspect-square w-full lg:aspect-auto lg:h-full lg:min-h-[560px]" />
					<div className="flex flex-col justify-between gap-12 bg-[#e4e8f8] p-8 sm:p-14">
						<EstoriLogo className="h-9 w-auto self-start text-public-brand" />
						<div>
							<p className="text-3xl leading-[1.25] font-light tracking-[-0.01em] text-balance text-public-ink sm:text-[40px]">{t("Tell us what you sell. We'll help you build the store, launch it and keep it growing.")}</p>
							<p className="mt-8 text-[15px] text-public-ink">{t("The Estori team")}</p>
							<p className="text-[15px] font-light text-public-muted">{t("We reply to every request.")}</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
