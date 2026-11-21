import { describe, expect, it } from 'vitest';
import { BOT_INVITE_PERMISSIONS, buildBotInviteUrl } from '../src/modules/setup/invite';

describe('bot invite URL', () => {
    it('requests the bot and application command scopes', () => {
        const invite = buildBotInviteUrl('123456789012345678');
        expect(invite).not.toBeNull();

        const url = new URL(invite as string);
        expect(`${url.origin}${url.pathname}`).toBe('https://discord.com/oauth2/authorize');
        expect(url.searchParams.get('client_id')).toBe('123456789012345678');
        expect(url.searchParams.get('scope')).toBe('bot applications.commands');
        expect(url.searchParams.get('permissions')).toBe(BOT_INVITE_PERMISSIONS.toString());
    });

    it('rejects missing and malformed application IDs', () => {
        expect(buildBotInviteUrl(null)).toBeNull();
        expect(buildBotInviteUrl(undefined)).toBeNull();
        expect(buildBotInviteUrl('')).toBeNull();
        expect(buildBotInviteUrl('not-a-snowflake')).toBeNull();
        expect(buildBotInviteUrl('123')).toBeNull();
    });

    it('requests exactly the permissions the bot needs', () => {
        expect(BOT_INVITE_PERMISSIONS).toBe(3_230_721n);
    });
});
