import type { PlaybackViewerDto } from '../../shared/types';

export interface VoiceMember {
    id: string;
    channelId: string | null;
    bot: boolean;
    displayName: string;
    username: string;
}

/**
 * Selects the non-bot members in a voice channel, excluding the streamer.
 *
 * @param members - Voice states known for the guild
 * @param channelId - Voice channel to inspect
 * @param selfId - Streaming account user id
 * @returns Viewers sorted by display name
 */
export function selectViewers(
    members: Iterable<VoiceMember>,
    channelId: string,
    selfId: string | null | undefined
): PlaybackViewerDto[] {
    const viewers: PlaybackViewerDto[] = [];
    for (const member of members) {
        if (member.channelId !== channelId || member.bot || member.id === selfId) {
            continue;
        }
        const displayName = member.displayName.trim() || member.username.trim() || 'Unknown viewer';
        viewers.push({ id: member.id, displayName });
    }
    return viewers.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
