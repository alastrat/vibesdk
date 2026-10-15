import { Cloud, CloudLaptop } from '@/components/public-site/CloudLaptop';
import { HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

/** 1Password's closing panel: big words on the left, a laptop on a cloud on the right, clouds drifting at the corners. */
export function ClosingPanel() {
	return (
		<section className="bg-white px-3 pb-6 sm:px-6">
			<div className="relative mx-auto grid max-w-[1392px] items-center gap-6 overflow-hidden rounded-[25px] bg-[#dce9fc] px-6 pt-16 pb-6 sm:px-12 lg:grid-cols-2 lg:py-20 lg:pl-20">
				<Cloud className="pointer-events-none absolute -bottom-16 -left-20 w-[320px] sm:-bottom-20 sm:w-[440px]" />
				<Cloud className="pointer-events-none absolute top-6 -right-12 w-[180px] [animation-delay:-8s] sm:w-[260px]" />
				<div className="relative z-10">
					<h2 className={cn(HEADING_SECTION, 'max-w-xl text-balance text-public-ink')}>Your next store starts with a sentence.</h2>
					<p className={cn(LEAD, 'mt-5 max-w-md text-public-ink/75')}>Describe it, watch it build, and publish it when it's ready.</p>
					<div className="mt-10 flex flex-wrap gap-3">
						<PillLink to="/signup" variant="blue">
							Start building free
						</PillLink>
						<PillLink to="/pricing" variant="outline-on-light">
							View pricing
						</PillLink>
					</div>
				</div>
				<CloudLaptop />
			</div>
		</section>
	);
}
