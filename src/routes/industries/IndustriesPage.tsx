import { IndustryCards } from '@/components/public-site/IndustryCards';
import { JsonLd } from '@/components/public-site/JsonLd';
import { PillLink } from '@/components/public-site/primitives';
import { PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { INDUSTRIES, INDUSTRIES_CRUMBS, INDUSTRIES_PAGE, INDUSTRIES_PATH, industriesStructuredData } from '@/content/industries';
import { ClosingPanel } from '@/routes/landing/sections';

/** Every industry with a page of its own, as photo cards under the solution hero. */
export default function IndustriesPage() {
	return (
		<div>
			<PageMeta title={INDUSTRIES_PAGE.metaTitle} description={INDUSTRIES_PAGE.metaDescription} path={INDUSTRIES_PATH} />
			<JsonLd data={industriesStructuredData(window.location.origin)} />
			<SolutionHero
				crumbs={INDUSTRIES_CRUMBS}
				title={INDUSTRIES_PAGE.title}
				lead={INDUSTRIES_PAGE.lead}
				actions={
					<>
						<StartBuildingButton variant="white" />
						<PillLink to="/discover" variant="outline-on-dark">
							Browse templates
						</PillLink>
					</>
				}
			/>
			<section className="bg-white px-4 py-20 sm:px-6 sm:py-28">
				<div className="mx-auto max-w-[1248px]">
					<IndustryCards industries={INDUSTRIES} />
				</div>
			</section>
			<ClosingPanel />
		</div>
	);
}
