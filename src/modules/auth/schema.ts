import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Better Auth user table.
 *
 * Email is required by Better Auth's email and password flow even when the
 * username plugin is enabled. OrbisCast stores a local synthetic address in
 * this column and never shows it in the WebUI.
 */
export const user = sqliteTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
        .notNull()
        .default(sql`(unixepoch())`)
        .$onUpdate(() => new Date()),
    username: text('username').unique(),
    displayUsername: text('displayUsername'),
});

/**
 * Better Auth session table.
 */
export const session = sqliteTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        token: text('token').notNull().unique(),
        createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
        updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
        ipAddress: text('ipAddress'),
        userAgent: text('userAgent'),
        userId: text('userId')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
    },
    table => [index('session_user_id_idx').on(table.userId)],
);

/**
 * Better Auth account table. The credential provider stores the password hash
 * in the `password` column.
 */
export const account = sqliteTable(
    'account',
    {
        id: text('id').primaryKey(),
        accountId: text('accountId').notNull(),
        providerId: text('providerId').notNull(),
        userId: text('userId')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        accessToken: text('accessToken'),
        refreshToken: text('refreshToken'),
        idToken: text('idToken'),
        accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
        refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
        scope: text('scope'),
        password: text('password'),
        createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .default(sql`(unixepoch())`)
            .$onUpdate(() => new Date()),
    },
    table => [index('account_user_id_idx').on(table.userId)],
);

/**
 * Better Auth verification table. It is unused by the username and password
 * flow, but Better Auth expects it to exist.
 */
export const verification = sqliteTable(
    'verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .default(sql`(unixepoch())`)
            .$onUpdate(() => new Date()),
    },
    table => [index('verification_identifier_idx').on(table.identifier)],
);

/**
 * Schema object passed to the Better Auth Drizzle adapter.
 */
export const authSchema = {
    user,
    session,
    account,
    verification,
};

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
