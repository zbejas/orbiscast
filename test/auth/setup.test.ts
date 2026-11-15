import { describe, expect, it } from 'vitest';
import {
    AuthValidationError,
    MAX_PASSWORD_LENGTH,
    MAX_USERNAME_LENGTH,
    MIN_PASSWORD_LENGTH,
    MIN_USERNAME_LENGTH,
    createAdmin,
    validatePassword,
    validateUsername,
} from '../../src/modules/auth/setup';
import { createTestAuthContext } from './helpers';

describe('validateUsername', () => {
    it('accepts usernames allowed by the Better Auth plugin', () => {
        expect(() => validateUsername('admin')).not.toThrow();
        expect(() => validateUsername('Admin.User')).not.toThrow();
        expect(() => validateUsername('admin_user.2')).not.toThrow();
        expect(() => validateUsername('  admin  ')).not.toThrow();
        expect(() => validateUsername('a'.repeat(MIN_USERNAME_LENGTH))).not.toThrow();
        expect(() => validateUsername('a'.repeat(MAX_USERNAME_LENGTH))).not.toThrow();
    });

    it('rejects non-string values', () => {
        expect(() => validateUsername(undefined)).toThrow('Username must be a string');
        expect(() => validateUsername(42)).toThrow(AuthValidationError);
    });

    it('rejects usernames that are too short or too long', () => {
        expect(() => validateUsername('')).toThrow(`at least ${MIN_USERNAME_LENGTH} characters`);
        expect(() => validateUsername('ab')).toThrow(`at least ${MIN_USERNAME_LENGTH} characters`);
        expect(() => validateUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toThrow(
            `at most ${MAX_USERNAME_LENGTH} characters`,
        );
    });

    it('rejects unsupported characters', () => {
        expect(() => validateUsername('admin user')).toThrow('letters, numbers, underscores, and dots');
        expect(() => validateUsername('admin@example.com')).toThrow(
            'letters, numbers, underscores, and dots',
        );
        expect(() => validateUsername('admin-name')).toThrow('letters, numbers, underscores, and dots');
        expect(() => validateUsername('café')).toThrow('letters, numbers, underscores, and dots');
    });

    it('exposes the failing field', () => {
        try {
            validateUsername('a');
            throw new Error('Expected validation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(AuthValidationError);
            expect((error as AuthValidationError).field).toBe('username');
        }
    });
});

describe('validatePassword', () => {
    it('accepts passwords within the Better Auth limits', () => {
        expect(() => validatePassword('password')).not.toThrow();
        expect(() => validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
        expect(() => validatePassword('a'.repeat(MAX_PASSWORD_LENGTH))).not.toThrow();
        expect(() => validatePassword(' leading and trailing ')).not.toThrow();
    });

    it('rejects non-string values', () => {
        expect(() => validatePassword(null)).toThrow('Password must be a string');
    });

    it('rejects passwords that are too short or too long', () => {
        expect(() => validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
            `at least ${MIN_PASSWORD_LENGTH} characters`,
        );
        expect(() => validatePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toThrow(
            `at most ${MAX_PASSWORD_LENGTH} characters`,
        );
    });

    it('exposes the failing field', () => {
        try {
            validatePassword('short');
            throw new Error('Expected validation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(AuthValidationError);
            expect((error as AuthValidationError).field).toBe('password');
        }
    });
});

describe('createAdmin validation', () => {
    it('rejects invalid credentials before touching the database', async () => {
        const context = createTestAuthContext();

        try {
            await expect(
                createAdmin(context.auth, {
                    username: 'admin user',
                    password: 'password123',
                }),
            ).rejects.toBeInstanceOf(AuthValidationError);

            await expect(
                createAdmin(context.auth, {
                    username: 'admin',
                    password: 'short',
                }),
            ).rejects.toBeInstanceOf(AuthValidationError);

            const users = context.sqlite.prepare('SELECT COUNT(*) AS count FROM user').get() as {
                count: number;
            };
            expect(users.count).toBe(0);
        } finally {
            context.close();
        }
    });
});
