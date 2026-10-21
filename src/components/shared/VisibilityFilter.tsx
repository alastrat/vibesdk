import { t, useI18n, msg } from '@/lib/i18n';
import { Tabs } from '@cloudflare/kumo';
import { GlobeIcon, LockIcon, SparkleIcon } from '@phosphor-icons/react';

interface VisibilityFilterProps {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}

const visibilityOptions = [
	{
		value: 'all',
		label: msg("All"),
		icon: SparkleIcon,
	},
	{
		value: 'public',
		label: msg("Public"),
		icon: GlobeIcon,
	},
	{
		value: 'private',
		label: msg("Private"),
		icon: LockIcon,
	},
] as const;

export function VisibilityFilter({
	value,
	onChange,
	className,
}: VisibilityFilterProps) {
	useI18n();
	return (
		<Tabs
			value={value}
			onValueChange={onChange}
			size="sm"
			className={className}
			tabs={visibilityOptions.map((option) => {
				const Icon = option.icon;
				return {
					value: option.value,
					label: (
						<span className="inline-flex items-center gap-1.5">
							<span className="h-lh flex items-center">
								<Icon className="size-3" weight="duotone" />
							</span>
							{t(option.label)}
						</span>
					),
				};
			})}
		/>
	);
}
