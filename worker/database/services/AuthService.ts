import { t } from '../../services/i18n/request-locale';
import { msg } from '../../../shared/i18n/translate';
/**
 * Main Authentication Service
 * Orchestrates all auth operations including login, registration, and OAuth
 */

import * as schema from '../schema';
import { SAVED_LOCALE } from '../preferences-sql';
import { eq, and, sql, or, lt, gt, isNull } from 'drizzle-orm';
import { JWTUtils } from '../../utils/jwtUtils';
import { generateSecureToken } from '../../utils/cryptoUtils';
import { SessionService, revokeAllUserSessionsQuery } from './SessionService';
import { ApiKeyService } from './ApiKeyService';
import { PasswordService } from '../../utils/passwordService';
import { GoogleOAuthProvider } from '../../services/oauth/google';
import { GitHubOAuthProvider } from '../../services/oauth/github';
import { CloudflareConnectOAuthProvider } from '../../services/oauth/cloudflare-connect';
import { BaseOAuthProvider } from '../../services/oauth/base';
import { readOAuthNonceCookie } from '../../utils/oauthCookie';
import { 
    SecurityError, 
    SecurityErrorType 
} from 'shared/types/errors';
import { SignupsPausedError } from '../../../shared/types/pauses';
import { isLocale, localeFromAcceptLanguage, type Locale } from '../../../shared/i18n/locales';
import { isFlagOn } from '../../services/posthog/flags';
import { AuthResult, AuthUserSession, OAuthUserInfo } from '../../types/auth-types';
import { generateId } from '../../utils/idGenerator';
import {
    AuthUser, 
    OAuthProvider
} from '../../types/auth-types';
import { mapUserResponse, validateRedirectUrl, enforceAllowedEmail } from '../../utils/authUtils';
import { createLogger } from '../../logger';
import { validateEmail, validatePassword } from '../../utils/validationUtils';
import {
    ADMIN_EMAIL_PROVIDER_MESSAGE,
    EMAIL_VERIFYING_PROVIDERS,
    isPlatformAdminEmail,
    mayClaimEmailByOAuth,
} from '../../services/auth/admin-access';
import { extractRequestMetadata } from '../../utils/authUtils';
import { BaseService } from './BaseService';
import {
    CONFIRM_LINK_INVALID_MESSAGE,
    RESET_LINK_INVALID_MESSAGE,
    RESET_TOKEN_TTL_MS,
    VERIFY_TOKEN_TTL_MS,
    createOneTimeToken,
    hashOneTimeToken,
    isTokenUsable,
} from '../../services/auth/one-time-token';
import { resetPasswordLink, verifyEmailLink } from '../../services/email/links';
import { passwordResetEmail, verifyEmailEmail } from '../../services/email/templates';
import { savedUserLocale } from '../../services/i18n/saved-locale';
import type { EmailSender } from '../../services/email/types';
import {
    TERMS_VERSION,
    TERMS_REQUIRED_MESSAGE,
    TERMS_OUTDATED_MESSAGE,
    isCurrentTermsVersion,
} from '../../../shared/types/legal';

const logger = createLogger('AuthService');

/**
 * Login credentials
 */
export interface LoginCredentials {
    email: string;
    password: string;
}

/**
 * Registration data
 */
export interface RegistrationData {
    email: string;
    password: string;
    name?: string;
    acceptedTermsVersion?: string;
    /** The language the visitor was using; saved on the account so its emails start in it. */
    locale?: Locale;
}

/**
 * Human-friendly label for a stored auth provider, used in user-facing messages.
 */
export function providerLabel(provider: string | null | undefined): string {
    switch (provider) {
        case 'google':
            return 'Google';
        case 'github':
            return 'GitHub';
        case 'cloudflare':
            return 'Cloudflare';
        default:
            return t('a different sign-in method');
    }
}

/**
 * Why a password sign-up can't go ahead with this terms version, or null when it can.
 * A page loaded before a terms update sends the old version and must reload.
 */
export function signUpTermsError(version: unknown): string | null {
    if (isCurrentTermsVersion(version)) return null;
    return typeof version === 'string' && version.length > 0 ? TERMS_OUTDATED_MESSAGE : TERMS_REQUIRED_MESSAGE;
}

/**
 * User fields set when an unconfirmed account passes to the proven owner of its address:
 * the email is confirmed, and an AI gateway preference someone else may have set is dropped.
 */
const PROVEN_OWNER_FIELDS = { emailVerified: true, aiGatewayEnabled: null } as const;

/**
 * A new identity row for a provider account whose email the provider has verified.
 */
