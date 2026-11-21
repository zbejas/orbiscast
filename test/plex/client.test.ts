import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlexClient, PlexError } from '../../src/modules/plex/client';
import librariesFixture from '../fixtures/plex/libraries.json';
import movieDetailFixture from '../fixtures/plex/movie-detail.json';
import movieLibraryFixture from '../fixtures/plex/movie-library.json';
import searchFixture from '../fixtures/plex/search.json';
import seasonEpisodesFixture from '../fixtures/plex/season-episodes.json';
import serverInfoFixture from '../fixtures/plex/server-info.json';
import showLeavesFixture from '../fixtures/plex/show-leaves.json';
import showSeasonsFixture from '../fixtures/plex/show-seasons.json';

const BASE_URL = 'http://plex.test:32400';
const TOKEN = 'fixture-token';
const CLIENT_ID = 'orbiscast-test-client';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function createClient(timeoutMs?: number): PlexClient {
    return new PlexClient({
        baseUrl: BASE_URL,
        token: TOKEN,
        clientIdentifier: CLIENT_ID,
        timeoutMs
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function htmlResponse(body: string, status: number): Response {
    return new Response(body, {
        status,
        headers: { 'content-type': 'text/html' }
    });
}

function lastRequest(): { url: URL; init: RequestInit } {
    const calls = fetchMock.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) {
        throw new Error('fetch was not called');
    }
    return {
        url: new URL(String(call[0])),
        init: call[1] as RequestInit
    };
}

function headerValue(init: RequestInit, name: string): string | null {
    return new Headers(init.headers).get(name);
}

async function captureError(promise: Promise<unknown>): Promise<PlexError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(PlexError);
        return error as PlexError;
    }
    throw new Error('Expected a PlexError');
}

describe('PlexClient.validate', () => {
    it('normalizes server information and sends the token as a header', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(serverInfoFixture));
        const client = createClient();

        const info = await client.validate();

        expect(info).toEqual({
            name: 'Fixture Plex',
            version: '1.43.5.11079-b3b13e506',
            machineIdentifier: 'fixture-machine-identifier',
            platform: 'Linux',
            platformVersion: '6.1.0-fixture',
            updatedAt: 1700000000,
            transcoderVideo: true,
            transcoderAudio: true,
            myPlex: true,
            myPlexSigninState: 'ok'
        });

        const { url, init } = lastRequest();
        expect(url.origin).toBe(BASE_URL);
        expect(url.pathname).toBe('/');
        expect(url.searchParams.has('X-Plex-Token')).toBe(false);
        expect(headerValue(init, 'Accept')).toBe('application/json');
        expect(headerValue(init, 'X-Plex-Token')).toBe(TOKEN);
        expect(headerValue(init, 'X-Plex-Client-Identifier')).toBe(CLIENT_ID);
    });
});

describe('PlexClient.getLibraries', () => {
    it('normalizes library sections and boolean fields', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(librariesFixture));
        const client = createClient();

        const libraries = await client.getLibraries();

        expect(libraries).toHaveLength(3);
        expect(libraries[0]).toMatchObject({
            key: '10',
            title: 'Films',
            type: 'movie',
            agent: 'tv.plex.agents.movie',
            scanner: 'Plex Movie',
            language: 'en-US',
            uuid: '11111111-1111-4111-8111-111111111111',
            refreshing: false,
            hidden: false,
            updatedAt: 1700000000,
            createdAt: 1600000000,
            scannedAt: 1700000100
        });
        expect(libraries[1]).toMatchObject({
            key: '20',
            type: 'show',
            refreshing: false,
            hidden: false
        });
        expect(libraries[2]).toMatchObject({
            key: '30',
            type: 'artist',
            hidden: true
        });

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/sections');
    });
});

