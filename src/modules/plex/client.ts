import { redactPlexUrl } from './transcode';
import type {
    PlexEpisode,
    PlexItem,
    PlexItemDetail,
    PlexItemType,
    PlexLibrary,
    PlexLibraryType,
    PlexMedia,
    PlexMediaPart,
    PlexRawItem,
    PlexRawLibrary,
    PlexRawMedia,
    PlexRawMediaContainer,
    PlexRawPart,
    PlexRawServerInfo,
    PlexRawStream,
    PlexRawTag,
    PlexSeason,
    PlexServerInfo,
    PlexStream,
    PlexStreamType
} from './types';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_SEARCH_LIMIT = 50;
const ALL_LEAVES_PAGE_SIZE = 500;

/** Error codes emitted by the Plex client. */
export type PlexErrorCode =
    | 'UNAUTHORIZED'
    | 'NOT_FOUND'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR'
    | 'MALFORMED_RESPONSE'
    | 'INVALID_REQUEST';

/** Extra context attached to a PlexError. */
export interface PlexErrorOptions {
    status?: number | null;
    url?: string | null;
    cause?: unknown;
}

/**
 * A typed Plex failure.
 *
 * URLs stored on the error are redacted so callers can log the error without
 * leaking the server token.
 */
export class PlexError extends Error {
    readonly code: PlexErrorCode;
    readonly status: number | null;
    readonly url: string | null;

    constructor(message: string, code: PlexErrorCode, options: PlexErrorOptions = {}) {
        super(
            redactPlexUrl(message),
            options.cause === undefined ? undefined : { cause: options.cause }
        );
        this.name = 'PlexError';
        this.code = code;
        this.status = options.status ?? null;
        this.url = options.url ? redactPlexUrl(options.url) : null;
    }
}

/** Construction options for PlexClient. */
export interface PlexClientOptions {
    baseUrl: string;
    token: string;
    clientIdentifier: string;
    timeoutMs?: number;
}

/** Page options for library browsing. */
export interface PlexLibraryItemsOptions {
    start?: number;
    size?: number;
}

/** A page of Plex library items. */
export interface PlexLibraryItemsPage {
    items: PlexItem[];
    total: number;
}

/**
 * A small Plex Media Server client for the endpoints OrbisCast needs.
 *
 * The client reads JSON only, never logs the token, and normalizes every
 * response into the models in `types.ts`.
 */
