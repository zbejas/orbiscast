import { redactSecrets } from '../../utils/redact';
import type { MediaLibraryType } from '../../shared/types';
import { ticksToMs, toFiniteNumber, toPositiveInt } from '../media/types';
import type {
    JellyfinLibrary,
    JellyfinRawItem,
    JellyfinRawList,
    JellyfinRawMediaSource,
    JellyfinRawServerInfo,
    JellyfinRawStream,
    JellyfinRawUser,
} from './types';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Error codes emitted by the Jellyfin client. */
export type JellyfinErrorCode =
    | 'UNAUTHORIZED'
    | 'NOT_FOUND'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR'
    | 'MALFORMED_RESPONSE'
    | 'INVALID_REQUEST';

/** Extra context attached to a JellyfinError. */
export interface JellyfinErrorOptions {
    status?: number | null;
    url?: string | null;
    cause?: unknown;
}

/** A typed Jellyfin failure with a redacted URL. */
export class JellyfinError extends Error {
    readonly code: JellyfinErrorCode;
    readonly status: number | null;
    readonly url: string | null;

    constructor(message: string, code: JellyfinErrorCode, options: JellyfinErrorOptions = {}) {
        super(redactSecrets(message), options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'JellyfinError';
        this.code = code;
        this.status = options.status ?? null;
        this.url = options.url ? redactSecrets(options.url) : null;
    }
}

/** Construction options for JellyfinClient. */
export interface JellyfinClientOptions {
    baseUrl: string;
    token: string;
    clientIdentifier: string;
    /** Optional saved user id. The first admin is used when omitted. */
    userId?: string | null;
    timeoutMs?: number;
}

/** Page options for library browsing. */
export interface JellyfinLibraryItemsOptions {
    start?: number;
    size?: number;
}

/** A page of Jellyfin library items. */
export interface JellyfinLibraryItemsPage {
    items: JellyfinRawItem[];
    total: number;
}

/** A normalized Jellyfin stream. */
export interface JellyfinStream {
    id: number;
    index: number | null;
    type: 'video' | 'audio' | 'subtitle';
    codec: string | null;
    language: string | null;
    displayTitle: string | null;
    default: boolean;
    forced: boolean;
    burnable: boolean;
}

/** A normalized Jellyfin item. */
export interface JellyfinItem {
    itemId: string;
    libraryKey: string;
    type: 'movie' | 'show' | 'season' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    durationMs: number | null;
    summary: string | null;
}

/** A normalized Jellyfin item with media streams. */
export interface JellyfinItemDetail extends JellyfinItem {
    mediaSourceId: string | null;
    partId: string | null;
    showItemId: string | null;
    seasonItemId: string | null;
    intro: { startMs: number; endMs: number } | null;
    streams: JellyfinStream[];
}

/** Information returned by a successful Jellyfin validation call. */
export interface JellyfinServerInfo {
    name: string;
    version: string;
    serverId: string;
    userId: string;
    userName: string;
}

/**
 * A small Jellyfin client for the endpoints OrbisCast needs.
 *
 * Requests use the Jellyfin 12 `Authorization: MediaBrowser Token="..."`
 * header. The token is never put in a returned URL or a log line.
 */
export class JellyfinClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly clientIdentifier: string;
    private readonly preferredUserId: string | null;
    private readonly timeoutMs: number;
    private resolvedUserId: string | null;
    private resolvedUserName: string | null;

