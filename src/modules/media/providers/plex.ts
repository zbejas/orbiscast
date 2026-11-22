import {
    PlexClient,
    type PlexEpisode,
    type PlexItem,
    type PlexItemDetail,
    type PlexSeason,
    type PlexStream,
} from '../../plex';
import { buildStopSessionUrl, buildTranscodeDecisionUrl, buildTranscodeUrl } from '../../plex/transcode';
import type { MediaSourceKind } from '../../../shared/types';
import { AuthProxy } from '../auth-proxy';
import type {
    MediaItem,
    MediaItemDetail,
    MediaLibrary,
    MediaProvider,
    MediaServerInfo,
    MediaStream,
    PreparedPlayback,
    PreparePlaybackInput,
} from '../types';

const PRODUCT_VERSION = '1.3.0';

export interface PlexProviderOptions {
    baseUrl: string;
    token: string;
    clientIdentifier: string;
}

/**
 * Plex adapter for the shared media provider contract.
 *
 * The Plex client, transcode URL builder, and loopback header proxy all stay
 * provider-specific. Everything above this class works with normalized items.
 */
export class PlexProvider implements MediaProvider {
    readonly kind: MediaSourceKind = 'plex';
    private readonly client: PlexClient;
    private proxy: AuthProxy | null = null;

    constructor(private readonly options: PlexProviderOptions) {
        this.client = new PlexClient({
            baseUrl: options.baseUrl,
            token: options.token,
            clientIdentifier: options.clientIdentifier,
        });
    }

    async validate(): Promise<MediaServerInfo> {
        const info = await this.client.validate();
        return {
            name: info.name,
            version: info.version,
            userId: null,
            userName: null,
        };
    }

    async getLibraries(): Promise<MediaLibrary[]> {
        return (await this.client.getLibraries()).map(library => ({
            key: library.key,
            title: library.title,
            type: normalizeLibraryType(library.type),
        }));
    }

    async getLibraryItems(
        libraryKey: string,
        start: number,
        size: number
    ): Promise<{ items: MediaItem[]; total: number }> {
        const page = await this.client.getLibraryItems(libraryKey, { start, size });
        return { items: page.items.map(item => this.toItem(item, libraryKey)), total: page.total };
    }

    async search(query: string, libraryKeys?: readonly string[]): Promise<MediaItem[]> {
        const items = await this.client.search(query, libraryKeys);
        return items.map(item => this.toItem(item, item.libraryKey));
    }

    async getSeasons(showId: string): Promise<MediaItem[]> {
        return (await this.client.getSeasons(showId)).map(season => this.toSeason(season));
    }

    async getEpisodes(seasonId: string): Promise<MediaItem[]> {
        return (await this.client.getEpisodes(seasonId)).map(episode => this.toEpisode(episode));
    }

    async getAllEpisodes(showId: string): Promise<MediaItem[]> {
        return (await this.client.getAllLeaves(showId)).map(episode => this.toEpisode(episode));
    }

    async getItem(itemId: string): Promise<MediaItemDetail> {
        const detail = await this.client.getItem(itemId);
        return this.toDetail(detail);
    }

    async fetchThumbnail(
        itemId: string,
        width: number,
        height: number
    ): Promise<{ contentType: string; body: Buffer }> {
        const response = await fetch(this.client.thumbnailUrl(itemId, width, height));
        if (!response.ok) {
            throw new Error(`Plex thumbnail request failed with status ${response.status}`);
        }
        return {
            contentType: response.headers.get('content-type') ?? 'image/jpeg',
            body: Buffer.from(await response.arrayBuffer()),
        };
    }

    async preparePlayback(input: PreparePlaybackInput): Promise<PreparedPlayback> {
        const proxyBase = await this.ensureProxy();
        const subtitleStreamId = plexSubtitleStreamId(
            input.item.streams,
            input.subtitleStreamIndex
        );
        await this.selectStreams(input.item.partId, subtitleStreamId);
        const url = buildTranscodeUrl({
            baseUrl: proxyBase,
            token: null,
            clientIdentifier: this.options.clientIdentifier,
            ratingKey: input.item.itemId,
            mediaIndex: 0,
            partIndex: 0,
            quality: input.quality,
            subtitleStreamId,
            offsetSeconds: input.offsetSeconds,
            sessionId: input.sessionId,
        });
        await this.makeTranscodeDecision(url);
        return {
            url,
            stop: async () => {
                try {
                    await fetch(
                        buildStopSessionUrl({
                            baseUrl: this.options.baseUrl,
                            token: this.options.token,
                            sessionId: input.sessionId,
                        })
                    );
                } catch {
                    // Session cleanup is best effort. Plex expires abandoned sessions.
                }
            },
        };
    }

    async shutdown(): Promise<void> {
        await this.proxy?.stop();
        this.proxy = null;
    }

    private async ensureProxy(): Promise<string> {
        if (!this.proxy) {
            this.proxy = new AuthProxy(this.options.baseUrl, this.plexHeaders(), 'Plex');
        }
        return this.proxy.start();
    }

