import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
    JellyfinClient,
    JellyfinError,
    normalizeJellyfinDetail,
    normalizeJellyfinItem,
    normalizeJellyfinStream,
} from '../../src/modules/jellyfin/client';
import { JellyfinProvider } from '../../src/modules/media/providers/jellyfin';
import { AuthProxy } from '../../src/modules/media/auth-proxy';
import type { MediaItemDetail } from '../../src/modules/media/types';

const TOKEN = 'fixture-token';
const BASE = 'https://jellyfin.test';
const USER = 'user-1';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function detail(): MediaItemDetail {
    return {
        itemId: 'movie-1',
        libraryKey: 'movies',
        type: 'movie',
        title: 'Fixture Movie',
        showTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        year: 2024,
        durationMs: 7_200_000,
        summary: null,
        mediaSourceId: 'source-1',
        partId: null,
        showItemId: null,
        seasonItemId: null,
        intro: null,
        streams: [
            {
                id: 1,
                index: 1,
                type: 'audio',
                codec: 'aac',
                language: 'eng',
                displayTitle: 'AAC 5.1',
                default: true,
                forced: false,
                burnable: false,
            },
            {
                id: 2,
                index: 2,
                type: 'subtitle',
                codec: 'subrip',
                language: 'eng',
                displayTitle: 'English',
                default: true,
                forced: false,
                burnable: true,
            },
        ],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Jellyfin client', () => {
    it('validates the server and chooses an administrator', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
            const url = String(input);
            calls.push(url);
            if (url.includes('/System/Info')) {
                return jsonResponse({ ServerName: 'Home', Version: '12.3.0', Id: 'server-1' });
            }
            if (url.includes('/Users')) {
                return jsonResponse([
                    { Id: 'guest', Name: 'Guest', Policy: { IsAdministrator: false } },
                    { Id: USER, Name: 'Owner', Policy: { IsAdministrator: true } },
                ]);
            }
            return jsonResponse({}, 404);
        }));

        const client = new JellyfinClient({
            baseUrl: BASE,
            token: TOKEN,
            clientIdentifier: 'device-1',
        });
        const info = await client.validate();

        expect(info).toEqual({
            name: 'Home',
            version: '12.3.0',
            serverId: 'server-1',
            userId: USER,
            userName: 'Owner',
        });
        expect(calls.some(url => url.includes('/System/Info'))).toBe(true);
        const header = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
        expect(header.Authorization).toBe(`MediaBrowser Token="${TOKEN}"`);
    });

    it('maps libraries and normalizes items and streams', () => {
        expect(normalizeJellyfinItem({
            Id: 'episode-1',
            Name: 'Pilot',
            Type: 'Episode',
            SeriesName: 'Show',
            ParentIndexNumber: 2,
            IndexNumber: 3,
            ProductionYear: 2024,
            RunTimeTicks: 18_000_000_000,
        }, 'shows')).toEqual({
            itemId: 'episode-1',
            libraryKey: 'shows',
            type: 'episode',
            title: 'Pilot',
            showTitle: 'Show',
            seasonNumber: 2,
            episodeNumber: 3,
            year: 2024,
            durationMs: 1_800_000,
            summary: null,
        });

        expect(normalizeJellyfinStream({ Index: 2, Type: 'Subtitle', Codec: 'subrip', IsDefault: true })).toMatchObject({
            id: 2,
            index: 2,
            type: 'subtitle',
            burnable: true,
        });
        expect(normalizeJellyfinStream({ Index: 3, Type: 'Video', Codec: 'hevc' }).burnable).toBe(false);

        const full = normalizeJellyfinDetail(
            {
                Id: 'movie-1',
                Name: 'Fixture Movie',
                Type: 'Movie',
                RunTimeTicks: 72_000_000_000,
                MediaSources: [
                    {
                        Id: 'source-1',
                        RunTimeTicks: 72_000_000_000,
                        MediaStreams: [
                            { Index: 1, Type: 'Audio', Codec: 'aac' },
                            { Index: 2, Type: 'Subtitle', Codec: 'subrip' },
                        ],
                    },
                ],
            },
            'movies'
        );
        expect(full.mediaSourceId).toBe('source-1');
        expect(full.durationMs).toBe(7_200_000);
        expect(full.streams).toHaveLength(2);
    });

    it('reports unauthorized responses with a redacted typed error', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
        const client = new JellyfinClient({
            baseUrl: BASE,
            token: TOKEN,
            clientIdentifier: 'device-1',
        });
        await expect(client.validate()).rejects.toMatchObject({
            name: 'JellyfinError',
            code: 'UNAUTHORIZED',
        } satisfies Partial<JellyfinError>);
    });
});