    constructor(options: JellyfinClientOptions) {
        this.baseUrl = normalizeClientBaseUrl(options.baseUrl);
        this.token = requireNonEmpty(options.token, 'token');
        this.clientIdentifier = requireNonEmpty(options.clientIdentifier, 'clientIdentifier');
        this.preferredUserId = options.userId ?? null;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.resolvedUserId = null;
        this.resolvedUserName = null;

        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new JellyfinError('Jellyfin timeout must be a positive number of milliseconds', 'INVALID_REQUEST');
        }
    }

    /**
     * Checks the server and picks the user used for metadata and playback.
     */
    async validate(): Promise<JellyfinServerInfo> {
        const info = await this.requestJson<JellyfinRawServerInfo>('System/Info');
        const users = await this.requestJson<JellyfinRawUser[]>('Users');
        const user = pickUser(users, this.preferredUserId);
        if (!user?.Id) {
            throw new JellyfinError('Jellyfin has no users; add a user before connecting', 'MALFORMED_RESPONSE');
        }
        this.resolvedUserId = user.Id;
        this.resolvedUserName = user.Name ?? null;

        const name = toStringOrNull(info.ServerName);
        const version = toStringOrNull(info.Version);
        const serverId = toStringOrNull(info.Id);
        if (!name || !version || !serverId) {
            throw new JellyfinError('Jellyfin server response is missing identity fields', 'MALFORMED_RESPONSE');
        }

        return {
            name,
            version,
            serverId,
            userId: user.Id,
            userName: user.Name ?? 'Jellyfin',
        };
    }

    /**
     * Lists the server's library folders.
     */
    async getLibraries(): Promise<JellyfinLibrary[]> {
        const list = await this.requestJson<JellyfinRawList>('Library/MediaFolders');
        return (list.Items ?? []).map(item => ({
            id: item.Id ?? '',
            title: item.Name ?? 'Untitled',
            type: normalizeLibraryType(item.CollectionType),
        })).filter(library => library.id.length > 0);
    }

    /**
     * Reads one page of movies and shows from a library.
     *
     * @param libraryId - Library folder id
     * @param options - Zero-based start offset and page size
     */
    async getLibraryItems(
        libraryId: string,
        options: JellyfinLibraryItemsOptions = {}
    ): Promise<JellyfinLibraryItemsPage> {
        const start = options.start ?? 0;
        const size = options.size ?? 50;
        assertPage(start, size);
        const list = await this.requestJson<JellyfinRawList>('Items', {
            parentId: requireId(libraryId, 'libraryId'),
            recursive: 'true',
            includeItemTypes: ITEM_TYPES,
            sortBy: 'SortName',
            sortOrder: 'Ascending',
            startIndex: String(start),
            limit: String(size),
            fields: ITEM_FIELDS,
            userId: this.requireUserId(),
        });
        return {
            items: list.Items ?? [],
            total: toFiniteNumber(list.TotalRecordCount) ?? (list.Items ?? []).length,
        };
    }

    /**
     * Searches inside the provided libraries.
     *
     * @param query - Free text query
     * @param libraryIds - Libraries to search, normally the enabled ones
     */
    async search(
        query: string,
        libraryIds?: readonly string[]
    ): Promise<Array<{ item: JellyfinRawItem; libraryId: string }>> {
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }
        const keys = libraryIds && libraryIds.length > 0
            ? [...libraryIds]
            : (await this.getLibraries()).map(library => library.id);
        if (keys.length === 0) {
            return [];
        }

        const seen = new Set<string>();
        const results: Array<{ item: JellyfinRawItem; libraryId: string }> = [];
        for (const libraryId of keys) {
            const list = await this.requestJson<JellyfinRawList>('Items', {
                parentId: libraryId,
                recursive: 'true',
                includeItemTypes: `${ITEM_TYPES},Episode`,
                searchTerm: trimmed,
                limit: '50',
                fields: ITEM_FIELDS,
                userId: this.requireUserId(),
            });
            for (const item of list.Items ?? []) {
                if (!item.Id || seen.has(item.Id)) continue;
                seen.add(item.Id);
                results.push({ item, libraryId });
            }
        }
        return results;
    }

    /**
     * Lists the seasons of a series.
     *
     * @param showId - Series id
     */
    async getSeasons(showId: string): Promise<JellyfinRawItem[]> {
        const list = await this.requestJson<JellyfinRawList>(
            `Shows/${encodeURIComponent(requireId(showId, 'showId'))}/Seasons`,
            {
                userId: this.requireUserId(),
                fields: ITEM_FIELDS,
            }
        );
        return list.Items ?? [];
    }

    /**
     * Lists the episodes of a season.
     *
     * @param seasonId - Season id
     */
    async getEpisodes(seasonId: string): Promise<JellyfinRawItem[]> {
        const list = await this.requestJson<JellyfinRawList>('Items', {
            parentId: requireId(seasonId, 'seasonId'),
            recursive: 'false',
            includeItemTypes: 'Episode',
            sortBy: 'ParentIndexNumber,IndexNumber,SortName',
            sortOrder: 'Ascending',
            fields: ITEM_FIELDS,
            userId: this.requireUserId(),
        });
        return list.Items ?? [];
    }

    /**
     * Lists every episode of a series.
     *
     * @param showId - Series id
     */
    async getAllEpisodes(showId: string): Promise<JellyfinRawItem[]> {
        const list = await this.requestJson<JellyfinRawList>(
            `Shows/${encodeURIComponent(requireId(showId, 'showId'))}/Episodes`,
            {
                userId: this.requireUserId(),
                fields: ITEM_FIELDS,
            }
        );
        return list.Items ?? [];
    }

    /**
     * Reads one item with its media streams.
     *
     * @param itemId - Jellyfin item id
     */
    async getItem(itemId: string): Promise<JellyfinRawItem> {
        const id = requireId(itemId, 'itemId');
        const user = this.requireUserId();
        return this.requestJson<JellyfinRawItem>(`Users/${encodeURIComponent(user)}/Items/${encodeURIComponent(id)}`, {
            fields: `${ITEM_FIELDS},MediaSources,MediaStreams`,
        });
    }

    /**
     * Fetches a poster from the server so the token stays server-side.
     *
     * @param itemId - Jellyfin item id
     * @param width - Target width
     * @param height - Target height
     */
    async fetchThumbnail(
        itemId: string,
        width: number,
        height: number
    ): Promise<{ contentType: string; body: Buffer }> {
        const url = this.url(`Items/${encodeURIComponent(requireId(itemId, 'itemId'))}/Images/Primary`, {
            maxWidth: String(width),
            maxHeight: String(height),
            quality: '90',
        });
        const response = await this.fetchWithTimeout(url, { headers: this.headers() });
        if (!response.ok) {
            throw new JellyfinError('Jellyfin thumbnail request failed', 'HTTP_ERROR', {
                status: response.status,
                url: url.toString(),
            });
        }
        return {
            contentType: response.headers.get('content-type') ?? 'image/jpeg',
            body: Buffer.from(await response.arrayBuffer()),
        };
    }

    /**
     * Returns the decrypted user id chosen during validation.
     */
    get userId(): string | null {
        return this.resolvedUserId;
    }

    /**
     * Returns the user name chosen during validation.
     */
    get userName(): string | null {
        return this.resolvedUserName;
    }

    private requireUserId(): string {
        if (!this.resolvedUserId) {
            throw new JellyfinError('Jellyfin user is not resolved; validate the connection first', 'INVALID_REQUEST');
        }
        return this.resolvedUserId;
    }

    private url(path: string, params: Record<string, string> = {}): URL {
        const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
        const url = new URL(path.replace(/^\/+/, ''), base);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url;
    }

    private async requestJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
        const url = this.url(path, params);
        let response: Response;
        try {
            response = await this.fetchWithTimeout(url, { headers: this.headers() });
        } catch (error) {
            if (isAbortError(error)) {
                throw new JellyfinError('Jellyfin request timed out', 'TIMEOUT', { url: url.toString(), cause: error });
            }
            throw new JellyfinError('Jellyfin request failed', 'NETWORK_ERROR', { url: url.toString(), cause: error });
        }

        if (response.status === 401 || response.status === 403) {
            throw new JellyfinError('Jellyfin rejected the API key', 'UNAUTHORIZED', {
                status: response.status,
                url: url.toString(),
            });
        }
        if (response.status === 404) {
            throw new JellyfinError('Jellyfin resource not found', 'NOT_FOUND', {
                status: response.status,
                url: url.toString(),
            });
        }
        if (!response.ok) {
            throw new JellyfinError('Jellyfin request failed', 'HTTP_ERROR', {
                status: response.status,
                url: url.toString(),
            });
        }

        const text = await response.text();
        if (!text) {
            return {} as T;
        }
        try {
            return JSON.parse(text) as T;
        } catch (error) {
            throw new JellyfinError('Jellyfin returned a malformed response', 'MALFORMED_RESPONSE', {
                url: url.toString(),
                cause: error,
            });
        }
    }

    private headers(): Record<string, string> {
        return {
            Authorization: `MediaBrowser Token="${this.token}"`,
            'X-Emby-Token': this.token,
            Accept: 'application/json',
        };
    }

    private fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
        return fetch(url, {
            ...init,
            signal: AbortSignal.timeout(this.timeoutMs),
        });
    }
}

