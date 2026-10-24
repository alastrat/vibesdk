import { preload } from 'react-dom';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { PUBLIC_FONT_URL } from '@/components/layout/PublicLayout';
import { Link } from 'react-router';
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { PageMeta } from '@/components/public-site/solution-page';
import { t } from '@/lib/i18n';
import './not-found.css';

/** Public recovery page for URLs that do not match an application route. */
export default function NotFoundPage() {
	preload(PUBLIC_FONT_URL, {
		as: 'font',
		type: 'font/woff2',
		crossOrigin: 'anonymous',
	});
	return (
		<div className="public-site h-svh overflow-y-auto">
			<main>
				<section
					className="estori-not-found"
					aria-labelledby="not-found-title"
				>
					<PageMeta
						title={t('Page not found')}
						description={t(
							'Find your way back to Estori and keep bringing your ideas to life.',
						)}
					/>
					<meta name="robots" content="noindex, follow" />
					<div className="not-found-banner">
						<h1 id="not-found-title">
							{t('404 · Page not found')}
						</h1>
					</div>
					<div className="not-found-body">
						<img
							className="not-found-art"
							src="/marketing/not-found-ufo.png"
							width={928}
							height={800}
							alt=""
						/>
						<div className="not-found-copy">
							<h2>{t('Let’s get you back on track.')}</h2>
							<p className="not-found-description">
								{t(
									'The link may have changed, or this page may no longer be here. Your next idea is still waiting.',
								)}
							</p>
							<div className="not-found-actions">
								<Link className="not-found-home" to="/">
									<ArrowLeftIcon aria-hidden="true" />
									{t('Back to home')}
								</Link>
								<Link
									className="not-found-discover"
									to="/discover"
								>
									{t('Explore Discover')}
									<ArrowRightIcon aria-hidden="true" />
								</Link>
							</div>
							<p className="not-found-help">
								{t('Need a hand?')}{' '}
								<Link to="/contact">{t('Get in touch')}</Link>
							</p>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</div>
	);
}
