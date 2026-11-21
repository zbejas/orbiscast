import { describe, expect, it } from 'vitest';
import { plexSubtitleStreamId } from '../../src/modules/media/providers/plex';
import type { MediaStream } from '../../src/modules/media/types';

function subtitle(id: number, index: number | null): MediaStream {
    return {
        id,
        index,
        type: 'subtitle',
        codec: 'ass',
        language: 'English',
        displayTitle: 'English',
        default: false,
        forced: false,
        burnable: index !== null,
    };
}

describe('plexSubtitleStreamId', () => {
    it('maps the per-part index to the global stream id', () => {
        const streams = [subtitle(1730579, 2), subtitle(1730590, 13)];
        expect(plexSubtitleStreamId(streams, 2)).toBe(1730579);
        expect(plexSubtitleStreamId(streams, 13)).toBe(1730590);
    });

    it('returns null when subtitles are off', () => {
        expect(plexSubtitleStreamId([subtitle(1730579, 2)], null)).toBeNull();
    });

    it('falls back to the index when no stream matches', () => {
        expect(plexSubtitleStreamId([subtitle(1730579, 2)], 5)).toBe(5);
    });
});
