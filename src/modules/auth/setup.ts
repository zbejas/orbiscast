import type { AuthInstance } from './index';

/** Password length accepted by Better Auth and the setup helpers. */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum password length accepted by Better Auth and the setup helpers. */
export const MAX_PASSWORD_LENGTH = 128;

/** Username length accepted by the Better Auth username plugin. */
export const MIN_USERNAME_LENGTH = 3;

/** Username length accepted by the Better Auth username plugin. */
export const MAX_USERNAME_LENGTH = 30;

/** Domain used for the local synthetic email address Better Auth requires. */
export const SYNTHETIC_EMAIL_DOMAIN = 'orbiscast.local';

const USERNAME_PATTERN = /^[A-Za-z0-9_.]+$/;

/**
 * Credentials entered in the first-run setup form.
 */
export interface AdminCredentials {
    username: string;
    password: string;
}

/**
 * Public admin details returned by {@link createAdmin}. The synthetic email
 * address is deliberately not exposed.
 */
export interface AdminUser {
    id: string;
    username: string;
    displayUsername: string;
}

/**
 * Error raised when the first-run admin setup cannot proceed.
 */
export class AuthSetupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthSetupError';
    }
}

/**
 * Error raised when a username or password fails local validation.
 */
export class AuthValidationError extends Error {
    readonly field: 'username' | 'password';

    constructor(field: 'username' | 'password', message: string) {
        super(message);
        this.name = 'AuthValidationError';
        this.field = field;
    }
}

/**
 * Validates a username against the rules used by the username plugin.
 *
 * Surrounding whitespace is ignored. Usernames are compared case-insensitively
 * by Better Auth and stored in lowercase; the original casing is kept in the
 * display username.
 *
 * @param username - Value to validate
 * @throws {AuthValidationError} When the username is missing or invalid
 */
export function validateUsername(username: unknown): asserts username is string {
    if (typeof username !== 'string') {
        throw new AuthValidationError('username', 'Username must be a string');
    }

    const value = username.trim();
    if (value.length < MIN_USERNAME_LENGTH) {
        throw new AuthValidationError(
            'username',
            `Username must be at least ${MIN_USERNAME_LENGTH} characters`,
        );
    }
    if (value.length > MAX_USERNAME_LENGTH) {
        throw new AuthValidationError(
            'username',
            `Username must be at most ${MAX_USERNAME_LENGTH} characters`,
        );
    }
    if (!USERNAME_PATTERN.test(value)) {
        throw new AuthValidationError(
            'username',
            'Username can only contain letters, numbers, underscores, and dots',
        );
    }
}

/**
 * Validates a password against the Better Auth password limits.
 *
 * Passwords are not trimmed: leading and trailing spaces are significant.
 *
 * @param password - Value to validate
 * @throws {AuthValidationError} When the password is missing or too short/long
 */
export function validatePassword(password: unknown): asserts password is string {
    if (typeof password !== 'string') {
        throw new AuthValidationError('password', 'Password must be a string');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new AuthValidationError(
            'password',
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        throw new AuthValidationError(
            'password',
            `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
        );
    }
}

/**
 * Reports whether Better Auth already has a user.
 *
 * This is used by the first-run flow to decide between the setup form and the
 * sign-in form.
 *
 * @param auth - Auth instance created by `createAuth`
 * @returns True when at least one user exists
 */
export async function hasAnyUser(auth: AuthInstance): Promise<boolean> {
    const context = await auth.$context;
    const count = await context.adapter.count({ model: 'user' });
    return count > 0;
}

/**
 * Creates the single admin account.
 *
 * Better Auth requires an email address even when the username plugin is used,
 * so this helper stores `${username}@orbiscast.local`. The address is not
 * returned and must not be shown in the WebUI.
 *
 * @param auth - Auth instance created by `createAuth`
 * @param credentials - Admin username and password
 * @returns Public details of the created admin
 * @throws {AuthValidationError} When the username or password is invalid
 * @throws {AuthSetupError} When an admin account already exists
 */
export async function createAdmin(auth: AuthInstance, credentials: AdminCredentials): Promise<AdminUser> {
    const username = credentials.username.trim();
    validateUsername(username);
    validatePassword(credentials.password);

    if (await hasAnyUser(auth)) {
        throw new AuthSetupError('An admin account already exists');
    }

    const result = await auth.api.signUpEmail({
        body: {
            email: `${username.toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`,
            name: username,
            password: credentials.password,
            username,
            displayUsername: username,
        },
    });

    return {
        id: result.user.id,
        username: result.user.username ?? username.toLowerCase(),
        displayUsername: result.user.displayUsername ?? username,
    };
}
