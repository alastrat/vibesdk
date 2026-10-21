/**
 * Authentication Validation Schemas
 * Zod schemas for validating auth-related requests
 */

import { z } from 'zod';
import { commonSchemas } from '../../../utils/inputValidator';
import { RESET_LINK_INVALID_MESSAGE } from '../../../services/auth/one-time-token';
import { LOCALES } from '../../../../shared/i18n/locales';

/**
 * Login request schema
 */
export const loginSchema = z.object({
  email: commonSchemas.email,
  password: z.string().min(1, 'Password is required')
});

export type LoginRequest = z.infer<typeof loginSchema>;

/**
 * Registration request schema
 */
export const registerSchema = z.object({
  email: commonSchemas.email,
  password: commonSchemas.password,
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).optional(),
  acceptedTermsVersion: z.string().max(32).optional(),
  // The language the visitor was using. One we don't speak is dropped: it must never refuse a sign-up.
  locale: z.enum(LOCALES).optional().catch(undefined)
});

export type RegisterRequest = z.infer<typeof registerSchema>;

/**
 * Terms agreement schema
 */
export const acceptTermsSchema = z.object({ version: z.string().min(1).max(32) });

/**
 * OAuth callback schema
 */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State is required'),
  error: z.string().optional(),
  error_description: z.string().optional()
});

export type OAuthCallbackRequest = z.infer<typeof oauthCallbackSchema>;

/**
 * Change password schema
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: commonSchemas.password,
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword']
});

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

/**
 * Forgot password schema
 */
export const forgotPasswordSchema = z.object({
  email: commonSchemas.email
});

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset password schema
 */
export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required').max(200, RESET_LINK_INVALID_MESSAGE),
  newPassword: commonSchemas.password,
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword']
});

export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

/**
 * Email confirmation schema
 */
export const verifyEmailSchema = z.object({ token: z.string().min(1).max(200) });

export type VerifyEmailRequest = z.infer<typeof verifyEmailSchema>;

/**
 * OAuth provider schema
 */
export const oauthProviderSchema = z.enum(['google', 'github', 'cloudflare']);

export type OAuthProviderParam = z.infer<typeof oauthProviderSchema>;