describe('PlexClient.getLibraryItems', () => {
    it('passes pagination to Plex and normalizes the items', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(movieLibraryFixture));
        const client = createClient();

        const page = await client.getLibraryItems('10', { start: 20, size: 2 });

        expect(page.total).toBe(42);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({
            ratingKey: '1001',
            key: '/library/metadata/1001',
            libraryKey: '10',
            type: 'movie',
            title: 'Aurora Relay',
            titleSort: null,
            showTitle: null,
            seasonNumber: null,
            episodeNumber: null,
            year: 2024,
            durationMs: 6543210,
            summary: 'A synthetic fixture movie about a relay station at the edge of a quiet system.'
        });
        expect(page.items[0]?.thumbUrl).toContain('/photo/:/transcode');
        expect(page.items[0]?.thumbUrl).toContain('url=%2Flibrary%2Fmetadata%2F1001%2Fthumb');
        expect(page.items[0]?.thumbUrl).toContain('X-Plex-Token=fixture-token');
        expect(page.items[1]).toMatchObject({
            ratingKey: '1002',
            title: 'Quiet Machines',
            year: 2022
        });

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/sections/10/all');
        expect(url.searchParams.get('X-Plex-Container-Start')).toBe('20');
        expect(url.searchParams.get('X-Plex-Container-Size')).toBe('2');
    });
});

describe('PlexClient.thumbnailUrl', () => {
    it('builds a photo transcode URL with dimensions and the token', () => {
        const client = createClient();

        const url = new URL(client.thumbnailUrl('1001', 320, 180));

        expect(url.origin).toBe(BASE_URL);
        expect(url.pathname).toBe('/photo/:/transcode');
        expect(url.searchParams.get('url')).toBe('/library/metadata/1001/thumb');
        expect(url.searchParams.get('width')).toBe('320');
        expect(url.searchParams.get('height')).toBe('180');
        expect(url.searchParams.get('X-Plex-Token')).toBe(TOKEN);
    });

    it('omits dimensions when they are not requested', () => {
        const client = createClient();

        const url = new URL(client.thumbnailUrl('1001'));

        expect(url.pathname).toBe('/photo/:/transcode');
        expect(url.searchParams.get('url')).toBe('/library/metadata/1001/thumb');
        expect(url.searchParams.has('width')).toBe(false);
        expect(url.searchParams.has('height')).toBe(false);
        expect(url.searchParams.get('X-Plex-Token')).toBe(TOKEN);
    });
});

describe('PlexClient.getItem', () => {
    it('normalizes movie detail, media parts, and streams', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(movieDetailFixture));
        const client = createClient();

        const item = await client.getItem('1001');

        expect(item).toMatchObject({
            ratingKey: '1001',
            libraryKey: '10',
            librarySectionTitle: 'Films',
            type: 'movie',
            title: 'Aurora Relay',
            studio: 'Fixture Studio',
            contentRating: 'PG-13',
            audienceRating: 7.4,
            rating: 7.1,
            originallyAvailableAt: '2024-03-15',
            durationMs: 6543210
        });
        expect(item.genres).toEqual(['Science Fiction', 'Drama']);
        expect(item.directors).toEqual(['Fixture Director']);
        expect(item.writers).toEqual(['Fixture Writer']);
        expect(item.media).toHaveLength(1);
        expect(item.media[0]).toMatchObject({
            id: 2001,
            durationMs: 6543210,
            bitrate: 6200,
            width: 1920,
            height: 1080,
            aspectRatio: 1.78,
            audioChannels: 6,
            audioCodec: 'eac3',
            videoCodec: 'hevc',
            videoResolution: '1080',
            container: 'mkv',
            videoFrameRate: '24p',
            videoProfile: 'main 10'
        });
        expect(item.media[0]?.parts[0]).toMatchObject({
            id: 3001,
            key: '/library/parts/3001/1700000000/file.mkv',
            file: '/fixtures/movies/Aurora Relay/Aurora Relay.mkv',
            durationMs: 6543210,
            sizeBytes: 5234567890,
            container: 'mkv',
            videoProfile: 'main 10'
        });
        expect(item.streams).toHaveLength(5);
        expect(item.streams.map((stream) => stream.id)).toEqual([4001, 4002, 4003, 4004, 4005]);
        expect(item.streams[0]).toMatchObject({
            id: 4001,
            streamType: 1,
            type: 'video',
            codec: 'hevc',
            default: true,
            selected: true
        });
        expect(item.streams[2]).toMatchObject({
            id: 4003,
            streamType: 3,
            type: 'subtitle',
            codec: 'srt',
            language: 'English',
            default: true,
            forced: false
        });
        expect(item.streams[3]).toMatchObject({
            id: 4004,
            type: 'subtitle',
            codec: 'pgs'
        });
        expect(item.thumbUrl).toContain('X-Plex-Token=fixture-token');

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/metadata/1001');
    });
});

