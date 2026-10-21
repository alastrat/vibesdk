import { Monitor, Moon, Sun } from 'lucide-react';
import { Button, DropdownMenu, cn } from '@cloudflare/kumo';
import { useTheme } from '../contexts/theme-context';
import { t } from '@/lib/i18n';

interface ThemeToggleProps {
	className?: string;
	iconClassName?: string;
	align?: 'start' | 'center' | 'end';
}

export function ThemeToggle({
	className,
	iconClassName,
	align = 'end',
}: ThemeToggleProps) {
	const { theme, setTheme } = useTheme();
	const TriggerIcon =
		theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
	const themeItems = [
		{ value: 'light', label: t('Light'), icon: Sun },
		{ value: 'dark', label: t('Dark'), icon: Moon },
		{ value: 'system', label: t('System'), icon: Monitor },
	] as const;

	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<Button
						variant="secondary"
						size="base"
						shape="square"
						aria-label={t('Toggle theme')}
						className={cn(
							'text-kumo-subtle hover:text-kumo-default',
							className,
						)}
					>
						<TriggerIcon className={cn('size-4', iconClassName)} />
					</Button>
				}
			/>
			<DropdownMenu.Content align={align}>
				<DropdownMenu.Group>
					{themeItems.map(({ value, label, icon: Icon }) => {
						const selected = theme === value;

						return (
							<DropdownMenu.Item
								key={value}
								selected={selected}
								onClick={() => setTheme(value)}
								className={cn(
									'justify-between',
								)}
							>
								<span className="flex items-center gap-2">
									<Icon className="size-4" />
									{label}
								</span>
							</DropdownMenu.Item>
						);
					})}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
