/** Client-side checks for the email and password forms, so sign-up and password reset apply the same rules. */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_STRENGTH_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
const MIN_PASSWORD_LENGTH = 8;

export type NewPasswordErrors = { password?: string; confirmPassword?: string };

export function emailError(email: string): string | undefined {
	if (!email.trim()) return 'Email is required';
	if (!EMAIL_PATTERN.test(email)) return 'Invalid email format';
	return undefined;
}

/** The sign-in check: present and long enough, without the strength rules older passwords may predate. */
export function passwordError(password: string): string | undefined {
	if (!password) return 'Password is required';
	if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
	return undefined;
}

/** The rules for choosing a password, at sign-up or on a reset. Only failing fields are present. */
export function newPasswordErrors(password: string, confirmPassword: string): NewPasswordErrors {
	const errors: NewPasswordErrors = {};
	const basic = passwordError(password);
	if (basic) {
		errors.password = basic;
	} else if (!PASSWORD_STRENGTH_PATTERN.test(password)) {
		errors.password =
			'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character';
	}
	if (password !== confirmPassword) {
		errors.confirmPassword = 'Passwords do not match';
	}
	return errors;
}
