import { formatNumber } from '../../shared/i18n/format';
import { getLocale, t, tn } from '@/lib/i18n';

/** Describes a per-step credit change, for example "about 136 credits per step instead of about 16 (about 8.5x)". */
export function describeCreditChange(current: number, next: number): string {
	const locale = getLocale();
	if (next === current) return tn('about {count} credit per step', 'about {count} credits per step', next);
	const base = tn('about {count} credit per step instead of about {current}', 'about {count} credits per step instead of about {current}', next, {
		current: formatNumber(current, locale),
	});
	if (current <= 0) return base;
	if (next > current) return t('{base} (about {ratio}x)', { base, ratio: formatNumber(Math.round((next / current) * 10) / 10, locale) });
	return t('{base} (about {percent}% cheaper)', { base, percent: formatNumber(Math.round((1 - next / current) * 100), locale) });
}
