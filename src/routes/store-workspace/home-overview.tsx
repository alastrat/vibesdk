import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Loader } from '@cloudflare/kumo';
import {
	ArrowUpRightIcon,
	PackageIcon,
	SparkleIcon,
	StorefrontIcon,
} from '@phosphor-icons/react';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { t, useI18n, getLocale } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
import { BuilderHandoff } from './builder-handoff';

function useHomeCollection(appId: string, userId: string) {
	return useQuery({
		queryKey: queryKeys.account.storeProducts(appId, userId),
		queryFn: () =>
			unwrap(
				apiClient.getStoreProducts(appId),
				t("Couldn't load your products"),
			),
		retry: false,
	});
}
export function StoreHomeIntroduction({
	appId,
	userId,
}: {
	appId: string;
	userId: string;
}) {
	useI18n();
	const collection = useHomeCollection(appId, userId);
	const product = collection.data?.products.find((item) => item.imageUrl);
	return (
		<div className="es-home-feature">
			<section className="es-home-editorial">
				<div>
					<p className="es-home-tag">{t('Your next chapter')}</p>
					<h2>{t('Make room for your next idea.')}</h2>
					<p>
						{t(
							'Shape your collection, make it your own, and share it with the world.',
						)}
					</p>
					<Link to="?section=products" className="es-text-link">
						{t('Explore your products')}
						<ArrowUpRightIcon size={16} />
					</Link>
				</div>
				{product?.imageUrl ? (
					<img
						src={product.imageUrl}
						alt={product.name}
						loading="lazy"
						referrerPolicy="no-referrer"
					/>
				) : (
					<StorefrontIcon
						size={104}
						weight="light"
						className="es-home-art"
						aria-hidden="true"
					/>
				)}
			</section>
			<section className="es-home-helper">
				<SparkleIcon size={26} />
				<p className="es-home-tag">{t('A little help from Estori')}</p>
				<h2>{t('Good things start with an idea.')}</h2>
				<p>
					{t(
						'Plan a new collection, refine a product, or improve your storefront with your store builder.',
					)}
				</p>
				<BuilderHandoff
					appId={appId}
					label={t('Ask Estori')}
					request={t(
						'Help me plan the next improvement to this store. Review its current products and design, then suggest a few focused ideas before changing anything.',
					)}
				/>
			</section>
		</div>
	);
}
export function StoreHomeCollection({
	appId,
	userId,
}: {
	appId: string;
	userId: string;
}) {
	useI18n();
	const collection = useHomeCollection(appId, userId);
	return (
		<section className="es-home-collection">
			<div className="es-panel-heading">
				<div>
					<h2>{t('Your collection')}</h2>
					<p>{t('Products from your last published store.')}</p>
				</div>
				<Link to="?section=products" className="es-text-link">
					{t('View all')}
					<ArrowUpRightIcon size={14} />
				</Link>
			</div>
			{collection.data?.products.length ? (
				<ul>
					{collection.data.products.slice(0, 3).map((product) => (
						<li key={product.id}>
							<Link
								to={`?section=products&product=${encodeURIComponent(product.id)}`}
								className="es-home-product"
							>
								{product.imageUrl ? (
									<img
										src={product.imageUrl}
										alt=""
										loading="lazy"
										referrerPolicy="no-referrer"
									/>
								) : (
									<span className="es-home-product-placeholder">
										<PackageIcon size={24} />
									</span>
								)}
								<span>
									<strong>{product.name}</strong>
									<small>
										{product.variants.some(
											(variant) => variant.available,
										)
											? t('Listed for sale')
											: t('Unavailable')}
									</small>
								</span>
								<b>
									{formatCents(
										Math.min(
											...product.variants.map(
												(variant) => variant.priceCents,
											),
										),
										getLocale(),
									)}
								</b>
							</Link>
						</li>
					))}
				</ul>
			) : collection.isPending ? (
				<div className="py-6">
					<Loader />
				</div>
			) : collection.isError ? (
				<div className="grid gap-3 py-6 text-sm">
					<p>{t("Couldn't load your products")}</p>
					<Button
						size="sm"
						className="w-fit"
						onClick={() => void collection.refetch()}
					>
						{t('Try again')}
					</Button>
				</div>
			) : (
				<div className="grid gap-3 py-6 text-sm">
					<p>
						{t(
							'Your published products will appear here. Build your collection and publish when it is ready.',
						)}
					</p>
					<Link className="es-text-link" to="?section=products">
						{t('Manage products')}
						<ArrowUpRightIcon size={14} />
					</Link>
				</div>
			)}
		</section>
	);
}