describe('PlexClient.getSeasons', () => {
    it('normalizes seasons with show context', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(showSeasonsFixture));
        const client = createClient();

        const seasons = await client.getSeasons('5001');

        expect(seasons).toHaveLength(2);
        expect(seasons[0]).toMatchObject({
            ratingKey: '5101',
            libraryKey: '20',
            type: 'season',
            title: 'Season 1',
            showRatingKey: '5001',
            showTitle: 'Signal Garden',
            seasonNumber: 1,
            episodeCount: 3,
            viewedEpisodeCount: 1,
            year: 2023
        });
        expect(seasons[1]).toMatchObject({
            ratingKey: '5201',
            type: 'season',
            title: 'Season 2',
            seasonNumber: 2,
            episodeCount: 2,
            viewedEpisodeCount: 0
        });

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/metadata/5001/children');
        expect(url.searchParams.get('X-Plex-Container-Start')).toBe('0');
        expect(url.searchParams.get('X-Plex-Container-Size')).toBe('1000');
    });
});

describe('PlexClient.getEpisodes', () => {
    it('normalizes episodes, media, and subtitle streams', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(seasonEpisodesFixture));
        const client = createClient();

        const episodes = await client.getEpisodes('5101');

        expect(episodes).toHaveLength(3);
        expect(episodes[0]).toMatchObject({
            ratingKey: '5111',
            libraryKey: '20',
            type: 'episode',
            title: 'First Signal',
            showRatingKey: '5001',
            seasonRatingKey: '5101',
            showTitle: 'Signal Garden',
            seasonNumber: 1,
            episodeNumber: 1,
            durationMs: 2400000
        });
        expect(episodes[0]?.streams).toHaveLength(3);
        expect(episodes[0]?.streams[2]).toMatchObject({
            id: 4103,
            type: 'subtitle',
            codec: 'srt',
            language: 'English',
            default: false
        });
        expect(episodes[1]).toMatchObject({
            ratingKey: '5112',
            episodeNumber: 2
        });
        expect(episodes[1]?.media).toEqual([]);

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/metadata/5101/children');
    });
});

describe('PlexClient.getAllLeaves', () => {
    it('normalizes every episode returned by the show endpoint', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(showLeavesFixture));
        const client = createClient();

        const episodes = await client.getAllLeaves('5001');

        expect(episodes.map((episode) => episode.ratingKey)).toEqual(['5111', '5112', '5211']);
        expect(episodes[2]).toMatchObject({
            ratingKey: '5211',
            showTitle: 'Signal Garden',
            seasonNumber: 2,
            episodeNumber: 1
        });

        const { url } = lastRequest();
        expect(url.pathname).toBe('/library/metadata/5001/allLeaves');
        expect(url.searchParams.get('X-Plex-Container-Start')).toBe('0');
        expect(url.searchParams.get('X-Plex-Container-Size')).toBe('500');
    });

    it('follows pagination until the reported total is reached', async () => {
        const metadata = showLeavesFixture.MediaContainer.Metadata;
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse({
                    MediaContainer: {
                        ...showLeavesFixture.MediaContainer,
                        size: 2,
                        totalSize: 3,
                        Metadata: metadata.slice(0, 2)
                    }
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    MediaContainer: {
                        ...showLeavesFixture.MediaContainer,
                        size: 1,
                        totalSize: 3,
                        offset: 2,
                        Metadata: metadata.slice(2, 3)
                    }
                })
            );
        const client = createClient();

        const episodes = await client.getAllLeaves('5001');

        expect(episodes.map((episode) => episode.ratingKey)).toEqual(['5111', '5112', '5211']);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const { url } = lastRequest();
        expect(url.searchParams.get('X-Plex-Container-Start')).toBe('2');
    });
});

