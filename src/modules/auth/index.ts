import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { authSchema } from './schema';

const MIN_SECRET_LENGTH = 32;

/**
 * Options for {@link createAuth}.
 */
export interface CreateAuthOptions {
    /** Drizzle database backed by better-sqlite3, with or without app tables. */
    db: BetterSQLite3Database<Record<string, unknown>>;
    /** Secret used to sign session cookies and tokens. At least 32 characters. */
    secret: string;
    /** Public origin of the WebUI, for example `https://orbiscast.example.com`. */
    baseURL?: string;
    /** Extra origins allowed to call the auth endpoints. */
    trustedOrigins?: string[];
}

/**
 * Creates the Better Auth instance used by the WebUI.
 *
 * The instance is framework agnostic: it exposes the Better Auth handler and
 * API, and callers wire it to Express with {@link toNodeHandler}. Sign-up does
 * not create a session automatically. The setup flow creates one admin and the
 * admin then signs in with username and password.
 *
 * @param options - Database, secret, and optional URL configuration
 * @returns The configured Better Auth instance
 */
export function createAuth(options: CreateAuthOptions) {
    const { db, secret, baseURL, trustedOrigins } = options;

    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(`Authentication secret must be at least ${MIN_SECRET_LENGTH} characters`);
    }

    return betterAuth({
        database: drizzleAdapter(db, {
            provider: 'sqlite',
            schema: authSchema,
        }),
        secret,
        baseURL,
        trustedOrigins,
        emailAndPassword: {
            enabled: true,
            autoSignIn: false,
            minPasswordLength: 8,
            maxPasswordLength: 128,
        },
        advanced: {
            // The WebUI is often reached over plain HTTP on a LAN. Mark the
            // session cookie Secure only when the configured public URL is
            // HTTPS, otherwise browsers discard it and login cannot complete.
            useSecureCookies: Boolean(baseURL?.startsWith('https://')),
        },
        plugins: [username()],
    });
}

/**
 * The concrete Better Auth instance produced by {@link createAuth}, including
 * the username plugin endpoints and inferred session types.
 */
export type AuthInstance = ReturnType<typeof createAuth>;

/**
 * Authenticated session and user returned by Better Auth.
 */
export type AuthSession = NonNullable<Awaited<ReturnType<AuthInstance['api']['getSession']>>>;

/**
 * Reads the current session from request headers.
 *
 * Pass `req.headers` as a standard `Headers` object. Use
 * `fromNodeHeaders(req.headers)` from this module when working with Express or
 * another Node HTTP framework.
 *
 * @param auth - Auth instance created by {@link createAuth}
 * @param headers - Request headers containing the session cookie
 * @returns The session and user, or null when the request is unauthenticated
 */
export async function getSession(auth: AuthInstance, headers: Headers): Promise<AuthSession | null> {
    return auth.api.getSession({ headers });
}

/**
 * Builds a session reader bound to one auth instance.
 *
 * @param auth - Auth instance created by {@link createAuth}
 * @returns A function that accepts request headers and resolves the session
 */
export function createSessionReader(auth: AuthInstance): (headers: Headers) => Promise<AuthSession | null> {
    return headers => getSession(auth, headers);
}

/**
 * Error thrown by {@link requireSession} when no valid session is present.
 */
export class AuthenticationRequiredError extends Error {
    constructor() {
        super('Authentication required');
        this.name = 'AuthenticationRequiredError';
    }
}

/**
 * Reads the current session and throws when the request is unauthenticated.
 *
 * This is intentionally framework agnostic so Express and other adapters can
 * translate {@link AuthenticationRequiredError} into their own response.
 *
 * @param auth - Auth instance created by {@link createAuth}
 * @param headers - Request headers containing the session cookie
 * @returns The authenticated session and user
 */
export async function requireSession(auth: AuthInstance, headers: Headers): Promise<AuthSession> {
    const session = await getSession(auth, headers);
    if (!session) {
        throw new AuthenticationRequiredError();
    }
    return session;
}

export { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
export { authSchema } from './schema';
