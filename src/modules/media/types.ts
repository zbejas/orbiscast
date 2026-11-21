import type {
    MediaItemType,
    MediaLibraryType,
    MediaQuality,
    MediaSourceKind,
} from '../../shared/types';

/** A library on a media server. */
export interface MediaLibrary {
    key: string;
    title: string;
    type: MediaLibraryType;
}

/** A normalized movie, show, season, or episode. */
export interface MediaItem {
    itemId: string;
    libraryKey: string;
    type: MediaItemType;
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    durationMs: number | null;
    summary: string | null;
}

/** A playable subtitle or audio stream. */
export interface MediaStream {
    id: number;
    index: number | null;
    type: 'audio' | 'subtitle' | 'video';
    codec: string | null;
    language: string | null;
    displayTitle: string | null;
    default: boolean;
    forced: boolean;
    burnable: boolean;
}

/** Intro marker offsets reported by the media server. */
export interface MediaIntroMarker {
    startMs: number;
    endMs: number;
}

/** Full item metadata used by detail views and playback. */
export interface MediaItemDetail extends MediaItem {
    /** Provider media source id for playback. */
    mediaSourceId: string | null;
    /** Provider media part id used for stream selection, when the provider exposes one. */
    partId: string | null;
    /** Show that owns this episode, used for navigation and next-up. */
    showItemId: string | null;
    /** Season that owns this episode, used for next-up. */
    seasonItemId: string | null;
    /** Intro marker when the provider exposes one. */
    intro: MediaIntroMarker | null;
    streams: MediaStream[];
}

/** Connection information returned by a provider validation call. */
export interface MediaServerInfo {
    name: string;
    version: string;
    userId: string | null;
    userName: string | null;
}

/** Input for provider playback preparation. */
export interface PreparePlaybackInput {
    item: MediaItemDetail;
    quality: MediaQuality;
    subtitleStreamIndex: number | null;
    offsetSeconds: number;
    sessionId: string;
}

/** A stream URL and the cleanup for its server-side session. */
export interface PreparedPlayback {
    url: string;
    stop: () => Promise<void>;
}

/**
 * The provider contract shared by Plex and Jellyfin.
 *
 * Implementations own their HTTP client, optional loopback proxy, and any
 * provider-specific transcode URL construction. The media service owns the
 * queue, playback state, voice connection, and placeholder.
 */
export interface MediaProvider {
    readonly kind: MediaSourceKind;

    validate(): Promise<MediaServerInfo>;
    getLibraries(): Promise<MediaLibrary[]>;
    getLibraryItems(
        libraryKey: string,
        start: number,
        size: number
    ): Promise<{ items: MediaItem[]; total: number }>;
    search(query: string, libraryKeys?: readonly string[]): Promise<MediaItem[]>;
    getSeasons(showId: string): Promise<MediaItem[]>;
    getEpisodes(seasonId: string): Promise<MediaItem[]>;
    getAllEpisodes(showId: string): Promise<MediaItem[]>;
    getItem(itemId: string): Promise<MediaItemDetail>;
    fetchThumbnail(
        itemId: string,
        width: number,
        height: number
    ): Promise<{ contentType: string; body: Buffer }>;
    preparePlayback(input: PreparePlaybackInput): Promise<PreparedPlayback>;
    shutdown(): Promise<void>;
}

/** Normalizes provider-specific duration units into milliseconds. */
export function ticksToMs(ticks: number | null | undefined): number | null {
    if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks <= 0) {
        return null;
    }
    return Math.round(ticks / 10_000);
}

/** Returns a positive integer or null. */
export function toPositiveInt(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/** Returns a finite number or null. */
export function toFiniteNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}
