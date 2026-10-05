import type { SVGProps } from 'react';
import LogoSvg from './assets/estori-logo.svg?react';
import { BRAND } from '../../shared/brand';

/** Full "estori." wordmark. Letters follow `color`; size it with className (e.g. `h-6 w-auto`). */
export function EstoriLogo({
	'aria-label': ariaLabel = BRAND.name,
	...props
}: SVGProps<SVGSVGElement>) {
	return <LogoSvg role="img" aria-label={ariaLabel} {...props} />;
}
