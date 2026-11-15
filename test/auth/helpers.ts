import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createAuth, type AuthInstance } from '../../src/modules/auth';
import { authSchema } from '../../src/modules/auth/schema';

export const TEST_SECRET = 'orbiscast-better-auth-test-secret-0123456789';
export const TEST_BASE_URL = 'http://127.0.0.1:3100';

const SCHEMA_SQL = `
CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
    updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
    username TEXT UNIQUE,
    displayUsername TEXT
);

CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
    updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX session_user_id_idx ON session(userId);

CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
    updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX account_user_id_idx ON account(userId);

CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
    updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX verification_identifier_idx ON verification(identifier);
`;

export type TestDatabase = BetterSQLite3Database<typeof authSchema>;

export interface TestAuthContext {
    sqlite: Database.Database;
    db: TestDatabase;
    auth: AuthInstance;
    close: () => void;
}

/**
 * Creates an in-memory SQLite database and a Better Auth instance using the
 * production schema.
 *
 * @returns Test handles plus a close function
 */
export function createTestAuthContext(): TestAuthContext {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(SCHEMA_SQL);

    const db = drizzle(sqlite, { schema: authSchema });
    const auth = createAuth({
        db,
        secret: TEST_SECRET,
        baseURL: TEST_BASE_URL,
    });

    return {
        sqlite,
        db,
        auth,
        close: () => sqlite.close(),
    };
}

/**
 * Extracts the signed Better Auth session cookie from response headers.
 *
 * @param headers - Headers returned by a sign-in or sign-up call
 * @returns A Cookie header value suitable for a follow-up request
 */
export function sessionCookie(headers: Headers): string {
    const cookie = headers.getSetCookie().find(value => value.startsWith('better-auth.session_token='));
    if (!cookie) {
        throw new Error('Better Auth did not set a session cookie');
    }
    const pair = cookie.split(';')[0];
    if (!pair) {
        throw new Error('Better Auth returned an empty session cookie');
    }
    return pair;
}
