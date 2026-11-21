import { describe, expect, it } from 'vitest';
import {
    buildStopSessionUrl,
    buildTranscodeDecisionUrl,
    buildTranscodeUrl,
    createSessionId,
    DEFAULT_QUALITY,
    pickSubtitleStream,
    QUALITY_PRESETS,
    redactPlexUrl
} from '../../src/modules/plex/transcode';
import type { PlexStream } from '../../src/modules/plex/types';

function makeStream(overrides: Partial<PlexStream>): PlexStream {
    return {
        id: 0,
        streamType: 0,
        type: 'unknown',
        codec: null,
        language: null,
        languageTag: null,
        languageCode: null,
        displayTitle: null,
        extendedDisplayTitle: null,
        title: null,
        index: null,
        channels: null,
        bitrate: null,
        width: null,
        height: null,
        samplingRate: null,
        bitDepth: null,
        frameRate: null,
        profile: null,
        default: false,
        forced: false,
        selected: false,
        ...overrides
    };
}

function subtitleStream(
    id: number,
    codec: string,
    overrides: Partial<PlexStream> = {}
): PlexStream {
    return makeStream({
        id,
        streamType: 3,
        type: 'subtitle',
        codec,
        index: id,
        ...overrides
    });
}

const baseTranscodeOptions = {
    baseUrl: 'http://plex.test:32400/',
    token: 'fixture-token',
    clientIdentifier: 'client-1',
    ratingKey: '1001',
    mediaIndex: 0,
    partIndex: 0,
    quality: '1080p-8' as const,
    subtitleStreamId: 4003 as number | null,
    offsetSeconds: 42.5,
    sessionId: 'session-1'
};

describe('QUALITY_PRESETS', () => {
    it('contains exactly the four supported presets', () => {
        expect(Object.keys(QUALITY_PRESETS)).toEqual([
            '720p-4',
            '1080p-8',
            '1080p-12',
            '4k-20'
        ]);
    });

    it('defines the expected resolution and bitrate for every preset', () => {
        expect(QUALITY_PRESETS['720p-4']).toEqual({
            width: 1280,
            height: 720,
            bitrateKbps: 4000,
            videoResolution: '1280x720'
        });
        expect(QUALITY_PRESETS['1080p-8']).toEqual({
            width: 1920,
            height: 1080,
            bitrateKbps: 8000,
            videoResolution: '1920x1080'
        });
        expect(QUALITY_PRESETS['1080p-12']).toEqual({
            width: 1920,
            height: 1080,
            bitrateKbps: 12000,
            videoResolution: '1920x1080'
        });
        expect(QUALITY_PRESETS['4k-20']).toEqual({
            width: 3840,
            height: 2160,
            bitrateKbps: 20000,
            videoResolution: '3840x2160'
        });
    });

    it('defaults to 1080p-8', () => {
        expect(DEFAULT_QUALITY).toBe('1080p-8');
    });
});

describe('pickSubtitleStream', () => {
    it('prefers the default subtitle even when it is image based', () => {
        const selection = pickSubtitleStream([
            subtitleStream(1, 'pgs', { default: true }),
            subtitleStream(2, 'srt', { forced: true }),
            subtitleStream(3, 'srt', { default: true })
        ]);

        expect(selection).toMatchObject({ streamId: 1, reason: 'default' });
        expect(selection?.stream.id).toBe(1);
    });

    it('falls back to a forced subtitle when the default track cannot be burned', () => {
        const selection = pickSubtitleStream([
            subtitleStream(10, 'pgs', { index: null, default: true }),
            subtitleStream(11, 'srt', { forced: true }),
            subtitleStream(12, 'ass')
        ]);

        expect(selection).toMatchObject({ streamId: 11, reason: 'forced' });
    });

    it('falls back to the first burnable subtitle', () => {
        const selection = pickSubtitleStream([
            subtitleStream(20, 'pgs', { index: null }),
            subtitleStream(21, 'srt'),
            subtitleStream(22, 'ass')
        ]);

        expect(selection).toMatchObject({ streamId: 21, reason: 'first' });
    });

    it('returns null when there are no subtitle streams', () => {
        expect(
            pickSubtitleStream([
                makeStream({ id: 30, streamType: 1, type: 'video', codec: 'h264' }),
                makeStream({ id: 31, streamType: 2, type: 'audio', codec: 'aac' })
            ])
        ).toBeNull();
        expect(pickSubtitleStream([])).toBeNull();
    });

    it('ignores subtitle streams without a burn index', () => {
        expect(
            pickSubtitleStream([
                subtitleStream(40, 'pgs', { index: null, default: true }),
                subtitleStream(41, 'vobsub', { index: null, forced: true }),
                subtitleStream(42, 'dvd_subtitle', { index: null })
            ])
        ).toBeNull();
    });

    it('ignores subtitles without an index even when the codec is text', () => {
        expect(pickSubtitleStream([subtitleStream(50, 'srt', { index: null })])).toBeNull();
    });
});

