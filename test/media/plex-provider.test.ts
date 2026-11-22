import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { PlexProvider } from '../../src/modules/media/providers/plex';
import type { MediaItemDetail } from '../../src/modules/media/types';

function detail(): MediaItemDetail {
    return {
        itemId: '11235',
        libraryKey: '2',
        type: 'episode',
        title: 'Fixture Episode',
        showTitle: 'Fixture Show',
        seasonNumber: 1,
        episodeNumber: 3,
        year: 2024,
        durationMs: 2_655_392,
        summary: null,
        mediaSourceId: '274479',
        partId: '363332',
        showItemId: '11230',
        seasonItemId: '11231',
        intro: null,
        streams: [
            {
                id: 1730614,
                index: 2,
                type: 'subtitle',
                codec: 'ass',
                language: 'English',
                displayTitle: 'English',
                default: false,
                forced: false,
                burnable: true
            },
            {
                id: 1730625,
                index: 13,
                type: 'subtitle',
                codec: 'ass',
                language: 'Deutsch',
                displayTitle: 'Deutsch',
                default: false,
                forced: false,
                burnable: true
            }
        ]
    };
}

const servers: ReturnType<typeof createServer>[] = [];
const providers: PlexProvider[] = [];

afterEach(async () => {
    await Promise.all(providers.splice(0).map(provider => provider.shutdown()));
    await Promise.all(
        servers.splice(0).map(
            server => new Promise<void>(resolve => server.close(() => resolve()))
        )
    );
});

describe('PlexProvider subtitle selection', () => {
    it('persists the global stream id before building the transcode URL', async () => {
        const requests: string[] = [];
        const server = createServer((req, res) => {
            requests.push(req.url ?? '');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        servers.push(server);
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test address');

        const provider = new PlexProvider({
            baseUrl: `http://127.0.0.1:${address.port}`,
            token: 'fixture-token',
            clientIdentifier: 'fixture-client'
        });
        providers.push(provider);

        const prepared = await provider.preparePlayback({
            item: detail(),
            quality: '1080p-8',
            subtitleStreamIndex: 13,
            offsetSeconds: 10,
            sessionId: 'session-1'
        });

        expect(requests).toHaveLength(2);
        const selection = new URL(requests[0] ?? "", `http://127.0.0.1:${address.port}`);
        expect(selection.pathname).toBe('/library/parts/363332');
        expect(selection.searchParams.get('subtitleStreamID')).toBe('1730625');

        const decision = new URL(requests[1] ?? "", `http://127.0.0.1:${address.port}`);
        expect(decision.pathname).toBe('/video/:/transcode/universal/decision');
        expect(decision.searchParams.get('subtitleStreamID')).toBe('1730625');
        expect(decision.searchParams.get('session')).toBe('session-1');
        expect(decision.searchParams.get('subtitles')).toBe('burn');

        const url = new URL(prepared.url);
        expect(url.pathname).toBe('/video/:/transcode/universal/start.mkv');
        expect(url.searchParams.get('subtitles')).toBe('burn');
        expect(url.searchParams.get('subtitleStreamID')).toBe('1730625');
        expect(url.searchParams.get('subtitleSize')).toBe('100');
    });

    it('persists off and requests no subtitles', async () => {
        const requests: string[] = [];
        const server = createServer((req, res) => {
            requests.push(req.url ?? '');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        servers.push(server);
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test address');

        const provider = new PlexProvider({
            baseUrl: `http://127.0.0.1:${address.port}`,
            token: 'fixture-token',
            clientIdentifier: 'fixture-client'
        });
        providers.push(provider);

        const prepared = await provider.preparePlayback({
            item: detail(),
            quality: '1080p-8',
            subtitleStreamIndex: null,
            offsetSeconds: 0,
            sessionId: 'session-2'
        });

        expect(requests).toHaveLength(2);
        const selection = new URL(requests[0] ?? "", `http://127.0.0.1:${address.port}`);
        expect(selection.searchParams.get('subtitleStreamID')).toBe('0');

        const decision = new URL(requests[1] ?? "", `http://127.0.0.1:${address.port}`);
        expect(decision.pathname).toBe('/video/:/transcode/universal/decision');
        expect(decision.searchParams.get('subtitleStreamID')).toBe('0');
        expect(decision.searchParams.get('subtitles')).toBe('none');

        const url = new URL(prepared.url);
        expect(url.pathname).toBe('/video/:/transcode/universal/start.mkv');
        expect(url.searchParams.get('subtitles')).toBe('none');
        expect(url.searchParams.get('subtitleStreamID')).toBe('0');
        expect(url.searchParams.has('subtitleSize')).toBe(false);
    });
});
