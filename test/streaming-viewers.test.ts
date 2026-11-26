import { describe, expect, it } from 'vitest';
import { selectViewers, type VoiceMember } from '../src/modules/streaming/viewers';

function member(overrides: Partial<VoiceMember> & Pick<VoiceMember, 'id'>): VoiceMember {
    return {
        channelId: 'voice-1',
        bot: false,
        displayName: overrides.id,
        username: overrides.id.toLowerCase(),
        ...overrides,
    };
}

describe('selectViewers', () => {
    it('drops the streamer, bots, and members in other channels', () => {
        const viewers = selectViewers(
            [
                member({ id: 'streamer' }),
                member({ id: 'alice', displayName: 'Alice' }),
                member({ id: 'bot', bot: true, displayName: 'Music Bot' }),
                member({ id: 'elsewhere', channelId: 'voice-2', displayName: 'Bob' }),
            ],
            'voice-1',
            'streamer'
        );

        expect(viewers).toEqual([{ id: 'alice', displayName: 'Alice' }]);
    });

    it('sorts viewers by display name', () => {
        const viewers = selectViewers(
            [
                member({ id: 'carol', displayName: 'Carol' }),
                member({ id: 'alice', displayName: 'Alice' }),
                member({ id: 'bob', displayName: 'Bob' }),
            ],
            'voice-1',
            'streamer'
        );

        expect(viewers.map(viewer => viewer.id)).toEqual(['alice', 'bob', 'carol']);
    });

    it('falls back to the username when the display name is blank', () => {
        const viewers = selectViewers(
            [
                member({ id: 'alice', displayName: '   ', username: 'alpha' }),
                member({ id: 'bob', displayName: '', username: '' }),
            ],
            'voice-1',
            'streamer'
        );

        expect(viewers).toEqual([
            { id: 'alice', displayName: 'alpha' },
            { id: 'bob', displayName: 'Unknown viewer' },
        ]);
    });
});