describe('buildTranscodeUrl', () => {
    it('sets every required stream parameter and the token query parameter', () => {
        const url = new URL(buildTranscodeUrl(baseTranscodeOptions));

        expect(url.origin).toBe('http://plex.test:32400');
        expect(url.pathname).toBe('/video/:/transcode/universal/start.mkv');

        const params = url.searchParams;
        expect(params.get('hasMDE')).toBe('1');
        expect(params.get('path')).toBe('/library/metadata/1001');
        expect(params.get('mediaIndex')).toBe('0');
        expect(params.get('partIndex')).toBe('0');
        expect(params.get('protocol')).toBe('http');
        expect(params.get('fastSeek')).toBe('1');
        expect(params.get('location')).toBe('lan');
        expect(params.get('directPlay')).toBe('0');
        expect(params.get('directStream')).toBe('1');
        expect(params.get('directStreamVideo')).toBe('1');
        expect(params.get('X-Plex-Client-Profile-Name')).toBe('Chrome');
        expect(params.get('X-Plex-Client-Profile-Extra')).toContain('container=mkv');
        expect(params.get('subtitles')).toBe('burn');
        expect(params.get('subtitleStreamID')).toBe('4003');
        expect(params.get('subtitleSize')).toBe('100');
        expect(params.get('videoResolution')).toBe('1920x1080');
        expect(params.get('videoBitrate')).toBe('8000');
        expect(params.get('maxVideoBitrate')).toBe('8000');
        expect(params.get('offset')).toBe('42.5');
        expect(params.get('session')).toBe('session-1');
        expect(params.get('X-Plex-Client-Identifier')).toBe('client-1');
        expect(params.get('X-Plex-Token')).toBe('fixture-token');
    });

    it('disables subtitles when no subtitle stream is selected', () => {
        const url = new URL(
            buildTranscodeUrl({
                ...baseTranscodeOptions,
                quality: '4k-20',
                subtitleStreamId: null,
                offsetSeconds: 0
            })
        );

        expect(url.searchParams.get('subtitles')).toBe('none');
        expect(url.searchParams.get('subtitleStreamID')).toBe('0');
        expect(url.searchParams.has('subtitleSize')).toBe(false);
        expect(url.searchParams.get('videoResolution')).toBe('3840x2160');
        expect(url.searchParams.get('videoBitrate')).toBe('20000');
        expect(url.searchParams.get('maxVideoBitrate')).toBe('20000');
        expect(url.searchParams.get('offset')).toBe('0');
    });

    it('uses the requested quality preset for every resolution', () => {
        const expectations = [
            ['720p-4', '1280x720', '4000'],
            ['1080p-8', '1920x1080', '8000'],
            ['1080p-12', '1920x1080', '12000'],
            ['4k-20', '3840x2160', '20000']
        ] as const;

        for (const [quality, resolution, bitrate] of expectations) {
            const url = new URL(
                buildTranscodeUrl({
                    ...baseTranscodeOptions,
                    quality,
                    subtitleStreamId: null
                })
            );
            expect(url.searchParams.get('videoResolution')).toBe(resolution);
            expect(url.searchParams.get('videoBitrate')).toBe(bitrate);
            expect(url.searchParams.get('maxVideoBitrate')).toBe(bitrate);
        }
    });

    it('supports resuming at a fractional offset', () => {
        const url = new URL(
            buildTranscodeUrl({
                ...baseTranscodeOptions,
                offsetSeconds: 125.75
            })
        );

        expect(url.searchParams.get('offset')).toBe('125.75');
    });

    it('rejects negative offsets', () => {
        expect(() =>
            buildTranscodeUrl({
                ...baseTranscodeOptions,
                offsetSeconds: -1
            })
        ).toThrow(/offsetSeconds/);
    });
});

describe('buildTranscodeDecisionUrl', () => {
    it('keeps the start query and swaps the path to decision', () => {
        const start = buildTranscodeUrl(baseTranscodeOptions);
        const decision = new URL(buildTranscodeDecisionUrl(start));

        expect(decision.pathname).toBe('/video/:/transcode/universal/decision');
        expect(decision.searchParams.get('session')).toBe('session-1');
        expect(decision.searchParams.get('subtitleStreamID')).toBe('4003');
        expect(decision.searchParams.get('subtitles')).toBe('burn');
    });
});

describe('buildStopSessionUrl', () => {
    it('builds the stop URL with the session and token', () => {
        const url = new URL(
            buildStopSessionUrl({
                baseUrl: 'http://plex.test:32400/',
                token: 'fixture-token',
                sessionId: 'session-1'
            })
        );

        expect(url.pathname).toBe('/video/:/transcode/universal/stop');
        expect(url.searchParams.get('session')).toBe('session-1');
        expect(url.searchParams.get('X-Plex-Token')).toBe('fixture-token');
    });
});

describe('redactPlexUrl', () => {
    it('masks the token while keeping other query parameters', () => {
        const redacted = redactPlexUrl(
            'http://plex.test:32400/library/metadata/1001/thumb?width=320&X-Plex-Token=fixture-token&height=180'
        );
        const url = new URL(redacted);

        expect(redacted).not.toContain('fixture-token');
        expect(url.searchParams.get('X-Plex-Token')).toBe('redacted');
        expect(url.searchParams.get('width')).toBe('320');
        expect(url.searchParams.get('height')).toBe('180');
    });

    it('masks lowercase token parameter names', () => {
        expect(redactPlexUrl('http://plex.test/x?x-plex-token=fixture-token')).toBe(
            'http://plex.test/x?x-plex-token=redacted'
        );
    });

    it('masks tokens in relative URLs', () => {
        expect(
            redactPlexUrl('/library/metadata/1001?X-Plex-Token=fixture-token&width=200')
        ).toBe('/library/metadata/1001?X-Plex-Token=redacted&width=200');
    });

    it('leaves URLs without a token unchanged', () => {
        const plain = 'http://plex.test:32400/library/sections';
        expect(redactPlexUrl(plain)).toBe(plain);
    });
});

describe('createSessionId', () => {
    it('creates unique URL-safe identifiers', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 100; index += 1) {
            const id = createSessionId();
            expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(id).toMatch(/^orbiscast-[0-9a-f-]{36}$/);
            ids.add(id);
        }
        expect(ids.size).toBe(100);
    });
});
