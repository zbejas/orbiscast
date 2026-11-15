import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    AuthenticationRequiredError,
    createSessionReader,
    getSession,
    requireSession,
} from '../../src/modules/auth';
import {
    createAdmin,
    hasAnyUser,
} from '../../src/modules/auth/setup';
import {
    createTestAuthContext,
    sessionCookie,
    type TestAuthContext,
} from './helpers';

describe('Better Auth username and password', () => {
    let context: TestAuthContext;

    beforeEach(() => {
        context = createTestAuthContext();
    });

    afterEach(() => {
        context.close();
    });

    it('creates one admin with a normalized username and a local email', async () => {
        const { auth, sqlite } = context;

        expect(await hasAnyUser(auth)).toBe(false);

        const admin = await createAdmin(auth, {
            username: ' Admin.User ',
            password: 'correct horse battery',
        });

        expect(admin.username).toBe('admin.user');
        expect(admin.displayUsername).toBe('Admin.User');
        expect(await hasAnyUser(auth)).toBe(true);

        const stored = sqlite
            .prepare('SELECT email, name, username, displayUsername FROM user')
            .get() as {
                email: string;
                name: string;
                username: string;
                displayUsername: string;
            };

        expect(stored).toEqual({
            email: 'admin.user@orbiscast.local',
            name: 'Admin.User',
            username: 'admin.user',
            displayUsername: 'Admin.User',
        });

        const credential = sqlite
            .prepare('SELECT providerId, password FROM account')
            .get() as { providerId: string; password: string };

        expect(credential.providerId).toBe('credential');
        expect(credential.password).not.toBe('correct horse battery');
        expect(credential.password.length).toBeGreaterThan(0);

        const sessions = sqlite.prepare('SELECT COUNT(*) AS count FROM session').get() as { count: number };
        expect(sessions.count).toBe(0);
    });

    it('signs in, reads the session from headers, and signs out', async () => {
        const { auth } = context;
        const admin = await createAdmin(auth, {
            username: 'admin',
            password: 'password123',
        });

        const signIn = await auth.api.signInUsername({
            body: {
                username: 'ADMIN',
                password: 'password123',
            },
            returnHeaders: true,
        });

        expect(signIn.response.user.id).toBe(admin.id);
        expect(signIn.response.user.username).toBe('admin');

        const headers = new Headers({ cookie: sessionCookie(signIn.headers) });
        const session = await getSession(auth, headers);
        expect(session?.user.id).toBe(admin.id);
        expect(session?.user.username).toBe('admin');

        const readSession = createSessionReader(auth);
        expect((await readSession(headers))?.user.id).toBe(admin.id);
        expect((await requireSession(auth, headers)).user.id).toBe(admin.id);

        await auth.api.signOut({ headers });
        expect(await getSession(auth, headers)).toBeNull();
    });

    it('rejects a wrong password without creating a session', async () => {
        const { auth, sqlite } = context;
        await createAdmin(auth, {
            username: 'admin',
            password: 'password123',
        });

        await expect(
            auth.api.signInUsername({
                body: {
                    username: 'admin',
                    password: 'not-the-password',
                },
            }),
        ).rejects.toMatchObject({
            status: 'UNAUTHORIZED',
            body: {
                code: 'INVALID_USERNAME_OR_PASSWORD',
            },
        });

        const sessions = sqlite.prepare('SELECT COUNT(*) AS count FROM session').get() as { count: number };
        expect(sessions.count).toBe(0);
    });

    it('rejects a duplicate username', async () => {
        const { auth, sqlite } = context;
        await createAdmin(auth, {
            username: 'admin',
            password: 'password123',
        });

        await expect(
            auth.api.signUpEmail({
                body: {
                    email: 'another@orbiscast.local',
                    name: 'Another Admin',
                    password: 'password456',
                    username: 'admin',
                    displayUsername: 'admin',
                },
            }),
        ).rejects.toMatchObject({
            body: {
                code: 'USERNAME_IS_ALREADY_TAKEN',
            },
        });

        const users = sqlite.prepare('SELECT COUNT(*) AS count FROM user').get() as { count: number };
        expect(users.count).toBe(1);
    });

    it('refuses to create a second admin', async () => {
        const { auth } = context;
        await createAdmin(auth, {
            username: 'admin',
            password: 'password123',
        });

        await expect(
            createAdmin(auth, {
                username: 'second',
                password: 'password456',
            }),
        ).rejects.toThrow('An admin account already exists');
    });

    it('requires a session for protected work', async () => {
        const { auth } = context;

        await expect(requireSession(auth, new Headers())).rejects.toBeInstanceOf(
            AuthenticationRequiredError,
        );
    });
});