/** The item fields requested from Jellyfin list endpoints. */
const ITEM_FIELDS = 'Overview,ProductionYear,RunTimeTicks,SeriesId,SeasonId,ParentId,ImageTags';
/** The item types browsable from a library. */
const ITEM_TYPES = 'Movie,Series';

function pickUser(users: JellyfinRawUser[], preferredId: string | null): JellyfinRawUser | null {
    if (preferredId) {
        const preferred = users.find(user => user.Id === preferredId);
        if (preferred) return preferred;
    }
    return users.find(user => user.Policy?.IsAdministrator) ?? users[0] ?? null;
}

export function normalizeJellyfinItem(raw: JellyfinRawItem, libraryKey: string): JellyfinItem {
    const type = normalizeItemType(raw.Type);
    const index = toPositiveInt(raw.IndexNumber);
    const parentIndex = toPositiveInt(raw.ParentIndexNumber);
    return {
        itemId: raw.Id ?? '',
        libraryKey,
        type,
        title: raw.Name ?? 'Untitled',
        showTitle: raw.SeriesName ?? (type === 'show' ? raw.Name ?? null : null),
        seasonNumber: type === 'season' ? index : type === 'episode' ? parentIndex : null,
        episodeNumber: type === 'episode' ? index : null,
        year: toFiniteNumber(raw.ProductionYear),
        durationMs: ticksToMs(raw.RunTimeTicks),
        summary: raw.Overview ?? null,
    };
}