describe('PlexClient.search', () => {
    it('filters results to the requested libraries and skips non-video items', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(searchFixture));
        const client = createClient();

        const items = await client.search('signal', ['20']);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            ratingKey: '5001',
            libraryKey: '20',
            type: 'show',
            title: 'Signal Garden',
            leafCount: 5,
            childCount: 2
        });

        const { url } = lastRequest();
        expect(url.pathname).toBe('/search');
        expect(url.searchParams.get('query')).toBe('signal');
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.get('X-Plex-Container-Start')).toBe('0');
        expect(url.searchParams.get('X-Plex-Container-Size')).toBe('50');
        expect(url.searchParams.has('X-Plex-Token')).toBe(false);
    });

    it('returns only video items when no library filter is provided', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(searchFixture));
        const client = createClient();

        const items = await client.search('signal');

        expect(items.map((item) => item.type)).toEqual(['movie', 'show']);
    });

    it('does not call Plex for an empty query or an empty library allowlist', async () => {
        const client = createClient();

        await expect(client.search('   ')).resolves.toEqual([]);
        await expect(client.search('signal', [])).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('PlexClient errors', () => {
    it('maps 401 responses to UNAUTHORIZED and never leaks the token', async () => {
        fetchMock.mockResolvedValueOnce(htmlResponse('Unauthorized', 401));
        const client = createClient();

        const error = await captureError(client.getLibraries());

        expect(error.code).toBe('UNAUTHORIZED');
        expect(error.status).toBe(401);
        expect(error.url).toBe('http://plex.test:32400/library/sections');
        expect(error.message).not.toContain(TOKEN);
        expect(JSON.stringify(error)).not.toContain(TOKEN);
    });

    it('redacts tokens from PlexError URLs and messages', () => {
        const error = new PlexError(
            'Request failed for http://plex.test:32400/x?X-Plex-Token=fixture-token',
            'HTTP_ERROR',
            { url: 'http://plex.test:32400/x?X-Plex-Token=fixture-token' }
        );

        expect(error.url).toBe('http://plex.test:32400/x?X-Plex-Token=redacted');
        expect(error.message).not.toContain(TOKEN);
        expect(error.message).toContain('X-Plex-Token=redacted');
    });

    it('maps 404 responses to NOT_FOUND', async () => {
        fetchMock.mockResolvedValueOnce(htmlResponse('Not Found', 404));
        const client = createClient();

        const error = await captureError(client.getItem('999'));

        expect(error.code).toBe('NOT_FOUND');
        expect(error.status).toBe(404);
        expect(error.url).toBe('http://plex.test:32400/library/metadata/999?includeMarkers=1');
    });

    it('maps missing MediaContainer payloads to MALFORMED_RESPONSE', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ MediaContainer: 'not-an-object' }));
        const client = createClient();

        const error = await captureError(client.getLibraries());

        expect(error.code).toBe('MALFORMED_RESPONSE');
    });

    it('maps invalid JSON to MALFORMED_RESPONSE', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response('{', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );
        const client = createClient();

        const error = await captureError(client.getLibraries());

        expect(error.code).toBe('MALFORMED_RESPONSE');
    });

    it('maps invalid Metadata fields to MALFORMED_RESPONSE', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ MediaContainer: { size: 1, Metadata: 'not-an-array' } })
        );
        const client = createClient();

        const error = await captureError(client.getItem('1001'));

        expect(error.code).toBe('MALFORMED_RESPONSE');
    });

    it('maps an aborted request to TIMEOUT', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                });
            });
        });
        const client = createClient(25);

        const request = client.validate();
        const assertion = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(30);
        await assertion;
    });

    it('rejects invalid client options with INVALID_REQUEST', () => {
        expect(
            () =>
                new PlexClient({
                    baseUrl: 'ftp://plex.test',
                    token: TOKEN,
                    clientIdentifier: CLIENT_ID
                })
        ).toThrowError(PlexError);

        expect(
            () =>
                new PlexClient({
                    baseUrl: BASE_URL,
                    token: '',
                    clientIdentifier: CLIENT_ID
                })
        ).toThrowError(PlexError);
    });
});
