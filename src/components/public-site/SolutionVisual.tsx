import { t } from '@/lib/i18n';
import { CheckCircleIcon, CheckIcon, DownloadSimpleIcon, GlobeIcon, PackageIcon, SparkleIcon } from '@phosphor-icons/react';
import type { SolutionVisualId } from '@/content/solution-landings';
import { marketingCopy } from '@/content/marketing-copy';
import { PHOTOS } from './art-styles';

const PRODUCTS = [
	{ name: 'Trail essentials', image: PHOTOS.daypack },
	{ name: 'Everyday carry', image: PHOTOS.bottle },
	{ name: 'Small discoveries', image: PHOTOS.compass },
];

/** Illustrative product UI, not a live dashboard or a customer result. */
export function SolutionVisual({ kind, concept = false }: { kind: SolutionVisualId; concept?: boolean }) {
	if (kind === 'community') return <CommunitySubscriptionPreview />;
	return (
		<div
			aria-hidden="true"
			className="relative flex min-h-64 w-full items-center justify-center overflow-hidden bg-[#e9eeea] p-5 sm:min-h-80 sm:p-8"
		>
			<div className="absolute -right-16 -top-24 size-80 rounded-full bg-white/40 blur-2xl" />
			<div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-black/10 bg-white text-[#22362c] shadow-[0_20px_60px_-25px_#203d3766]">
				<div className="flex items-center justify-between border-b border-black/5 px-4 py-3 text-[10px] uppercase tracking-[0.16em]">
					<span className="flex gap-1">
						<i className="size-1.5 rounded-full bg-[#c4cfc7]" />
						<i className="size-1.5 rounded-full bg-[#c4cfc7]" />
						<i className="size-1.5 rounded-full bg-[#c4cfc7]" />
					</span>
					<span>{concept ? t('Concept preview') : t('Example store')}</span>
					<span>estori.</span>
				</div>
				{kind === 'store' && (
					<div className="p-4 sm:p-6">
						<div className="flex justify-between text-[10px]">
							<strong className="font-serif text-lg">Fieldwork</strong>
							<span>{t("Shop · Our story · Bag")}</span>
						</div>
						<div className="my-5 rounded-lg bg-[#eef0e6] p-5">
							<p className="text-[10px] uppercase tracking-widest">{t("Made for the everyday")}</p>
							<p className="mt-2 max-w-64 font-serif text-3xl leading-tight sm:text-4xl">{t("Good things.")}<br />{t("Great adventures.")}</p>
						</div>
						<div className="grid grid-cols-3 gap-3">
							{PRODUCTS.map((p) => (
								<div key={p.name}>
									<img
										src={p.image}
										alt=""
										loading="lazy"
										width={160}
										height={110}
										className="aspect-[4/3] w-full rounded-md object-cover"
									/>
									<p className="mt-2 text-[10px]">{t(p.name)}</p>
								</div>
							))}
						</div>
					</div>
				)}
				{kind === 'catalog' && (
					<div className="p-5">
						<p className="text-xl">{t("Your next collection")}</p>
						<p className="mt-1 text-xs text-[#69786d]">{t("Explore products for your store")}</p>
						<div className="mt-5 grid grid-cols-3 gap-3">
							{PRODUCTS.map((p) => (
								<div key={p.name} className="rounded-lg border border-black/5 p-2">
									<img src={p.image} alt="" width={160} height={160} loading="lazy" className="aspect-square rounded-md object-cover" />
									<p className="mt-2 text-[10px]">{t(p.name)}</p>
									<span className="mt-3 block rounded-full bg-[#edf3ed] py-1 text-center text-[9px]">{t("Explore product")}</span>
								</div>
							))}
						</div>
					</div>
				)}
				{kind === 'editor' && (
					<div className="space-y-5 p-5 sm:p-8">
						<div className="ml-8 rounded-2xl rounded-br-sm bg-[#edf1e8] p-4 text-sm">{t("Give my homepage a warmer look and put our new collection first.")}</div>
						<div className="flex gap-3">
							<SparkleIcon className="mt-1 size-5 shrink-0" />
							<div>
								<p className="text-sm">{t("Let’s make it feel like your brand.")}</p>
								<div className="mt-3 flex gap-2">
									<span className="size-6 rounded-full bg-[#d3c3a5]" />
									<span className="size-6 rounded-full bg-[#47664e]" />
									<span className="size-6 rounded-full bg-[#efede5]" />
								</div>
								<p className="mt-4 flex items-center gap-2 text-xs">
									<CheckIcon />{t(" Preview ready to review")}</p>
							</div>
						</div>
					</div>
				)}
				{kind === 'orders' && (
					<div className="p-5 sm:p-7">
						<p className="text-xl">{t("Every order, in view.")}</p>
						<div className="mt-5 divide-y divide-black/5">
							{[
								['#1042', 'New order'],
								['#1041', 'Preparing'],
								['#1040', 'Shipped'],
							].map(([id, status]) => (
								<div key={id} className="flex items-center gap-3 py-4">
									<span className="rounded-lg bg-[#edf1e8] p-2">
										<PackageIcon className="size-5" />
									</span>
									<span className="flex-1 text-sm">{id}</span>
									<span className="rounded-full bg-[#eef4ec] px-3 py-1 text-[10px]">{t(status)}</span>
								</div>
							))}
						</div>
					</div>
				)}
				{kind === 'translation' && (
					<div className="p-6 sm:p-8">
						<GlobeIcon className="size-7" />
						<p className="mt-4 font-serif text-3xl">{t("Your store. Their language.")}</p>
						<div className="mt-6 grid gap-3">
							{['A little something for every day.', 'Algo especial para cada día.', 'Um toque especial para cada dia.'].map((text) => (
								<p key={text} className="rounded-lg border border-black/5 p-3 text-xs">
									{text}
								</p>
							))}
						</div>
					</div>
				)}
				{kind === 'downloads' && (
					<div className="p-6 sm:p-8">
						<p className="font-serif text-3xl">{t("The resource shelf")}</p>
						<p className="mt-2 text-xs text-[#69786d]">{t("A home for what you know.")}</p>
						<div className="mt-5 space-y-3">
							{[
								['The weekend guide', 'PDF guide'],
								['Your creative toolkit', 'Resource pack'],
								['A new perspective', 'Video lessons'],
							].map(([title, type]) => (
								<div key={title} className="flex items-center gap-3 rounded-lg border border-black/5 p-3">
									<DownloadSimpleIcon className="size-6" />
									<span className="text-xs">
										{t(title)}
										<small className="mt-1 block text-[#69786d]">{t(type)}</small>
									</span>
								</div>
							))}
						</div>
					</div>
				)}
				{kind === 'subscription' && (
					<div className="p-6 sm:p-8">
						<p className="font-serif text-3xl">{t("Something to look forward to.")}</p>
						<div className="mt-5 flex items-center gap-4">
							<img src={PHOTOS.houseBlend} alt="" width={110} height={110} loading="lazy" className="size-24 rounded-lg object-cover" />
							<div>
								<p className="text-sm">{t("The coffee collection")}</p>
								<p className="mt-1 text-xs text-[#69786d]">{t("Your next delivery, your way.")}</p>
							</div>
						</div>
						<div className="mt-5 grid grid-cols-2 gap-2 text-center text-xs">
							<span className="rounded-lg border border-[#395a43] bg-[#eef3e9] p-3">{t("Every month")}</span>
							<span className="rounded-lg border border-black/10 p-3">{t("Every two weeks")}</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/** A decorative subscription confirmation inspired by creator recommendation pages. */
function CommunitySubscriptionPreview() {
	const copy = marketingCopy.solutions.communities.subscriptionPreview;
	return (
		<div
			aria-hidden="true"
			className="relative flex min-h-80 w-full items-center justify-center overflow-hidden bg-public-brand p-5 sm:min-h-[420px] sm:p-10"
		>
			<div className="public-grain pointer-events-none absolute inset-0 opacity-[0.08]" />
			<div className="relative w-full max-w-xl rounded-2xl border border-white/80 bg-white p-5 text-[#182522] shadow-[0_24px_70px_-24px_#001b2c99] sm:p-8">
				<div className="flex items-start gap-3 sm:gap-4">
					<CheckCircleIcon className="mt-0.5 size-7 shrink-0 text-[#2c9a58] sm:size-8" weight="regular" />
					<div className="@container min-w-0 flex-1">
						<p className="whitespace-nowrap text-[clamp(0.625rem,7.5cqi,1.875rem)] font-semibold leading-tight tracking-tight">{t(copy.title)}</p>
						<p className="mt-3 text-sm leading-relaxed text-[#69736f] sm:text-base">{t(copy.description)}</p>
					</div>
				</div>
				<div className="mt-7 divide-y divide-[#e5e9e7] border-y border-[#e5e9e7]">
					<div className="flex items-center gap-4 py-5 sm:gap-5 sm:py-6">
						<img
							src="/marketing/communities/home-creator-types-04.avif"
							alt=""
							width={1600}
							height={1894}
							loading="lazy"
							className="size-14 shrink-0 rounded-full object-cover object-[center_25%] sm:size-20"
						/>
						<div className="min-w-0">
							<p className="text-sm font-semibold sm:text-lg">{t(copy.creatorTitle)}</p>
							<p className="mt-1 text-xs leading-relaxed text-[#69736f] sm:text-sm">{t(copy.creatorDescription)}</p>
						</div>
					</div>
					<div className="flex items-center gap-4 py-5 sm:gap-5 sm:py-6">
						<span className="grid size-14 shrink-0 place-items-center rounded-full bg-public-blue/10 sm:size-20">
							<SparkleIcon className="size-6 text-public-blue sm:size-8" />
						</span>
						<div className="min-w-0">
							<p className="text-sm font-semibold sm:text-lg">{t(copy.recommendationTitle)}</p>
							<p className="mt-1 text-xs leading-relaxed text-[#69736f] sm:text-sm">{t(copy.recommendationDescription)}</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
