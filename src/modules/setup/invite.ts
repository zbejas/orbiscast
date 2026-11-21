/**
 * Permissions the bot needs to run OrbisCast in a server.
 *
 * Create Instant Invite, View Channels, Send Messages, Embed Links, Read
 * Message History, Connect, Speak.
 */
export const BOT_INVITE_PERMISSIONS =
    (1n << 0n) | // Create Instant Invite
    (1n << 10n) | // View Channels
    (1n << 11n) | // Send Messages
    (1n << 14n) | // Embed Links
    (1n << 16n) | // Read Message History
    (1n << 20n) | // Connect
    (1n << 21n); // Speak

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Builds the OAuth2 URL that adds the bot to a server.
 *
 * The application ID is the bot's user ID. Invalid or missing IDs return null
 * so the WebUI can hide the invite action instead of rendering a broken link.
 *
 * @param applicationId - Bot application ID
 * @param permissions - Permission bitfield to request
 * @returns Invite URL, or null when the application ID is not usable
 */
export function buildBotInviteUrl(
    applicationId: string | null | undefined,
    permissions: bigint = BOT_INVITE_PERMISSIONS
): string | null {
    if (!applicationId || !SNOWFLAKE.test(applicationId)) {
        return null;
    }

    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', applicationId);
    url.searchParams.set('scope', 'bot applications.commands');
    url.searchParams.set('permissions', permissions.toString());
    return url.toString();
}
