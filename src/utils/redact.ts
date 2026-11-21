const PLEX_TOKEN = /(X-Plex-Token=)[^&\s"'`]+/gi;
const EMBY_TOKEN = /(X-Emby-Token\s*[:=]\s*)[^\s"',;]+/gi;
const MEDIABROWSER_TOKEN = /(MediaBrowser\s+Token\s*=\s*"?)[^"\s,;]+/gi;
const AUTH_HEADER = /((?:authorization)\s*[:=]\s*)(?:MediaBrowser\s+Token\s*=\s*"?[^"\s,;]+"?|(?:Bot\s+)?[^\s"',;]+)/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const URL_USERINFO = /(\/\/)[^/@\s'"]+@/g;
const URL_CREDENTIALS = /([?&](?:username|password|user|pass|token|api_key|apikey)=)[^&#\s]*/gi;
const STREAM_PATH = /(\/(?:live|movie|series|timeshift)\/)[^/\s]+\/[^/\s]+\//gi;

/**
 * Masks credentials in a provider URL so it can be logged safely. Handles
 * `user:pass@host`, `username=`/`password=` query parameters, and Xtream-style
 * paths such as `/live/<user>/<pass>/<id>`.
 *
 * @param url - URL that may contain credentials
 * @returns URL with credentials replaced by `***`
 */
export function redactUrl(url: string): string {
    if (!url) {
        return url;
    }
    return url
        .replace(URL_USERINFO, '$1***@')
        .replace(URL_CREDENTIALS, '$1***')
        .replace(STREAM_PATH, '$1***/***/');
}

/**
 * Removes common credential patterns from a string before it is logged or
 * returned in an error message.
 *
 * @param input - Raw string
 * @returns Redacted string
 */
export function redactSecrets(input: string): string {
    return redactUrl(
        input
            .replace(PLEX_TOKEN, '$1redacted')
            .replace(EMBY_TOKEN, '$1redacted')
            .replace(MEDIABROWSER_TOKEN, '$1redacted')
            .replace(AUTH_HEADER, '$1redacted')
            .replace(BEARER, '$1redacted')
    );
}
