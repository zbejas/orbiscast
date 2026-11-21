import type { MediaSourceRecord } from '../../database/repo';
import { PlexProvider } from './plex';
import { JellyfinProvider } from './jellyfin';
import type { MediaProvider } from '../types';

/**
 * Builds the provider for a stored media source.
 *
 * @param source - Source row with the token still encrypted
 * @param token - Decrypted provider token
 * @returns Provider implementation
 */
export function createMediaProvider(source: MediaSourceRecord, token: string): MediaProvider {
    if (source.kind === 'jellyfin') {
        return new JellyfinProvider({
            baseUrl: source.baseUrl,
            token,
            clientIdentifier: source.clientIdentifier,
            userId: source.userId,
        });
    }
    return new PlexProvider({
        baseUrl: source.baseUrl,
        token,
        clientIdentifier: source.clientIdentifier,
    });
}