function verifiedIdentityRow(
    userId: string,
    provider: OAuthProvider,
    oauthUserInfo: OAuthUserInfo,
    now: Date
): schema.NewUserOauthIdentity {
    return {
        id: generateId(),
        userId,
        provider,
        providerId: oauthUserInfo.id,
        email: oauthUserInfo.email.toLowerCase(),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Main Authentication Service
 */
export class AuthService extends BaseService {
    private readonly sessionService: SessionService;
    private readonly apiKeyService: ApiKeyService;
    private readonly passwordService: PasswordService;
    
    constructor(
        env: Env,
    ) {
        super(env);
        this.sessionService = new SessionService(env);
        this.apiKeyService = new ApiKeyService(env);
        this.passwordService = new PasswordService();
    }
    
    /**
     * Register a new user. The address starts unconfirmed; a confirmation link is emailed
     * when a sender is available, and a failure to send never fails the sign-up.
     */
    async register(
        data: RegistrationData,
        request: Request,
        sender: EmailSender | null,
        baseUrl: string
    ): Promise<AuthResult> {
        try {
            // Deployment-level admission gate (ALLOWED_EMAIL)
            enforceAllowedEmail(this.env, data.email, 'register');

            // Validate email format using centralized utility
            const emailValidation = validateEmail(data.email);
            if (!emailValidation.valid) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    emailValidation.error || 'Invalid email format',
                    400
                );
            }

            const termsError = signUpTermsError(data.acceptedTermsVersion);
            if (termsError) {
                throw new SecurityError(SecurityErrorType.INVALID_INPUT, termsError, 400);
            }
            
            // Password sign-up doesn't prove the address, so an admin email
            // must be claimed through a provider that verifies it.
            if (isPlatformAdminEmail(data.email)) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    ADMIN_EMAIL_PROVIDER_MESSAGE,
                    400
                );
            }

            // Validate password using centralized utility
            const passwordValidation = validatePassword(data.password, undefined, {
                email: data.email,
                name: data.name
            });
            if (!passwordValidation.valid) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    passwordValidation.errors!.join(', '),
                    400
                );
            }
            
            // Check if user already exists
            const existingUser = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.email, data.email.toLowerCase()))
                .get();
            
            if (existingUser) {
                // OAuth-only account: guide the user to their provider instead of
                // implying they can create a password-based account for this email.
                if (!existingUser.passwordHash) {
                    const label = providerLabel(existingUser.provider);
                    throw new SecurityError(
                        SecurityErrorType.CONFLICT,
                        t("This email is registered with {value1}. Please sign in with {value2}.", { value1: String(label), value2: String(label) }),
                        409
                    );
                }
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    msg('An account with this email already exists. Please sign in.'),
                    400
                );
            }
            
            // Only a new account is refused.
            if (await isFlagOn(this.env, 'signups-paused', null)) throw new SignupsPausedError();

            // Hash password
            const passwordHash = await this.passwordService.hash(data.password);
            
            // Create user
            const userId = generateId();
            const now = new Date();
            
            // Unconfirmed until the emailed link is followed, so a provider sign-in
            // for this address can take the account back from whoever set the password.
            await this.database.insert(schema.users).values({
                id: userId,
                email: data.email.toLowerCase(),
                passwordHash,
                displayName: data.name || data.email.split('@')[0],
                emailVerified: false,
                provider: 'email',
                providerId: userId,
                termsAcceptedAt: now,
                termsVersion: TERMS_VERSION,
                preferences: data.locale ? { locale: data.locale } : {},
                createdAt: now,
                updatedAt: now
            });
            
            // Get the created user
            const newUser = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.id, userId))
                .get();
            
            if (!newUser) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    msg('Failed to retrieve created user'),
                    500
                );
            }
            
            // Log successful registration
            await this.logAuthAttempt(data.email, 'register', true, request);
            logger.info('User registered and logged in directly', { userId, email: data.email });
            
            // Create session and tokens immediately (log user in after registration)
            const { accessToken, session } = await this.sessionService.createSession(
                userId,
                request
            );

            await this.sendEmailConfirmation(newUser, sender, baseUrl);

            return {
                user: mapUserResponse(newUser),
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                accessToken,
            };
        } catch (error) {
            await this.logAuthAttempt(data.email, 'register', false, request);
            
            if (error instanceof SecurityError) {
                throw error;
            }
            
            logger.error('Registration error', error);
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                msg('Registration failed'),
                500
            );
        }
    }

    /**
     * Record that a signed-in user agreed to the current terms version.
     */
    async acceptTerms(userId: string, version: unknown): Promise<AuthUser> {
        if (!isCurrentTermsVersion(version)) {
            throw new SecurityError(SecurityErrorType.INVALID_INPUT, TERMS_OUTDATED_MESSAGE, 400);
        }
        const now = new Date();
        await this.database
            .update(schema.users)
            .set({ termsAcceptedAt: now, termsVersion: TERMS_VERSION, updatedAt: now })
            .where(eq(schema.users.id, userId))
            .run();
        const user = await this.database.select().from(schema.users).where(eq(schema.users.id, userId)).get();
        if (!user) throw new SecurityError(SecurityErrorType.UNAUTHORIZED, msg('User not found'), 404);
        return mapUserResponse(user);
    }
    
    /**
     * Login with email and password
     */
    async login(credentials: LoginCredentials, request: Request): Promise<AuthResult> {
        try {
            // Deployment-level admission gate (ALLOWED_EMAIL)
            enforceAllowedEmail(this.env, credentials.email, 'login');

            // Find user
            const user = await this.database
                .select()
                .from(schema.users)
                .where(
                    and(
                        eq(schema.users.email, credentials.email.toLowerCase()),
                        sql`${schema.users.deletedAt} IS NULL`
                    )
                )
                .get();
            
            if (!user) {
                await this.logAuthAttempt(credentials.email, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    msg('Invalid email or password'),
                    401
                );
            }

            // The email belongs to an OAuth-only account (no password set). Tell the
            // user which provider to use instead of a misleading credentials error.
            if (!user.passwordHash) {
                await this.logAuthAttempt(credentials.email, 'login', false, request);
                const label = providerLabel(user.provider);
                throw new SecurityError(
                    SecurityErrorType.CONFLICT,
                    t("This account uses {value1} to sign in. Please continue with {value2}.", { value1: String(label), value2: String(label) }),
                    409
                );
            }
            
            // Verify password
            const passwordValid = await this.passwordService.verify(
                credentials.password,
                user.passwordHash
            );
            
            if (!passwordValid) {
                await this.logAuthAttempt(credentials.email, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    msg('Invalid email or password'),
                    401
                );
            }
            
            // Create session
            const { accessToken, session } = await this.sessionService.createSession(
                user.id,
                request
            );
            
            // Log successful attempt
            await this.logAuthAttempt(credentials.email, 'login', true, request);
            
            logger.info('User logged in', { userId: user.id, email: user.email });
            
            return {
                user: mapUserResponse(user),
                accessToken,
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
            };
        } catch (error) {
            if (error instanceof SecurityError) {
                throw error;
            }
            
            logger.error('Login error', error);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                msg('Login failed'),
                500
            );
        }
    }
    
    /**
     * Logout
     */
    async logout(sessionId: string): Promise<void> {
        try {
            await this.sessionService.revokeSessionId(sessionId);
            logger.info('User logged out', { sessionId });
        } catch (error) {
            logger.error('Logout error', error);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                msg('Logout failed'),
                500
            );
        }
    }

    /**
     * Start a password reset: store the hash of a single-use token and email its link.
     * Resolves the same way for every address, so a caller can't tell whether an account
     * exists. A confirmed account without a password can use the link to set one; an
     * unconfirmed account without a password gets nothing.
     */
    async requestPasswordReset(email: string, sender: EmailSender | null, baseUrl: string): Promise<void> {
        const user = await this.database
            .select({
                id: schema.users.id,
                email: schema.users.email,
                passwordHash: schema.users.passwordHash,
                emailVerified: schema.users.emailVerified,
            })
            .from(schema.users)
            .where(and(eq(schema.users.email, email.toLowerCase()), isNull(schema.users.deletedAt)))
            .get();

        if (!user || !sender || (!user.passwordHash && user.emailVerified !== true)) {
            return;
        }

        const token = createOneTimeToken();
        const tokenHash = await hashOneTimeToken(token);
        await this.database.batch([
            this.database
                .update(schema.passwordResetTokens)
                .set({ used: true })
                .where(
                    and(
                        eq(schema.passwordResetTokens.userId, user.id),
                        or(eq(schema.passwordResetTokens.used, false), isNull(schema.passwordResetTokens.used))
                    )
                ),
            this.database.insert(schema.passwordResetTokens).values({
                id: generateId(),
                userId: user.id,
                tokenHash,
                expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
            }),
        ]);

        try {
            await sender.send(passwordResetEmail(user.email, resetPasswordLink(baseUrl, token), await savedUserLocale(this.env, user.id)));
        } catch (error) {
            logger.error('Failed to send password reset email', { userId: user.id, error });
        }
    }

    /**
     * Set a new password with the token from a reset link. The token works once; on
     * success every session of the account is signed out.
     */
    async resetPassword(token: string, newPassword: string, request: Request): Promise<void> {
        const now = new Date();
        const row = await this.database
            .select({
                id: schema.passwordResetTokens.id,
                userId: schema.passwordResetTokens.userId,
                used: schema.passwordResetTokens.used,
                expiresAt: schema.passwordResetTokens.expiresAt,
            })
            .from(schema.passwordResetTokens)
            .where(eq(schema.passwordResetTokens.tokenHash, await hashOneTimeToken(token)))
            .get();

        const user =
            row && isTokenUsable(row, now)
                ? await this.database
                      .select({
                          id: schema.users.id,
                          email: schema.users.email,
                          emailVerified: schema.users.emailVerified,
                      })
                      .from(schema.users)
                      .where(and(eq(schema.users.id, row.userId), isNull(schema.users.deletedAt)))
                      .get()
                : undefined;
        if (!row || !user) {
            throw new SecurityError(SecurityErrorType.INVALID_TOKEN, RESET_LINK_INVALID_MESSAGE, 400);
        }

        const passwordValidation = validatePassword(newPassword, undefined, { email: user.email });
        if (!passwordValidation.valid) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                (passwordValidation.errors ?? []).join(', '),
                400
            );
        }

        const passwordHash = await this.passwordService.hash(newPassword);

        // The claim is one conditional statement, so concurrent requests with the same token can't both win.
        const claimedAt = new Date();
        const claimed = await this.database
            .update(schema.passwordResetTokens)
            .set({ used: true })
            .where(
                and(
                    eq(schema.passwordResetTokens.id, row.id),
                    or(eq(schema.passwordResetTokens.used, false), isNull(schema.passwordResetTokens.used)),
                    gt(schema.passwordResetTokens.expiresAt, claimedAt)
                )
            )
            .returning({ id: schema.passwordResetTokens.id });
        if (claimed.length === 0) {
            throw new SecurityError(SecurityErrorType.INVALID_TOKEN, RESET_LINK_INVALID_MESSAGE, 400);
        }

        const passwordChange = {
            passwordHash,
            passwordChangedAt: claimedAt,
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: claimedAt,
        };
        if (user.emailVerified === true) {
            // One batch, so the new password never lands without every session signed out.
            await this.database.batch([
                this.database.update(schema.users).set(passwordChange).where(eq(schema.users.id, user.id)),
                revokeAllUserSessionsQuery(this.database, user.id),
            ]);
        } else {
            // The reset proves inbox control, so it settles an unconfirmed account the way a provider claim does.
            await this.database.batch([
                this.database
                    .update(schema.users)
                    .set({ ...passwordChange, ...PROVEN_OWNER_FIELDS })
                    .where(eq(schema.users.id, user.id)),
                ...this.takeoverCleanup(user.id),
            ]);
        }

        await this.logAuthAttempt(user.email, 'reset_password', true, request);
        logger.info('Password reset', { userId: user.id, confirmedEmail: user.emailVerified !== true });
    }

    /**
     * Email a link that confirms the user's current address; a new link retires the earlier
     * unused ones. Best effort: a failure is logged, never thrown, so it can't fail sign-up.
     */
    async sendEmailConfirmation(user: { id: string; email: string }, sender: EmailSender | null, baseUrl: string): Promise<void> {
        if (!sender) {
            return;
        }

        try {
            const token = createOneTimeToken();
            const tokenHash = await hashOneTimeToken(token);
            await this.database.batch([
                this.database
                    .update(schema.emailVerificationTokens)
                    .set({ used: true })
                    .where(
                        and(
                            eq(schema.emailVerificationTokens.userId, user.id),
                            or(eq(schema.emailVerificationTokens.used, false), isNull(schema.emailVerificationTokens.used))
                        )
                    ),
                this.database.insert(schema.emailVerificationTokens).values({
                    id: generateId(),
                    userId: user.id,
                    tokenHash,
                    email: user.email,
                    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
                }),
            ]);
            await sender.send(verifyEmailEmail(user.email, verifyEmailLink(baseUrl, token), await savedUserLocale(this.env, user.id)));
        } catch (error) {
            logger.error('Failed to send email confirmation', { userId: user.id, error });
        }
    }

    /**
     * Confirm the address a confirmation link was sent to. The link works once, and only
     * while that address is still the account's email. Answers the confirmed user's id.
     */
    async verifyEmail(token: string): Promise<string> {
        const now = new Date();
        const row = await this.database
            .select({
                id: schema.emailVerificationTokens.id,
                userId: schema.emailVerificationTokens.userId,
                email: schema.emailVerificationTokens.email,
                used: schema.emailVerificationTokens.used,
                expiresAt: schema.emailVerificationTokens.expiresAt,
            })
            .from(schema.emailVerificationTokens)
            .where(eq(schema.emailVerificationTokens.tokenHash, await hashOneTimeToken(token)))
            .get();

        const user =
            row && isTokenUsable(row, now)
                ? await this.database
                      .select({ id: schema.users.id, email: schema.users.email })
                      .from(schema.users)
                      .where(and(eq(schema.users.id, row.userId), isNull(schema.users.deletedAt)))
                      .get()
                : undefined;
        if (!row || !user || user.email !== row.email) {
            throw new SecurityError(SecurityErrorType.INVALID_TOKEN, CONFIRM_LINK_INVALID_MESSAGE, 400);
        }

        // The claim is one conditional statement, so concurrent requests with the same token can't both win.
        const claimedAt = new Date();
        const claimed = await this.database
            .update(schema.emailVerificationTokens)
            .set({ used: true })
            .where(
                and(
                    eq(schema.emailVerificationTokens.id, row.id),
                    or(eq(schema.emailVerificationTokens.used, false), isNull(schema.emailVerificationTokens.used)),
                    gt(schema.emailVerificationTokens.expiresAt, claimedAt)
                )
            )
            .returning({ id: schema.emailVerificationTokens.id });
        if (claimed.length === 0) {
            throw new SecurityError(SecurityErrorType.INVALID_TOKEN, CONFIRM_LINK_INVALID_MESSAGE, 400);
        }

        // Matching the email again keeps an address changed since the check from being confirmed.
        await this.database
            .update(schema.users)
            .set({ emailVerified: true, updatedAt: claimedAt })
            .where(and(eq(schema.users.id, user.id), eq(schema.users.email, row.email)));

        logger.info('Email confirmed', { userId: user.id });
        return user.id;
    }

    /**
     * Email a new confirmation link to a password account whose address isn't confirmed yet.
     * A confirmed account, or one that signs in only through a provider, gets nothing.
     */
    async resendEmailConfirmation(userId: string, sender: EmailSender | null, baseUrl: string): Promise<void> {
        const user = await this.database
            .select({
                id: schema.users.id,
                email: schema.users.email,
                emailVerified: schema.users.emailVerified,
                passwordHash: schema.users.passwordHash,
            })
            .from(schema.users)
            .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
            .get();

        if (!user || user.emailVerified || !user.passwordHash) {
            return;
        }

        await this.sendEmailConfirmation(user, sender, baseUrl);
    }

    async getOauthProvider(provider: OAuthProvider, request: Request): Promise<BaseOAuthProvider> {
        const url = new URL(request.url).origin;
        
        switch (provider) {
            case 'google':
                return GoogleOAuthProvider.create(this.env, url);
            case 'github':
                return GitHubOAuthProvider.create(this.env, url);
            case 'cloudflare':
                return CloudflareConnectOAuthProvider.createForLogin(this.env, url);
            default:
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    t("OAuth provider {value1} not configured", { value1: String(provider) }),
                    400
                );
        }
    }
    
    /**
     * Get OAuth authorization URL. `locale` is the language picked before leaving for the provider: the callback is a
     * top-level navigation that carries only the browser's languages, so the pick travels on the state row.
     */
    async getOAuthAuthorizationUrl(
        provider: OAuthProvider,
        request: Request,
        intendedRedirectUrl?: string,
        linkUserId?: string,
        locale: Locale | null = null
    ): Promise<{ authUrl: string; nonce: string }> {
        const oauthProvider = await this.getOauthProvider(provider, request);
        if (!oauthProvider) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                t("OAuth provider {value1} not configured", { value1: String(provider) }),
                400
            );
        }
        
        // Clean up expired OAuth states first
        await this.cleanupExpiredOAuthStates();
        
        // Validate and sanitize intended redirect URL
        let validatedRedirectUrl: string | null = null;
        if (intendedRedirectUrl) {
            validatedRedirectUrl = validateRedirectUrl(intendedRedirectUrl, request);
        }
        
        // Generate state for CSRF protection
        const state = generateSecureToken();
        
        // Generate PKCE code verifier
        const codeVerifier = BaseOAuthProvider.generateCodeVerifier();

        // Generate a nonce that binds this state to the initiating browser. It is
        // stored here and also set as an HttpOnly cookie by the controller; the
        // callback rejects any request whose cookie nonce does not match. This is
        // the core defense against login CSRF / session fixation.
        const nonce = generateSecureToken();
        
        // Store OAuth state with intended redirect URL
        await this.database.insert(schema.oauthStates).values({
            id: generateId(),
            state,
            provider,
            codeVerifier,
            redirectUri: validatedRedirectUrl || oauthProvider['redirectUri'],
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 600000), // 10 minutes
            isUsed: false,
            scopes: [],
            userId: linkUserId ?? null,
            nonce,
            locale
        });
        
        // Get authorization URL
        const authUrl = await oauthProvider.getAuthorizationUrl(state, codeVerifier);
        
        logger.info('OAuth authorization initiated', { provider });
        
        return { authUrl, nonce };
    }
    
    /**
     * Clean up expired OAuth states
     */
    private async cleanupExpiredOAuthStates(): Promise<void> {
        try {
            const now = new Date();
            await this.database
                .delete(schema.oauthStates)
                .where(
                    or(
                        lt(schema.oauthStates.expiresAt, now),
                        eq(schema.oauthStates.isUsed, true)
                    )
                );
            
            logger.debug('Cleaned up expired OAuth states');
        } catch (error) {
            logger.error('Error cleaning up OAuth states', error);
        }
    }
    
    /**
     * Validate an OAuth state row (existence, expiry, browser nonce) and mark it as
     * used. Shared by the login callback and the account-link callback.
     */
    private async validateAndConsumeOAuthState(
        provider: OAuthProvider,
        state: string,
        request: Request
    ): Promise<schema.OAuthState> {
        const now = new Date();
        const oauthState = await this.database
            .select()
            .from(schema.oauthStates)
            .where(
                and(
                    eq(schema.oauthStates.state, state),
                    eq(schema.oauthStates.provider, provider),
                    eq(schema.oauthStates.isUsed, false)
                )
            )
            .get();

        if (!oauthState || new Date(oauthState.expiresAt) < now) {
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                msg('Invalid or expired OAuth state'),
                400
            );
        }

        // Bind the state to the initiating browser via the nonce cookie. A callback
        // replayed in a different browser (login CSRF / session fixation) will not
        // carry the matching nonce and is rejected here.
        const cookieNonce = readOAuthNonceCookie(request, this.env);
        if (!oauthState.nonce || !cookieNonce || cookieNonce !== oauthState.nonce) {
            logger.warn('OAuth callback nonce mismatch - possible login CSRF', {
                provider,
                hasStoredNonce: !!oauthState.nonce,
                hasCookieNonce: !!cookieNonce,
            });
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                msg('Invalid or expired OAuth state'),
                400
            );
        }

        // Mark state as used
        await this.database
            .update(schema.oauthStates)
            .set({ isUsed: true })
            .where(eq(schema.oauthStates.id, oauthState.id));

        return oauthState;
    }

    /**
     * Look up whether a still-valid, unused OAuth state is bound to a user (i.e. an
     * account-link flow). Returns the bound userId or null. Does not consume state.
     */
    async getPendingLinkUserId(
        provider: OAuthProvider,
        state: string
    ): Promise<string | null> {
        const row = await this.database
            .select({ userId: schema.oauthStates.userId })
            .from(schema.oauthStates)
            .where(
                and(
                    eq(schema.oauthStates.state, state),
                    eq(schema.oauthStates.provider, provider),
                    eq(schema.oauthStates.isUsed, false)
                )
            )
            .get();
        return row?.userId ?? null;
    }

    /**
     * Handle OAuth callback
     */
    async handleOAuthCallback(
        provider: OAuthProvider,
        code: string,
        state: string,
        request: Request
    ): Promise<AuthResult> {
        try {
            const oauthProvider = await this.getOauthProvider(provider, request);
            if (!oauthProvider) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    t("OAuth provider {value1} not configured", { value1: String(provider) }),
                    400
                );
            }
            
            // Validate the state (existence, expiry, browser nonce) and mark it used.
            const oauthState = await this.validateAndConsumeOAuthState(provider, state, request);

            // A state bound to a user is an account-link flow and must go through
            // completeOAuthLink (which re-checks the session), never the login path.
            if (oauthState.userId) {
                throw new SecurityError(
                    SecurityErrorType.CSRF_VIOLATION,
                    msg('Invalid OAuth state for login'),
                    400
                );
            }
            
            // Exchange code for tokens
            const tokens = await oauthProvider.exchangeCodeForTokens(
                code,
                oauthState.codeVerifier || undefined
            );
            
            // Get user info
            const oauthUserInfo = await oauthProvider.getUserInfo(tokens.accessToken);

            // Deployment-level admission gate (ALLOWED_EMAIL). Enforced BEFORE any
            // user row or session is created so a rejected email never gets admitted.
            enforceAllowedEmail(this.env, oauthUserInfo.email, 'oauth');

            // Find or create user. A new account starts in the language picked on the sign-in page, else the one the
            // browser asked for, so its emails do; an existing one keeps its own.
            const { user, created } = await this.findOrCreateOAuthUser(
                provider,
                oauthUserInfo,
                isLocale(oauthState.locale) ? oauthState.locale : localeFromAcceptLanguage(request.headers.get('Accept-Language'))
            );
            
            // Create session
            const { accessToken: sessionAccessToken, session } = await this.sessionService.createSession(
                user.id,
                request
            );
            
            // Log auth attempt
            await this.logAuthAttempt(user.email, `oauth_${provider}`, true, request);
            
            logger.info('OAuth login successful', { userId: user.id, provider });
            
            return {
                user: mapUserResponse(user),
                accessToken: sessionAccessToken,
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                redirectUrl: oauthState.redirectUri || undefined,
                isNewUser: created,
                // Surface raw provider tokens only for Cloudflare so the controller can
                // best-effort auto-connect the AI Gateway in the same round-trip.
                oauthTokens: provider === 'cloudflare' ? tokens : undefined,
            };
        } catch (error) {
            await this.logAuthAttempt('', `oauth_${provider}`, false, request);
            
            if (error instanceof SecurityError) {
                throw error;
            }
            
            logger.error('OAuth callback error', error);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                msg('OAuth authentication failed'),
                500
            );
        }
    }
    
    /**
     * Resolve the user for an OAuth login.
     *
     * Lookup is by the (provider, providerId) identity first. Without one, a
     * provider-verified email attaches the identity to the account with that
     * email when the account's email is confirmed. An unconfirmed account is
     * claimed only through Google or GitHub (see claimUnconfirmedAccount);
     * other providers are refused.
     */
    private async findOrCreateOAuthUser(
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo,
        newAccountLocale: Locale
    ): Promise<{ user: schema.User; created: boolean }> {
        // Fail closed unless the provider asserts the email is verified.
        if (oauthUserInfo.emailVerified !== true) {
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                msg('OAuth provider did not verify the email address'),
                401
            );
        }

        const email = oauthUserInfo.email.toLowerCase();

        // 1. Identity-first lookup: match by (provider, providerId).
        const identity = await this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(
                and(
                    eq(schema.userOauthIdentities.provider, provider),
                    eq(schema.userOauthIdentities.providerId, oauthUserInfo.id)
                )
            )
            .get();

        if (identity) {
            const now = new Date();
            // Refresh the identity's cached email/verification.
            await this.database
                .update(schema.userOauthIdentities)
                .set({ email, emailVerified: true, updatedAt: now })
                .where(eq(schema.userOauthIdentities.id, identity.id));

            // Refresh profile fields on the user, but never the primary
            // provider/providerId binding.
            await this.database
                .update(schema.users)
                .set({
                    displayName: oauthUserInfo.name || undefined,
                    avatarUrl: oauthUserInfo.picture || undefined,
                    updatedAt: now
                })
                .where(eq(schema.users.id, identity.userId));

            const user = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.id, identity.userId))
                .get();

            if (!user) {
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    msg('OAuth authentication failed'),
                    500
                );
            }
            return { user, created: false };
        }

        // An admin email is claimed only through a provider that verifies it,
        // so no other provider may create or auto-link an account under it.
        if (!mayClaimEmailByOAuth(provider, email)) {
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                ADMIN_EMAIL_PROVIDER_MESSAGE,
                403
            );
        }

        // 2. No identity match, but a user already exists with this email (local
        //    signup or a different provider). The provider has asserted the email
        //    is verified (checked above), so attach this provider to the existing
        //    account and sign the user into it instead of failing.
        const emailRow = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .get();

        if (emailRow) {
            if (emailRow.emailVerified === true) {
                await this.linkOAuthIdentity(emailRow.id, provider, oauthUserInfo);
                logger.info('Auto-linked OAuth provider to existing account', {
                    userId: emailRow.id,
                    provider
                });
                return { user: emailRow, created: false };
            }

            // Only a provider that verifies email itself proves who owns an unconfirmed address.
            if (!EMAIL_VERIFYING_PROVIDERS.includes(provider)) {
                throw new SecurityError(
                    SecurityErrorType.CONFLICT,
                    t("Sign in with your password, Google or GitHub, then connect {value1} from Settings.", { value1: String(providerLabel(provider)) }),
                    409
                );
            }

            return { user: await this.claimUnconfirmedAccount(emailRow, provider, oauthUserInfo), created: false };
        }

        // A provider sign-in that would create an account is refused; one that finds or claims an account isn't.
        if (await isFlagOn(this.env, 'signups-paused', null)) throw new SignupsPausedError();

        // 3. Brand-new identity: create the user and its first identity row.
        return { user: await this.createOAuthUser(provider, oauthUserInfo, newAccountLocale), created: true };
    }

    /**
     * Give an unconfirmed account to the owner a verifying provider just proved. Whoever set
     * its password may not own the address, so the password goes and the takeover cleanup runs,
     * all in one batch, which D1 runs as a transaction. The cleanup deletes every linked identity,
     * so the claiming one is inserted after it. The caller creates this sign-in's session afterwards.
     */
    private async claimUnconfirmedAccount(
        account: schema.User,
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo
    ): Promise<schema.User> {
        const now = new Date();
        const claimed = {
            ...PROVEN_OWNER_FIELDS,
            passwordHash: null,
            provider,
            providerId: oauthUserInfo.id,
            updatedAt: now,
        };

        await this.database.batch([
            ...this.takeoverCleanup(account.id),
            this.database
                .insert(schema.userOauthIdentities)
                .values(verifiedIdentityRow(account.id, provider, oauthUserInfo, now)),
            this.database.update(schema.users).set(claimed).where(eq(schema.users.id, account.id)),
        ]);

        logger.info('Claimed unconfirmed account through a verified provider', {
            userId: account.id,
            provider
        });
        return { ...account, ...claimed };
    }

    /**
     * Statements that strip an account of everything someone other than its address's owner
     * could have attached: linked sign-in methods, API keys, the payout account, custom model
     * routing, the connected Cloudflare account and its AI gateways, and every session. Callers
     * run them in one batch with their own users update (see PROVEN_OWNER_FIELDS).
     */
    private takeoverCleanup(userId: string) {
        return [
            this.database
                .delete(schema.userOauthIdentities)
                .where(eq(schema.userOauthIdentities.userId, userId)),
            this.database
                .update(schema.apiKeys)
                .set({ isActive: false, updatedAt: new Date() })
                .where(eq(schema.apiKeys.userId, userId)),
            // Past purchases keep the seller's Stripe account id, so sales history survives.
            this.database
                .delete(schema.stripeConnectAccounts)
                .where(eq(schema.stripeConnectAccounts.userId, userId)),
            this.database
                .delete(schema.userModelProviders)
                .where(eq(schema.userModelProviders.userId, userId)),
            this.database
                .delete(schema.userModelConfigs)
                .where(eq(schema.userModelConfigs.userId, userId)),
            // Gateways reference the Cloudflare account, so they go first.
            this.database.delete(schema.aiGateways).where(eq(schema.aiGateways.userId, userId)),
            this.database
                .delete(schema.cloudflareAccounts)
                .where(eq(schema.cloudflareAccounts.userId, userId)),
            revokeAllUserSessionsQuery(this.database, userId),
        ] as const;
    }

    /**
     * Create a new user from a verified OAuth identity, writing both the users
     * row (primary identity, for display/back-compat) and its user_oauth_identities row.
     */
    private async createOAuthUser(
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo,
        locale: Locale
    ): Promise<schema.User> {
        const userId = generateId();
        const now = new Date();
        const email = oauthUserInfo.email.toLowerCase();

        await this.database.insert(schema.users).values({
            id: userId,
            email,
            displayName: oauthUserInfo.name || email.split('@')[0],
            avatarUrl: oauthUserInfo.picture,
            emailVerified: true,
            provider,
            providerId: oauthUserInfo.id,
            preferences: { locale },
            createdAt: now,
            updatedAt: now
        });

        await this.database
            .insert(schema.userOauthIdentities)
            .values(verifiedIdentityRow(userId, provider, oauthUserInfo, now));

        const user = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();

        return user!;
    }

    /**
     * Complete an authenticated account-link callback: validate the state, verify
     * it is bound to the acting user, and attach the (provider, providerId) identity.
     */
    async completeOAuthLink(
        provider: OAuthProvider,
        code: string,
        state: string,
        request: Request,
        sessionUserId: string
    ): Promise<{ userId: string; provider: OAuthProvider; redirectUrl?: string }> {
        const oauthProvider = await this.getOauthProvider(provider, request);
        if (!oauthProvider) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                t("OAuth provider {value1} not configured", { value1: String(provider) }),
                400
            );
        }

        const oauthState = await this.validateAndConsumeOAuthState(provider, state, request);

        // The state must have been created by (and for) the acting session's user.
        if (!oauthState.userId || oauthState.userId !== sessionUserId) {
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                msg('Invalid account-link state'),
                403
            );
        }

        const tokens = await oauthProvider.exchangeCodeForTokens(
            code,
            oauthState.codeVerifier || undefined
        );
        const oauthUserInfo = await oauthProvider.getUserInfo(tokens.accessToken);

        await this.linkOAuthIdentity(oauthState.userId, provider, oauthUserInfo);

        return {
            userId: oauthState.userId,
            provider,
            redirectUrl: oauthState.redirectUri || undefined
        };
    }

    /**
     * Attach a verified OAuth identity to an existing user. Rejects if the identity
     * is already bound to a different user.
     */
    async linkOAuthIdentity(
        userId: string,
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo
    ): Promise<void> {
        if (oauthUserInfo.emailVerified !== true) {
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                msg('OAuth provider did not verify the email address'),
                401
            );
        }

        const email = oauthUserInfo.email.toLowerCase();
        const now = new Date();

        const existing = await this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(
                and(
                    eq(schema.userOauthIdentities.provider, provider),
                    eq(schema.userOauthIdentities.providerId, oauthUserInfo.id)
                )
            )
            .get();

        if (existing) {
            if (existing.userId !== userId) {
                throw new SecurityError(
                    SecurityErrorType.CONFLICT,
                    msg('This provider account is already linked to another user.'),
                    409
                );
            }
            // Already linked to this user; just refresh the cached email.
            await this.database
                .update(schema.userOauthIdentities)
                .set({ email, emailVerified: true, updatedAt: now })
                .where(eq(schema.userOauthIdentities.id, existing.id));
            return;
        }

        await this.database
            .insert(schema.userOauthIdentities)
            .values(verifiedIdentityRow(userId, provider, oauthUserInfo, now));

        logger.info('OAuth identity linked', { userId, provider });
    }

    /**
     * List the OAuth identities linked to a user.
     */
    async getUserIdentities(userId: string): Promise<schema.UserOauthIdentity[]> {
        return this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(eq(schema.userOauthIdentities.userId, userId))
            .all();
    }

    /**
     * Remove a linked OAuth identity. Refuses to remove the user's only remaining
     * login method (must keep at least one identity or a password).
     */
    async unlinkOAuthIdentity(userId: string, provider: OAuthProvider): Promise<void> {
        const identities = await this.getUserIdentities(userId);
        const target = identities.find((i) => i.provider === provider);

        if (!target) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                msg('No linked identity found for this provider.'),
                404
            );
        }

        const user = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();

        const hasPassword = !!user?.passwordHash;
        const remainingIdentities = identities.length - 1;
        if (remainingIdentities < 1 && !hasPassword) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                msg('Cannot remove your only login method.'),
                400
            );
        }

        await this.database
            .delete(schema.userOauthIdentities)
            .where(eq(schema.userOauthIdentities.id, target.id));

        // If the removed identity was the primary one on the users row, repoint the
        // primary to another remaining identity so display/back-compat stays coherent.
        if (user && user.provider === provider) {
            const next = identities.find((i) => i.provider !== provider);
            if (next) {
                await this.database
                    .update(schema.users)
                    .set({ provider: next.provider, providerId: next.providerId, updatedAt: new Date() })
                    .where(eq(schema.users.id, userId));
            }
        }

        logger.info('OAuth identity unlinked', { userId, provider });
    }
    
    /**
     * Log authentication attempt
     */
    private async logAuthAttempt(
        identifier: string,
        attemptType: string,
        success: boolean,
        request: Request
    ): Promise<void> {
        try {
            const requestMetadata = extractRequestMetadata(request);
            
            await this.database.insert(schema.authAttempts).values({
                identifier: identifier.toLowerCase(),
                attemptType: attemptType as 'login' | 'register' | 'oauth_google' | 'oauth_github' | 'oauth_cloudflare' | 'refresh' | 'reset_password',
                success: success,
                ipAddress: requestMetadata.ipAddress
            });
        } catch (error) {
            logger.error('Failed to log auth attempt', error);
        }
    }
    
    /**
     * Get user for authentication (for middleware)
     */
    async getUserForAuth(userId: string): Promise<AuthUser | null> {
        try {
            const user = await this.database
                .select({
                    id: schema.users.id,
                    email: schema.users.email,
                    displayName: schema.users.displayName,
                    username: schema.users.username,
                    avatarUrl: schema.users.avatarUrl,
                    bio: schema.users.bio,
                    timezone: schema.users.timezone,
                    provider: schema.users.provider,
                    emailVerified: schema.users.emailVerified,
                    createdAt: schema.users.createdAt,
                    termsVersion: schema.users.termsVersion,
                    locale: SAVED_LOCALE,
                })
                .from(schema.users)
                .where(
                    and(
                        eq(schema.users.id, userId),
                        isNull(schema.users.deletedAt),
                        eq(schema.users.isActive, true),
                        eq(schema.users.isSuspended, false),
                        or(
                            isNull(schema.users.lockedUntil),
                            lt(schema.users.lockedUntil, new Date())
                        )
                    )
                )
                .get()
                .catch((error: unknown) => {
                    logger.error('getUserForAuth query failed', {
                        errorMessage: error instanceof Error ? error.message : String(error),
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                        errorCause: (error as any)?.cause,
                        errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
                        userId
                    });
                    throw error;
                });
            
            if (!user) {
                logger.debug('User not found or not eligible for auth', { userId });
                return null;
            }
            
            return mapUserResponse(user);
        } catch (error: unknown) {
            logger.error('Error getting user for auth', {
                errorMessage: error instanceof Error ? error.message : String(error),
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorCause: (error as any)?.cause,
                userId
            });
            return null;
        }
    }

    /**
     * Whether an API key id still corresponds to an active, unexpired key.
     */
    private async isApiKeyActive(apiKeyId: string): Promise<boolean> {
        const apiKey = await this.apiKeyService.getApiKeyById(apiKeyId);
        if (!apiKey || !apiKey.isActive) {
            return false;
        }
        if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
            return false;
        }
        return true;
    }
    
    /**
     * Validate token and return user (for middleware).
     *
     * Treats the JWT as a pointer, not a self-contained credential: every token
     * is cross-checked against the live session / API key behind it, so logout,
     * session revoke, and API-key revoke all take effect immediately rather than
     * at token exp.
     */
    async validateTokenAndGetUser(token: string, env: Env): Promise<AuthUserSession | null> {
        try {
            const jwtUtils = JWTUtils.getInstance(env);
            const payload = await jwtUtils.verifyToken(token);
            
            if (!payload || payload.type !== 'access') {
                return null;
            }
            
            // Check if token is expired
            if (payload.exp * 1000 < Date.now()) {
                logger.debug('Token expired', { exp: payload.exp });
                return null;
            }

            if (!payload.sessionId) {
                return null;
            }

            // Cross-check the session / API key behind this token is still live.
            if (payload.sessionId.startsWith('api_key:')) {
                // API-key-derived token: resolve the synthetic sessionId back to the
                // source key and require it to still be active.
                const apiKeyId = payload.sessionId.slice('api_key:'.length);
                if (!(await this.isApiKeyActive(apiKeyId))) {
                    return null;
                }
            } else {
                const session = await this.sessionService.getSessionById(payload.sessionId);
                if (!session || session.isRevoked) {
                    return null;
                }
                if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
                    return null;
                }
            }
            
            // Get user (also enforces account status)
            const user = await this.getUserForAuth(payload.sub);
            if (!user) {
                return null;
            }
            
            return {
                user,
                sessionId: payload.sessionId,
            };
        } catch (error) {
            logger.error('Token validation error', error);
            return null;
        }
    }
    
}