describe('Jellyfin provider', () => {
    it('builds a proxied HLS URL without the token and strips seek ticks from segments', async () => {
        const provider = new JellyfinProvider({
            baseUrl: BASE,
            token: TOKEN,
            clientIdentifier: 'device-1',
        });
        const prepared = await provider.preparePlayback({
            item: detail(),
            quality: '1080p-8',
            subtitleStreamIndex: 2,
            offsetSeconds: 60,
            sessionId: randomUUID(),
        });

        const url = new URL(prepared.url);
        expect(url.hostname).toBe('127.0.0.1');
        expect(prepared.url).not.toContain(TOKEN);
        expect(url.pathname).toContain('/Videos/movie-1/master.m3u8');
        expect(url.searchParams.get('StartTimeTicks')).toBe('600000000');
        expect(url.searchParams.get('SubtitleStreamIndex')).toBe('2');
        expect(url.searchParams.get('SubtitleMethod')).toBe('Encode');
        expect(url.searchParams.get('MediaSourceId')).toBe('source-1');

        const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('', { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        await prepared.stop();
        const stopUrl = String(fetchMock.mock.calls[0]?.[0]);
        expect(stopUrl).toContain('/Videos/ActiveEncodings');
        expect(stopUrl).toContain('playSessionId=');
        expect(stopUrl).not.toContain(TOKEN);
        await provider.shutdown();
    });
});

describe('AuthProxy', () => {
    let upstream: Server | null = null;

    afterEach(async () => {
        if (upstream) {
            await new Promise<void>(resolve => upstream!.close(() => resolve()));
            upstream = null;
        }
    });

    it('keeps StartTimeTicks on manifests and removes it from segments', async () => {
        const requests: string[] = [];
        upstream = createServer((req, res) => {
            requests.push(req.url ?? '');
            if ((req.url ?? '').includes('.m3u8')) {
                res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
                res.end('#EXTM3U\n');
                return;
            }
            res.writeHead(200, { 'content-type': 'video/mp2t' });
            res.end(Buffer.from([0x47]));
        });
        await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', () => resolve()));
        const address = upstream.address();
        if (!address || typeof address === 'string') throw new Error('no upstream port');
        const upstreamUrl = `http://127.0.0.1:${address.port}`;

        const proxy = new AuthProxy(upstreamUrl, { Authorization: 'test' }, 'Test', {
            stripSegmentParams: ['StartTimeTicks'],
        });
        const proxyBase = await proxy.start();

        await fetch(`${proxyBase}/Videos/movie/master.m3u8?StartTimeTicks=600000000`);
        await fetch(`${proxyBase}/Videos/movie/0.ts?StartTimeTicks=600000000`);

        expect(requests[0]).toContain('StartTimeTicks=600000000');
        expect(requests[1]).not.toContain('StartTimeTicks');
        await proxy.stop();
    });

    it('preserves a reverse-proxy base path', async () => {
        const requests: string[] = [];
        upstream = createServer((req, res) => {
            requests.push(req.url ?? '');
            res.writeHead(200, { 'content-type': 'video/mp2t' });
            res.end(Buffer.from([0x47]));
        });
        await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', () => resolve()));
        const address = upstream.address();
        if (!address || typeof address === 'string') throw new Error('no upstream port');
        const upstreamUrl = `http://127.0.0.1:${address.port}/jellyfin`;

        const proxy = new AuthProxy(upstreamUrl, { Authorization: 'test' }, 'Test');
        const proxyBase = await proxy.start();
        await fetch(`${proxyBase}/Videos/movie/0.ts`);

        expect(requests[0]).toBe('/jellyfin/Videos/movie/0.ts');
        await proxy.stop();
    });
});
