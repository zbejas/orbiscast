import type { MediaSourceKind } from '../../../shared/types';
import {
    JellyfinClient,
    normalizeJellyfinDetail,
    normalizeJellyfinItem,
} from '../../jellyfin/client';
import type { JellyfinRawItem } from '../../jellyfin/types';
import { AuthProxy } from '../auth-proxy';
import { MEDIA_QUALITY_PRESETS } from '../quality';
import type {
    MediaItem,
    MediaItemDetail,
    MediaLibrary,
    MediaProvider,
    MediaServerInfo,
    PreparedPlayback,
    PreparePlaybackInput,
} from '../types';

export interface JellyfinProviderOptions {
    baseUrl: string;
    token: string;
    clientIdentifier: string;
    userId?: string | null;
}

/**
 * Jellyfin adapter for the shared media provider contract.
 *
 * Jellyfin exposes HLS output directly. A loopback proxy adds the token header
 * so FFmpeg never receives the key in its URL or arguments.
 */
export class JellyfinProvider implements MediaProvider {
    readonly kind: MediaSourceKind = 'jellyfin';
    private readonly client: JellyfinClient;
    private proxy: AuthProxy | null = null;

    constructor(private readonly options: JellyfinProviderOptions) {
        this.client = new JellyfinClient({
            baseUrl: options.baseUrl,
            token: options.token,
            clientIdentifier: options.clientIdentifier,
            userId: options.userId ?? null,
        });
    }

    async validate(): Promise<MediaServerInfo> {
        const info = await this.client.validate();
        return {
            name: info.name,
            version: info.version,
            userId: info.userId,
            userName: info.userName,
        };
    }

    async getLibraries(): Promise<MediaLibrary[]> {
        return (await this.client.getLibraries()).map(library => ({
            key: library.id,
            title: library.title,
            type: library.type,
        }));
    }

    async getLibraryItems(
        libraryKey: string,
        start: number,
        size: number
    ): Promise<{ items: MediaItem[]; total: number }> {
        const page = await this.client.getLibraryItems(libraryKey, { start, size });
        return {
            items: page.items.map(item => this.toItem(item, libraryKey)),
            total: page.total,
        };
    }

    async search(query: string, libraryKeys?: readonly string[]): Promise<MediaItem[]> {
        const results = await this.client.search(query, libraryKeys);
        return results.map(result => this.toItem(result.item, result.libraryId));
    }

    async getSeasons(showId: string): Promise<MediaItem[]> {
        return (await this.client.getSeasons(showId)).map(item => this.toItem(item, ''));
    }

    async getEpisodes(seasonId: string): Promise<MediaItem[]> {
        return (await this.client.getEpisodes(seasonId)).map(item => this.toItem(item, ''));
    }

    async getAllEpisodes(showId: string): Promise<MediaItem[]> {
        return (await this.client.getAllEpisodes(showId)).map(item => this.toItem(item, ''));
    }

    async getItem(itemId: string): Promise<MediaItemDetail> {
        return normalizeJellyfinDetail(await this.client.getItem(itemId), '');
    }

    async fetchThumbnail(
        itemId: string,
        width: number,
        height: number
    ): Promise<{ contentType: string; body: Buffer }> {
        return this.client.fetchThumbnail(itemId, width, height);
    }

    async preparePlayback(input: PreparePlaybackInput): Promise<PreparedPlayback> {
        const quality = MEDIA_QUALITY_PRESETS[input.quality];
        const proxyBase = await this.ensureProxy();
        const url = new URL(
            `Videos/${encodeURIComponent(input.item.itemId)}/master.m3u8`,
            proxyBase.endsWith('/') ? proxyBase : `${proxyBase}/`
        );
        const params = url.searchParams;
        params.set('MediaSourceId', input.item.mediaSourceId ?? input.item.itemId);
        params.set('PlaySessionId', input.sessionId);
        params.set('DeviceId', this.options.clientIdentifier);
        params.set('VideoCodec', 'h264');
        params.set('AudioCodec', 'aac');
        params.set('VideoBitrate', String(quality.bitrateKbps * 1000));
        params.set('AudioBitrate', '192000');
        params.set('MaxWidth', String(quality.width));
        params.set('MaxHeight', String(quality.height));
        params.set('TranscodingMaxAudioChannels', '2');
        params.set('SegmentContainer', 'ts');
        params.set('MinSegments', '1');
        params.set('BreakOnNonKeyFrames', 'True');
        if (input.subtitleStreamIndex !== null && input.subtitleStreamIndex !== undefined) {
            params.set('SubtitleStreamIndex', String(input.subtitleStreamIndex));
            params.set('SubtitleMethod', 'Encode');
        }
        if (input.offsetSeconds > 0) {
            params.set('StartTimeTicks', String(Math.round(input.offsetSeconds * 10_000_000)));
        }

        return {
            url: url.toString(),
            stop: async () => {
                const base = this.options.baseUrl.endsWith('/')
                    ? this.options.baseUrl
                    : `${this.options.baseUrl}/`;
                const stopUrl = new URL('Videos/ActiveEncodings', base);
                stopUrl.searchParams.set('deviceId', this.options.clientIdentifier);
                stopUrl.searchParams.set('playSessionId', input.sessionId);
                try {
                    await fetch(stopUrl, {
                        method: 'DELETE',
                        headers: {
                            Authorization: `MediaBrowser Token="${this.options.token}"`,
                            'X-Emby-Token': this.options.token,
                        },
                    });
                } catch {
                    // Active encodings expire on their own if the stop call fails.
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
            this.proxy = new AuthProxy(
                this.options.baseUrl,
                {
                    Authorization: `MediaBrowser Token="${this.options.token}"`,
                    'X-Emby-Token': this.options.token,
                },
                'Jellyfin',
                { stripSegmentParams: ['StartTimeTicks'] }
            );
        }
        return this.proxy.start();
    }

    private toItem(raw: JellyfinRawItem, libraryKey: string): MediaItem {
        const item = normalizeJellyfinItem(raw, libraryKey);
        return {
            itemId: item.itemId,
            libraryKey: item.libraryKey,
            type: item.type,
            title: item.title,
            showTitle: item.showTitle,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            year: item.year,
            durationMs: item.durationMs,
            summary: item.summary,
        };
    }
}
