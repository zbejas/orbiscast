import type { PlaybackStateDto } from '@shared/types';

/**
 * Returns the current playback position in milliseconds. While playing, the
 * position advances from the last server update; while paused, it stays put.
 *
 * @param state - Playback state from the API
 * @param now - Client clock in epoch milliseconds
 * @returns Position in milliseconds
 */
export function playbackPositionMs(
    state: PlaybackStateDto | null | undefined,
    now: number
): number {
    if (!state) {
        return 0;
    }
    if (state.positionMs !== null) {
        const elapsed = state.paused ? 0 : Math.max(0, now - (state.positionUpdatedAt ?? now));
        return Math.max(0, state.positionMs + elapsed);
    }
    return state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0;
}
