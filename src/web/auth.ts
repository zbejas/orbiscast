import type { RequestHandler } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { Db } from '../modules/database/client';
import type { SettingsService } from '../modules/settings';
import {
    createAuth,
    fromNodeHeaders,
    getSession,
    toNodeHandler,
    type AuthInstance,
} from '../modules/auth';
import { createAdmin, hasAnyUser, AuthSetupError, AuthValidationError, type AdminUser } from '../modules/auth/setup';

export interface AuthLoginResult {
    user: { id: string; name: string };
    cookies: string[];
}

export interface AuthAdapter {
    handle: RequestHandler;
    middleware: RequestHandler;
    instance: AuthInstance;
    hasUser: () => Promise<boolean>;
    createAdmin: (username: string, password: string) => Promise<AdminUser>;
    readSession: (headers: IncomingHttpHeaders) => Promise<unknown>;
    login: (username: string, password: string) => Promise<AuthLoginResult>;
    logout: (headers: IncomingHttpHeaders) => Promise<string[]>;
}

/**
 * Builds the Better Auth instance and the Express adapters.
 *
 * The instance exists even while auth is disabled so the operator can enable
 * it from Settings without restarting the process.
 *
 * @param options - Drizzle database and settings service
 * @returns Express handlers and auth helpers
 */
export function createAuthAdapter(options: { db: Db; settings: SettingsService }): AuthAdapter {
    const ui = options.settings.getUi();
    const auth = createAuth({
        db: options.db,
        secret: options.settings.getAuthSecret(),
        baseURL: ui.publicUrl || undefined,
        trustedOrigins: ui.trustedOrigins,
    });

    const handle = toNodeHandler(auth) as unknown as RequestHandler;
    const middleware: RequestHandler = async (req, res, next) => {
        try {
            const session = await getSession(auth, fromNodeHeaders(req.headers));
            if (!session) {
                res.status(401).json({
                    error: { code: 'authentication_required', message: 'Sign in to continue' },
                });
                return;
            }
            (req as { session?: unknown }).session = session;
            next();
        } catch (error) {
            next(error);
        }
    };

    const signIn = async (username: string, password: string): Promise<AuthLoginResult> => {
        const result = (await auth.api.signInUsername({
            body: { username, password },
            returnHeaders: true,
        })) as {
            headers: Headers;
            response: { user?: { id: string; name: string } };
        };
        const user = result.response.user;
        if (!user) {
            throw new Error('Sign in did not return a user');
        }
        return {
            user: { id: user.id, name: user.name },
            cookies: result.headers.getSetCookie(),
        };
    };

    const signOut = async (headers: IncomingHttpHeaders): Promise<string[]> => {
        const result = (await auth.api.signOut({
            headers: fromNodeHeaders(headers),
            returnHeaders: true,
        })) as { headers: Headers };
        return result.headers.getSetCookie();
    };

    return {
        handle,
        middleware,
        instance: auth,
        hasUser: () => hasAnyUser(auth),
        createAdmin: (username, password) => createAdmin(auth, { username, password }),
        readSession: headers => getSession(auth, fromNodeHeaders(headers)),
        login: signIn,
        logout: signOut,
    };
}
