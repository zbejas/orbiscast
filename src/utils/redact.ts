const PLEX_TOKEN = /(X-Plex-Token=)[^&\s"'`]+/gi;
const AUTH_HEADER = /((?:authorization)\s*[:=]\s*)(?:Bot\s+)?[^\s"',;]+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/**
 * Removes common credential patterns from a string before it is logged or
 * returned in an error message.
 *
 * @param input - Raw string
 * @returns Redacted string
 */
export function redactSecrets(input: string): string {
    return input
        .replace(PLEX_TOKEN, '$1redacted')
        .replace(AUTH_HEADER, '$1redacted')
        .replace(BEARER, '$1redacted');
}
