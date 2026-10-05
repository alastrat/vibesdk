import type { SVGProps } from 'react';
import GlyphSvg from './assets/estori-glyph.svg?react';
import { BRAND } from '../../shared/brand';

/** Square "e." monogram for icon-sized spots. The "e" follows `color`. */
export function EstoriGlyph({
	'aria-label': ariaLabel = BRAND.name,
	...props
}: SVGProps<SVGSVGElement>) {
	return <GlyphSvg role="img" aria-label={ariaLabel} {...props} />;
}
