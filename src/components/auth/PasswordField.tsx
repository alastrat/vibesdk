import { InputGroup } from '@cloudflare/kumo';
import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import { t } from '@/lib/i18n';

interface PasswordFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	disabled?: boolean;
	autoComplete: 'current-password' | 'new-password';
	visible: boolean;
	onVisibleChange: (visible: boolean) => void;
}

/** Password input with a show/hide toggle, used by the sign-in window and the password reset page. */
export function PasswordField({
	label,
	value,
	onChange,
	error,
	disabled,
	autoComplete,
	visible,
	onVisibleChange,
}: PasswordFieldProps) {
	const toggleLabel = visible ? t('Hide password') : t('Show password');
	return (
		<div className="w-full min-w-0 [&_input]:w-full [&_[data-slot=field]]:gap-1.5">
			<InputGroup
				label={label}
				error={error ? { message: error, match: true } : undefined}
				disabled={disabled}
			>
				<InputGroup.Input
					type={visible ? 'text' : 'password'}
					placeholder={label}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					autoComplete={autoComplete}
				/>
				<InputGroup.Addon align="end">
					<InputGroup.Button
						type="button"
						variant="ghost"
						tooltip={toggleLabel}
						onClick={() => onVisibleChange(!visible)}
						disabled={disabled}
						aria-label={toggleLabel}
						icon={visible ? EyeSlashIcon : EyeIcon}
					/>
				</InputGroup.Addon>
			</InputGroup>
		</div>
	);
}
