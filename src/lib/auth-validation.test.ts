import { describe, expect, it } from 'vitest';
import { emailError, newPasswordErrors, passwordError } from './auth-validation';

describe('email check', () => {
	it('requires a well-formed address', () => {
		expect(emailError('')).toBe('Email is required');
		expect(emailError('   ')).toBe('Email is required');
		expect(emailError('not-an-email')).toBe('Invalid email format');
		expect(emailError('person@example.com')).toBeUndefined();
	});
});

describe('sign-in password check', () => {
	it('requires at least 8 characters, without the sign-up strength rules', () => {
		expect(passwordError('')).toBe('Password is required');
		expect(passwordError('short')).toBe('Password must be at least 8 characters');
		expect(passwordError('lowercaseonly')).toBeUndefined();
	});
});

describe('new password check', () => {
	const strong = 'Sturdy-Pass1';

	it('accepts a strong password typed twice', () => {
		expect(newPasswordErrors(strong, strong)).toEqual({});
	});

	it('requires a password of at least 8 characters', () => {
		expect(newPasswordErrors('', '')).toEqual({ password: 'Password is required' });
		expect(newPasswordErrors('Aa1!', 'Aa1!')).toEqual({ password: 'Password must be at least 8 characters' });
	});

	it('requires an uppercase letter, a lowercase letter, a number and a special character', () => {
		const message =
			'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character';
		for (const weak of ['sturdy-pass1', 'STURDY-PASS1', 'Sturdy-Pass', 'SturdyPass1']) {
			expect(newPasswordErrors(weak, weak)).toEqual({ password: message });
		}
	});

	it('requires both fields to match', () => {
		expect(newPasswordErrors(strong, `${strong}x`)).toEqual({ confirmPassword: 'Passwords do not match' });
	});
});