export function normalizeJellyfinDetail(raw: JellyfinRawItem, libraryKey: string): JellyfinItemDetail {
    const item = normalizeJellyfinItem(raw, libraryKey);
    const mediaSource: JellyfinRawMediaSource | undefined = raw.MediaSources?.[0];
    const streams = mediaSource?.MediaStreams ?? raw.MediaStreams ?? [];
    return {
        ...item,
        durationMs: item.durationMs ?? ticksToMs(mediaSource?.RunTimeTicks),
        mediaSourceId: mediaSource?.Id ?? null,
        partId: null,
        showItemId: raw.SeriesId ?? (item.type === 'show' ? item.itemId : null),
        seasonItemId: raw.SeasonId ?? (item.type === 'season' ? item.itemId : null),
        intro: null,
        streams: streams.map(normalizeJellyfinStream),
    };
}

export function normalizeJellyfinStream(raw: JellyfinRawStream): JellyfinStream {
    const index = toFiniteNumber(raw.Index);
    const type = raw.Type?.toLowerCase();
    const normalizedType = type === 'audio' || type === 'subtitle' ? type : 'video';
    return {
        id: index ?? 0,
        index: index !== null && Number.isInteger(index) && index >= 0 ? index : null,
        type: normalizedType,
        codec: raw.Codec ?? null,
        language: raw.Language ?? null,
        displayTitle: raw.DisplayTitle ?? raw.Title ?? null,
        default: raw.IsDefault === true,
        forced: raw.IsForced === true,
        burnable:
            normalizedType === 'subtitle' &&
            index !== null &&
            Number.isInteger(index) &&
            index >= 0,
    };
}

function normalizeItemType(value: string | undefined): JellyfinItem['type'] {
    if (value === 'Movie') return 'movie';
    if (value === 'Series') return 'show';
    if (value === 'Season') return 'season';
    if (value === 'Episode') return 'episode';
    throw new JellyfinError(`Unsupported Jellyfin item type: ${value ?? 'missing'}`, 'MALFORMED_RESPONSE');
}

function normalizeLibraryType(value: string | undefined): MediaLibraryType {
    if (value === 'movies') return 'movie';
    if (value === 'tvshows') return 'show';
    if (value === 'music') return 'artist';
    if (value === 'photos') return 'photo';
    return 'unknown';
}

function normalizeClientBaseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) {
        throw new JellyfinError('Jellyfin server URL is required', 'INVALID_REQUEST');
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new JellyfinError('Jellyfin server URL is not valid', 'INVALID_REQUEST');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new JellyfinError('Jellyfin server URL must use http or https', 'INVALID_REQUEST');
    }
    return trimmed;
}

function requireNonEmpty(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new JellyfinError(`Jellyfin ${field} is required`, 'INVALID_REQUEST');
    }
    return trimmed;
}

function requireId(value: string, field: string): string {
    return requireNonEmpty(value, field);
}

function assertPage(start: number, size: number): void {
    if (!Number.isInteger(start) || start < 0) {
        throw new JellyfinError('Jellyfin start offset must be a non-negative integer', 'INVALID_REQUEST');
    }
    if (!Number.isInteger(size) || size <= 0 || size > 1000) {
        throw new JellyfinError('Jellyfin page size must be between 1 and 1000', 'INVALID_REQUEST');
    }
}

function toStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
