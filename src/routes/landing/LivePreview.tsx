import { Iphone } from '@/components/magicui/iphone';
import { Safari } from '@/components/magicui/safari';
import { BlurFade } from '@/components/magicui/blur-fade';
import { Eyebrow, LEAD, PillLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

/** A store built on Estori on desktop and phone, bundled so the section never depends on Discover. The frames size to their wrapper, since they don't merge a className's width or position. */
const PREVIEW_DESKTOP_IMAGE = '/marketing/preview-desktop.jpg';
const PREVIEW_PHONE_IMAGE = '/marketing/preview-phone.jpg';

/** 1Password's customer-story layout, used for the live preview since Estori shows no testimonials. */
export function LivePreview() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
				<div aria-hidden className="relative overflow-hidden rounded-[25px] bg-[linear-gradient(160deg,#f4efe6,#e7ddcc)] px-6 pt-10 pb-16 sm:px-10">
					<div className="w-[88%] leading-none">
						<Safari url="Live preview" imageSrc={PREVIEW_DESKTOP_IMAGE} />
					</div>
					<div className="absolute right-6 -bottom-8 w-[26%] leading-none">
						<Iphone src={PREVIEW_PHONE_IMAGE} />
					</div>
				</div>
				<div>
					<Eyebrow>Live preview</Eyebrow>
					<h2 className="mt-4 text-3xl leading-[1.22] font-light tracking-[-0.015em] text-public-ink sm:text-[40px]">
						See every change on desktop and phone before you share it.
					</h2>
					<p className={cn(LEAD, 'mt-5 text-public-muted')}>Every store in Discover was built and published on Estori.</p>
					<PillLink to="/discover" variant="outline-on-light" className="mt-8">
						Browse Discover
					</PillLink>
				</div>
			</BlurFade>
		</section>
	);
}