export class PlexClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly clientIdentifier: string;
    private readonly timeoutMs: number;

    constructor(options: PlexClientOptions) {
        this.baseUrl = normalizeClientBaseUrl(options.baseUrl);
        this.token = requireNonEmptyOption(options.token, 'token');
        this.clientIdentifier = requireNonEmptyOption(options.clientIdentifier, 'clientIdentifier');
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new PlexError('Plex timeout must be a positive number of milliseconds', 'INVALID_REQUEST');
        }
    }

    /**
     * Checks that the server is reachable and the token is valid.
     */
    async validate(): Promise<PlexServerInfo> {
        const container = await this.requestContainer('/');
        const raw = container as unknown as PlexRawServerInfo;
        const version = toStringOrNull(raw.version);
        const machineIdentifier = toStringOrNull(raw.machineIdentifier);

        if (!version || !machineIdentifier) {
            throw new PlexError('Plex server response is missing identity fields', 'MALFORMED_RESPONSE');
        }

        return {
            name: toStringOrNull(raw.friendlyName) ?? 'Plex',
            version,
            machineIdentifier,
            platform: toStringOrNull(raw.platform),
            platformVersion: toStringOrNull(raw.platformVersion),
            updatedAt: toNumber(raw.updatedAt),
            transcoderVideo: toBoolean(raw.transcoderVideo),
            transcoderAudio: toBoolean(raw.transcoderAudio),
            myPlex: toBoolean(raw.myPlex),
            myPlexSigninState: toStringOrNull(raw.myPlexSigninState)
        };
    }

    /**
     * Lists every library section on the server.
     */
    async getLibraries(): Promise<PlexLibrary[]> {
        const container = await this.requestContainer('/library/sections');
        return readDirectory(container).map((raw) => normalizeLibrary(raw));
    }

    /**
     * Reads one page of items from a library section.
     *
     * @param libraryKey - Plex library section key
     * @param options - Zero-based start offset and page size
     */
    async getLibraryItems(
        libraryKey: string,
        options: PlexLibraryItemsOptions = {}
    ): Promise<PlexLibraryItemsPage> {
        const key = requirePathSegment(libraryKey, 'libraryKey');
        const start = options.start ?? 0;
        const size = options.size ?? 50;
        assertPage(start, size);

        const container = await this.requestContainer(
            `/library/sections/${encodeURIComponent(key)}/all`,
            {
                'X-Plex-Container-Start': start,
                'X-Plex-Container-Size': size
            }
        );
        const items = readMetadata(container).map((raw) => this.normalizeItem(raw, key));
        return {
            items,
            total: toNumber(container.totalSize) ?? items.length
        };
    }

    /**
     * Searches the server for movies, shows, seasons, and episodes.
     *
     * @param query - Free text search query
     * @param libraryKeys - Optional library section keys to search within
     */
    async search(query: string, libraryKeys?: readonly string[]): Promise<PlexItem[]> {
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }
        if (libraryKeys && libraryKeys.length === 0) {
            return [];
        }

        const container = await this.requestContainer('/search', {
            query: trimmed,
            limit: DEFAULT_SEARCH_LIMIT,
            'X-Plex-Container-Start': 0,
            'X-Plex-Container-Size': DEFAULT_SEARCH_LIMIT
        });
        const allowedLibraries = libraryKeys
            ? new Set(libraryKeys.map((key) => String(key)))
            : null;
        const seen = new Set<string>();
        const items: PlexItem[] = [];

        for (const raw of readMetadata(container)) {
            const libraryKey = toStringOrNull(raw.librarySectionID) ?? '';
            if (allowedLibraries && !allowedLibraries.has(libraryKey)) {
                continue;
            }

            const item = this.normalizeItem(raw, libraryKey);
            if (item.type === 'unknown') {
                continue;
            }

            const dedupeKey = `${item.type}:${item.ratingKey}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            items.push(item);

            if (items.length >= DEFAULT_SEARCH_LIMIT) {
                break;
            }
        }

        return items;
    }

    /**
     * Loads one item with its media, parts, and streams.
     *
     * @param ratingKey - Plex metadata rating key
     */
    async getItem(ratingKey: string): Promise<PlexItemDetail> {
        const key = requirePathSegment(ratingKey, 'ratingKey');
        const container = await this.requestContainer(
            `/library/metadata/${encodeURIComponent(key)}`
        );
        const metadata = readMetadata(container);
        const raw = metadata[0];

        if (!raw) {
            throw new PlexError(
                'Plex did not return metadata for the requested item',
                'MALFORMED_RESPONSE'
            );
        }

        const libraryKey =
            toStringOrNull(raw.librarySectionID) ??
            toStringOrNull(container.librarySectionID) ??
            '';
        return this.normalizeDetail(raw, libraryKey);
    }

    /**
     * Lists the seasons of a show.
     *
     * @param showKey - Plex rating key of the show
     */
    async getSeasons(showKey: string): Promise<PlexSeason[]> {
        const key = requirePathSegment(showKey, 'showKey');
        const container = await this.requestContainer(
            `/library/metadata/${encodeURIComponent(key)}/children`,
            {
                'X-Plex-Container-Start': 0,
                'X-Plex-Container-Size': MAX_PAGE_SIZE
            }
        );
        const libraryKey = containerLibraryKey(container);

        return readMetadata(container)
            .filter((raw) => raw.type === 'season')
            .map((raw) => this.normalizeSeason(raw, libraryKey));
    }

    /**
     * Lists the episodes of a season.
     *
     * Plex omits stream details from leaf listings. Call `getItem` with the
     * episode rating key before playback when subtitle selection is needed.
     *
     * @param seasonKey - Plex rating key of the season
     */
    async getEpisodes(seasonKey: string): Promise<PlexEpisode[]> {
        const key = requirePathSegment(seasonKey, 'seasonKey');
        const container = await this.requestContainer(
            `/library/metadata/${encodeURIComponent(key)}/children`,
            {
                'X-Plex-Container-Start': 0,
                'X-Plex-Container-Size': MAX_PAGE_SIZE
            }
        );
        const libraryKey = containerLibraryKey(container);

        return readMetadata(container)
            .filter((raw) => raw.type === 'episode')
            .map((raw) => this.normalizeEpisode(raw, libraryKey));
    }

    /**
     * Lists every episode of a show, following Plex pagination.
     *
     * Plex omits stream details from leaf listings. Call `getItem` with the
     * episode rating key before playback when subtitle selection is needed.
     *
     * @param showKey - Plex rating key of the show
     */
    async getAllLeaves(showKey: string): Promise<PlexEpisode[]> {
        const key = requirePathSegment(showKey, 'showKey');
        const episodes: PlexEpisode[] = [];
        const seen = new Set<string>();
        let start = 0;
        let total = Number.POSITIVE_INFINITY;

        while (start < total) {
            const container = await this.requestContainer(
                `/library/metadata/${encodeURIComponent(key)}/allLeaves`,
                {
                    'X-Plex-Container-Start': start,
                    'X-Plex-Container-Size': ALL_LEAVES_PAGE_SIZE
                }
            );
            const libraryKey = containerLibraryKey(container);
            const rawPage = readMetadata(container);
            const page = rawPage
                .filter((raw) => raw.type === 'episode')
                .map((raw) => this.normalizeEpisode(raw, libraryKey));
            const fresh = page.filter((episode) => !seen.has(episode.ratingKey));

            if (fresh.length === 0) {
                break;
            }

            for (const episode of fresh) {
                seen.add(episode.ratingKey);
                episodes.push(episode);
            }

            const reportedTotal = toNumber(container.totalSize);
            if (reportedTotal !== null) {
                total = reportedTotal;
            }
            start += rawPage.length;

            if (episodes.length >= total) {
                break;
            }
            if (reportedTotal === null && rawPage.length < ALL_LEAVES_PAGE_SIZE) {
                break;
            }
        }

        return episodes;
    }

    /**
     * Builds a direct thumbnail URL. The URL contains the server token because
     * browsers and Discord cannot send Plex headers for image requests.
     *
     * @param ratingKey - Plex metadata rating key
     * @param width - Optional requested width in pixels
     * @param height - Optional requested height in pixels
     */
    thumbnailUrl(ratingKey: string, width?: number, height?: number): string {
        const key = requirePathSegment(ratingKey, 'ratingKey');
        const source = `/library/metadata/${encodeURIComponent(key)}/thumb`;
        const url = new URL(`${this.baseUrl}/photo/:/transcode`);
        url.searchParams.set('url', source);

        if (width !== undefined) {
            assertPositiveInteger(width, 'width');
            url.searchParams.set('width', String(width));
        }
        if (height !== undefined) {
            assertPositiveInteger(height, 'height');
            url.searchParams.set('height', String(height));
        }

        url.searchParams.set('X-Plex-Token', this.token);
        return url.toString();
    }

    private async requestContainer(
        path: string,
        params?: Record<string, string | number | undefined>
    ): Promise<PlexRawMediaContainer> {
        const payload = await this.requestJson(path, params);
        if (!isRecord(payload) || !isRecord(payload.MediaContainer)) {
            throw new PlexError('Plex response is missing MediaContainer', 'MALFORMED_RESPONSE');
        }
        return payload.MediaContainer as unknown as PlexRawMediaContainer;
    }

    private async requestJson(
        path: string,
        params?: Record<string, string | number | undefined>
    ): Promise<unknown> {
        const url = this.buildUrl(path, params);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Plex-Token': this.token,
                    'X-Plex-Client-Identifier': this.clientIdentifier,
                    'X-Plex-Product': 'OrbisCast'
                },
                signal: controller.signal
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new PlexError('Plex server rejected the token', 'UNAUTHORIZED', {
                        status: 401,
                        url
                    });
                }
                if (response.status === 404) {
                    throw new PlexError('Plex resource not found', 'NOT_FOUND', {
                        status: 404,
                        url
                    });
                }
                throw new PlexError(
                    `Plex request failed with status ${response.status}`,
                    'HTTP_ERROR',
                    { status: response.status, url }
                );
            }

            const text = await response.text();
            try {
                return JSON.parse(text) as unknown;
            } catch (error) {
                throw new PlexError('Plex returned invalid JSON', 'MALFORMED_RESPONSE', {
                    url,
                    cause: error
                });
            }
        } catch (error) {
            if (error instanceof PlexError) {
                throw error;
            }
            if (controller.signal.aborted) {
                throw new PlexError('Plex request timed out', 'TIMEOUT', { url, cause: error });
            }
            throw new PlexError('Plex request failed', 'NETWORK_ERROR', { url, cause: error });
        } finally {
            clearTimeout(timer);
        }
    }

    private buildUrl(
        path: string,
        params?: Record<string, string | number | undefined>
    ): string {
        const suffix = path.startsWith('/') ? path : `/${path}`;
        const url = new URL(`${this.baseUrl}${suffix}`);

        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        return url.toString();
    }

    private normalizeItem(raw: PlexRawItem, libraryKey: string): PlexItem {
        const ratingKey = toStringOrNull(raw.ratingKey);
        const type = normalizeItemType(raw.type);
        const title = raw.title ?? '';
        const parentTitle = raw.parentTitle ?? null;
        const grandparentTitle = raw.grandparentTitle ?? null;
        let showTitle: string | null = null;

        if (type === 'episode') {
            showTitle = grandparentTitle;
        } else if (type === 'season') {
            showTitle = parentTitle;
        } else if (type === 'show') {
            showTitle = title;
        }

        return {
            ratingKey: ratingKey ?? '',
            key: raw.key ?? (ratingKey ? `/library/metadata/${ratingKey}` : ''),
            libraryKey,
            type,
            title,
            titleSort: raw.titleSort ?? null,
            showTitle,
            parentTitle,
            grandparentTitle,
            seasonNumber:
                type === 'episode'
                    ? toNumber(raw.parentIndex)
                    : type === 'season'
                      ? toNumber(raw.index)
                      : null,
            episodeNumber: type === 'episode' ? toNumber(raw.index) : null,
            year: toNumber(raw.year) ?? toNumber(raw.parentYear),
            durationMs: toNumber(raw.duration),
            thumbUrl: ratingKey ? this.thumbnailUrl(ratingKey) : null,
            summary: raw.summary ?? null,
            index: toNumber(raw.index),
            parentIndex: toNumber(raw.parentIndex),
            leafCount: toNumber(raw.leafCount),
            childCount: toNumber(raw.childCount),
            addedAt: toNumber(raw.addedAt),
            updatedAt: toNumber(raw.updatedAt)
        };
    }

    private normalizeDetail(raw: PlexRawItem, libraryKey: string): PlexItemDetail {
        const base = this.normalizeItem(raw, libraryKey);
        const media = normalizeMedia(raw.Media);

        return {
            ...base,
            librarySectionTitle: raw.librarySectionTitle ?? null,
            studio: raw.studio ?? null,
            contentRating: raw.contentRating ?? null,
            audienceRating: toNumber(raw.audienceRating),
            rating: toNumber(raw.rating),
            originallyAvailableAt: raw.originallyAvailableAt ?? null,
            genres: tagNames(raw.Genre),
            directors: tagNames(raw.Director),
            writers: tagNames(raw.Writer),
            media,
            streams: flattenStreams(media)
        };
    }

    private normalizeSeason(raw: PlexRawItem, libraryKey: string): PlexSeason {
        const base = this.normalizeItem(raw, libraryKey);
        return {
            ...base,
            type: 'season',
            showRatingKey: toStringOrNull(raw.parentRatingKey),
            showTitle: base.showTitle ?? raw.parentTitle ?? null,
            seasonNumber: toNumber(raw.index),
            episodeCount: toNumber(raw.leafCount),
            viewedEpisodeCount: toNumber(raw.viewedLeafCount)
        };
    }

    private normalizeEpisode(raw: PlexRawItem, libraryKey: string): PlexEpisode {
        const base = this.normalizeItem(raw, libraryKey);
        const media = normalizeMedia(raw.Media);

        return {
            ...base,
            type: 'episode',
            showRatingKey: toStringOrNull(raw.grandparentRatingKey),
            seasonRatingKey: toStringOrNull(raw.parentRatingKey),
            showTitle: base.showTitle ?? raw.grandparentTitle ?? null,
            seasonNumber: toNumber(raw.parentIndex),
            episodeNumber: toNumber(raw.index),
            media,
            streams: flattenStreams(media)
        };
    }
}

function normalizeLibrary(raw: PlexRawLibrary): PlexLibrary {
    return {
        key: toStringOrNull(raw.key) ?? '',
        title: raw.title ?? '',
        type: normalizeLibraryType(raw.type),
        agent: raw.agent ?? null,
        scanner: raw.scanner ?? null,
        language: raw.language ?? null,
        uuid: raw.uuid ?? null,
        refreshing: toBoolean(raw.refreshing),
        hidden: toBoolean(raw.hidden),
        updatedAt: toNumber(raw.updatedAt),
        createdAt: toNumber(raw.createdAt),
        scannedAt: toNumber(raw.scannedAt)
    };
}

function normalizeMedia(rawMedia: PlexRawMedia[] | undefined): PlexMedia[] {
    if (!Array.isArray(rawMedia)) {
        return [];
    }
    return rawMedia.map((raw) => ({
        id: toNumber(raw.id) ?? 0,
        durationMs: toNumber(raw.duration),
        bitrate: toNumber(raw.bitrate),
        width: toNumber(raw.width),
        height: toNumber(raw.height),
        aspectRatio: toNumber(raw.aspectRatio),
        audioChannels: toNumber(raw.audioChannels),
        audioCodec: raw.audioCodec ?? null,
        videoCodec: raw.videoCodec ?? null,
        videoResolution: raw.videoResolution ?? null,
        container: raw.container ?? null,
        videoFrameRate: raw.videoFrameRate ?? null,
        videoProfile: raw.videoProfile ?? null,
        parts: normalizeParts(raw.Part)
    }));
}

function normalizeParts(rawParts: PlexRawPart[] | undefined): PlexMediaPart[] {
    if (!Array.isArray(rawParts)) {
        return [];
    }
    return rawParts.map((raw) => ({
        id: toNumber(raw.id) ?? 0,
        key: raw.key ?? null,
        file: raw.file ?? null,
        durationMs: toNumber(raw.duration),
        sizeBytes: toNumber(raw.size),
        container: raw.container ?? null,
        videoProfile: raw.videoProfile ?? null,
        streams: normalizeStreams(raw.Stream)
    }));
}

function normalizeStreams(rawStreams: PlexRawStream[] | undefined): PlexStream[] {
    if (!Array.isArray(rawStreams)) {
        return [];
    }
    return rawStreams.map((raw) => {
        const streamType = toNumber(raw.streamType) ?? 0;
        return {
            id: toNumber(raw.id) ?? 0,
            streamType,
            type: normalizeStreamType(streamType),
            codec: raw.codec ?? null,
            language: raw.language ?? null,
            languageTag: raw.languageTag ?? null,
            languageCode: raw.languageCode ?? null,
            displayTitle: raw.displayTitle ?? null,
            extendedDisplayTitle: raw.extendedDisplayTitle ?? null,
            title: raw.title ?? null,
            index: toNumber(raw.index),
            channels: toNumber(raw.channels),
            bitrate: toNumber(raw.bitrate),
            width: toNumber(raw.width),
            height: toNumber(raw.height),
            samplingRate: toNumber(raw.samplingRate),
            bitDepth: toNumber(raw.bitDepth),
            frameRate: toNumber(raw.frameRate),
            profile: raw.profile ?? null,
            default: toBoolean(raw.default),
            forced: toBoolean(raw.forced),
            selected: toBoolean(raw.selected)
        };
    });
}

function flattenStreams(media: readonly PlexMedia[]): PlexStream[] {
    return media.flatMap((item) => item.parts.flatMap((part) => part.streams));
}

function tagNames(tags: PlexRawTag[] | undefined): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .map((tag) => tag.tag)
        .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
}

function normalizeLibraryType(value: string | undefined): PlexLibraryType {
    switch (value) {
        case 'movie':
        case 'show':
        case 'artist':
        case 'photo':
            return value;
        default:
            return 'unknown';
    }
}

function normalizeItemType(value: string | undefined): PlexItemType {
    switch (value) {
        case 'movie':
        case 'show':
        case 'season':
        case 'episode':
            return value;
        default:
            return 'unknown';
    }
}

function normalizeStreamType(value: number): PlexStreamType {
    switch (value) {
        case 1:
            return 'video';
        case 2:
            return 'audio';
        case 3:
            return 'subtitle';
        case 4:
            return 'lyrics';
        default:
            return 'unknown';
    }
}

function readMetadata(container: PlexRawMediaContainer): PlexRawItem[] {
    if (container.Metadata === undefined || container.Metadata === null) {
        return [];
    }
    if (!Array.isArray(container.Metadata)) {
        throw new PlexError('Plex response has an invalid Metadata field', 'MALFORMED_RESPONSE');
    }
    return container.Metadata;
}

function readDirectory(container: PlexRawMediaContainer): PlexRawLibrary[] {
    if (container.Directory === undefined || container.Directory === null) {
        return [];
    }
    if (!Array.isArray(container.Directory)) {
        throw new PlexError('Plex response has an invalid Directory field', 'MALFORMED_RESPONSE');
    }
    return container.Directory;
}

function containerLibraryKey(container: PlexRawMediaContainer): string {
    return toStringOrNull(container.librarySectionID) ?? '';
}

function normalizeClientBaseUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new PlexError('Plex base URL is required', 'INVALID_REQUEST');
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new PlexError('Plex base URL is not a valid URL', 'INVALID_REQUEST');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new PlexError('Plex base URL must use http or https', 'INVALID_REQUEST');
    }
    if (parsed.username || parsed.password) {
        throw new PlexError('Plex base URL must not contain credentials', 'INVALID_REQUEST');
    }
    if (parsed.search || parsed.hash) {
        throw new PlexError(
            'Plex base URL must not contain a query string or fragment',
            'INVALID_REQUEST'
        );
    }

    return trimmed.replace(/\/+$/, '');
}

function requireNonEmptyOption(value: string, field: string): string {
    if (!value || !value.trim()) {
        throw new PlexError(`Plex ${field} is required`, 'INVALID_REQUEST');
    }
    return value;
}

function requirePathSegment(value: string, field: string): string {
    if (!value || !value.trim()) {
        throw new PlexError(`Plex ${field} is required`, 'INVALID_REQUEST');
    }
    return value;
}

function assertPage(start: number, size: number): void {
    if (!Number.isInteger(start) || start < 0) {
        throw new PlexError('Plex start must be a non-negative integer', 'INVALID_REQUEST');
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_PAGE_SIZE) {
        throw new PlexError(
            `Plex size must be an integer between 1 and ${MAX_PAGE_SIZE}`,
            'INVALID_REQUEST'
        );
    }
}

function assertPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new PlexError(
            `Plex ${field} must be a positive integer`,
            'INVALID_REQUEST'
        );
    }
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toStringOrNull(value: unknown): string | null {
    if (typeof value === 'string' && value.trim() !== '') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function toBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