    /**
     * Persists the subtitle choice for the media part.
     *
     * Plex burns the stream selected on the part. The transcode URL alone is
     * not enough: the server ignores `subtitleStreamID` for a part whose saved
     * selection points at a different track.
     *
     * @param partId - Plex part id, when the item exposes one
     * @param subtitleStreamId - Global stream id, or null to disable subtitles
     */
    private async selectStreams(
        partId: string | null,
        subtitleStreamId: number | null
    ): Promise<void> {
        if (!partId) return;
        const url = new URL(`/library/parts/${encodeURIComponent(partId)}`, this.options.baseUrl);
        url.searchParams.set('subtitleStreamID', String(subtitleStreamId ?? 0));
        const response = await fetch(url, {
            method: 'PUT',
            headers: this.plexHeaders(),
        });
        if (!response.ok) {
            throw new Error(`Plex stream selection failed with status ${response.status}`);
        }
    }

    /**
     * Asks Plex to decide how to transcode before starting the stream.
     *
     * The decision locks in the burned subtitle track for the session. Skipping
     * it makes Plex fall back to the account preference or a previous track.
     *
     * @param startUrl - Transcode start URL with the selected streams
     */
    private async makeTranscodeDecision(startUrl: string): Promise<void> {
        const response = await fetch(buildTranscodeDecisionUrl(startUrl), {
            headers: this.plexHeaders(),
        });
        const body = await response.text();
        if (!response.ok) {
            throw new Error(
                `Plex transcode decision failed with status ${response.status}: ${body.slice(0, 160)}`
            );
        }
    }

    private plexHeaders(): Record<string, string> {
        return {
            'X-Plex-Client-Identifier': this.options.clientIdentifier,
            'X-Plex-Product': 'OrbisCast',
            'X-Plex-Version': PRODUCT_VERSION,
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Platform-Version': '140.0',
            'X-Plex-Device': 'Web',
            'X-Plex-Device-Name': 'OrbisCast',
            'X-Plex-Model': 'standalone',
            'X-Plex-Language': 'en',
            'X-Plex-Token': this.options.token,
        };
    }

    private toItem(item: PlexItem, libraryKey: string): MediaItem {
        return {
            itemId: item.ratingKey,
            libraryKey,
            type: normalizeItemType(item.type),
            title: item.title,
            showTitle: item.showTitle,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            year: item.year,
            durationMs: item.durationMs,
            summary: item.summary,
        };
    }

    private toSeason(season: PlexSeason): MediaItem {
        return this.toItem(season, season.libraryKey);
    }

    private toEpisode(episode: PlexEpisode): MediaItem {
        return this.toItem(episode, episode.libraryKey);
    }

    private toDetail(detail: PlexItemDetail): MediaItemDetail {
        const intro = detail.markers.find(
            marker => marker.type === 'intro' && marker.startMs !== null && marker.endMs !== null
        );
        return {
            ...this.toItem(detail, detail.libraryKey),
            mediaSourceId: detail.media[0] ? String(detail.media[0].id) : null,
            partId: detail.media[0]?.parts[0] ? String(detail.media[0].parts[0].id) : null,
            showItemId: detail.showRatingKey,
            seasonItemId: detail.seasonRatingKey,
            intro:
                intro && intro.startMs !== null && intro.endMs !== null
                    ? { startMs: intro.startMs, endMs: intro.endMs }
                    : null,
            streams: detail.streams.map(stream => this.toStream(stream)),
        };
    }

    private toStream(stream: PlexStream): MediaStream {
        return {
            id: stream.id,
            index: stream.index,
            type: stream.type === 'audio' || stream.type === 'subtitle' ? stream.type : 'video',
            codec: stream.codec,
            language: stream.language,
            displayTitle: stream.displayTitle ?? stream.title,
            default: stream.default,
            forced: stream.forced,
            burnable: stream.type === 'subtitle' && isBurnablePlexSubtitle(stream),
        };
    }
}

function normalizeItemType(type: PlexItem['type']): MediaItem['type'] {
    if (type === 'movie' || type === 'show' || type === 'season' || type === 'episode') {
        return type;
    }
    throw new Error('Unsupported Plex item type');
}

function normalizeLibraryType(type: string): MediaLibrary['type'] {
    if (type === 'movie' || type === 'show' || type === 'artist' || type === 'photo') {
        return type;
    }
    return 'unknown';
}

function isBurnablePlexSubtitle(stream: PlexStream): boolean {
    return stream.type === 'subtitle' && typeof stream.index === 'number' && Number.isInteger(stream.index) && stream.index >= 0;
}

/**
 * Maps a resolved per-part subtitle index to the global Plex stream id.
 *
 * @param streams - Normalized streams for the item
 * @param index - Per-part stream index, or null
 */
export function plexSubtitleStreamId(
    streams: readonly MediaStream[],
    index: number | null
): number | null {
    if (index === null) {
        return null;
    }
    return streams.find(stream => stream.type === 'subtitle' && stream.index === index)?.id ?? index;
}
