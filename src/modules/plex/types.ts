/**
 * Normalized Plex models.
 *
 * These types are deliberately independent from the raw Plex Media Server
 * payloads. Plex mixes numeric strings, booleans encoded as 0/1, and optional
 * fields; the client normalizes all of it into the camelCase shapes below.
 */

/** Supported Plex quality preset identifiers. */
export type PlexQuality = '720p-4' | '1080p-8' | '1080p-12' | '4k-20';

/** Plex library section kinds that OrbisCast understands. */
export type PlexLibraryType = 'movie' | 'show' | 'artist' | 'photo' | 'unknown';

/** Plex metadata item kinds that OrbisCast understands. */
export type PlexItemType = 'movie' | 'show' | 'season' | 'episode' | 'unknown';

/** Plex media stream kinds. */
export type PlexStreamType = 'video' | 'audio' | 'subtitle' | 'lyrics' | 'unknown';

/** A Plex library section returned by `/library/sections`. */
export interface PlexLibrary {
    key: string;
    title: string;
    type: PlexLibraryType;
    agent: string | null;
    scanner: string | null;
    language: string | null;
    uuid: string | null;
    refreshing: boolean;
    hidden: boolean;
    updatedAt: number | null;
    createdAt: number | null;
    scannedAt: number | null;
}

/** A single Plex metadata item, normalized for browsing and queueing. */
export interface PlexItem {
    ratingKey: string;
    key: string;
    libraryKey: string;
    type: PlexItemType;
    title: string;
    titleSort: string | null;
    showTitle: string | null;
    parentTitle: string | null;
    grandparentTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    durationMs: number | null;
    /** Absolute thumbnail URL. It contains the server token, so treat it as a secret. */
    thumbUrl: string | null;
    summary: string | null;
    index: number | null;
    parentIndex: number | null;
    leafCount: number | null;
    childCount: number | null;
    addedAt: number | null;
    updatedAt: number | null;
}

/** A media version of an item, for example a 1080p and a 4K copy. */
export interface PlexMedia {
    id: number;
    durationMs: number | null;
    bitrate: number | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    audioChannels: number | null;
    audioCodec: string | null;
    videoCodec: string | null;
    videoResolution: string | null;
    container: string | null;
    videoFrameRate: string | null;
    videoProfile: string | null;
    parts: PlexMediaPart[];
}

/** A playable file inside a Plex media version. */
export interface PlexMediaPart {
    id: number;
    key: string | null;
    file: string | null;
    durationMs: number | null;
    sizeBytes: number | null;
    container: string | null;
    videoProfile: string | null;
    streams: PlexStream[];
}

/** A video, audio, subtitle, or lyrics stream inside a media part. */
export interface PlexStream {
    id: number;
    streamType: number;
    type: PlexStreamType;
    codec: string | null;
    language: string | null;
    languageTag: string | null;
    languageCode: string | null;
    displayTitle: string | null;
    extendedDisplayTitle: string | null;
    title: string | null;
    index: number | null;
    channels: number | null;
    bitrate: number | null;
    width: number | null;
    height: number | null;
    samplingRate: number | null;
    bitDepth: number | null;
    frameRate: number | null;
    profile: string | null;
    default: boolean;
    forced: boolean;
    selected: boolean;
}

/** A marker on a Plex item, for example an intro or credits marker. */
export interface PlexMarker {
    type: 'intro' | 'credits' | 'unknown';
    startMs: number | null;
    endMs: number | null;
}

/** A movie, show, season, or episode with its full media tree. */
export interface PlexItemDetail extends PlexItem {
    librarySectionTitle: string | null;
    studio: string | null;
    contentRating: string | null;
    audienceRating: number | null;
    rating: number | null;
    originallyAvailableAt: string | null;
    genres: string[];
    directors: string[];
    writers: string[];
    media: PlexMedia[];
    /** All streams across every media part, in Plex order. */
    streams: PlexStream[];
    /** Show rating key for an episode or season. */
    showRatingKey: string | null;
    /** Season rating key for an episode. */
    seasonRatingKey: string | null;
    /** Intro and credits markers when requested with includeMarkers. */
    markers: PlexMarker[];
}

/** A season belonging to a show. */
export interface PlexSeason extends PlexItem {
    type: 'season';
    showRatingKey: string | null;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeCount: number | null;
    viewedEpisodeCount: number | null;
}

/** An episode belonging to a season and show. */
export interface PlexEpisode extends PlexItem {
    type: 'episode';
    showRatingKey: string | null;
    seasonRatingKey: string | null;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    media: PlexMedia[];
    /** Leaf listings omit streams; call getItem before playback for subtitles. */
    streams: PlexStream[];
}

/** Information returned by a successful Plex server validation call. */
export interface PlexServerInfo {
    name: string;
    version: string;
    machineIdentifier: string;
    platform: string | null;
    platformVersion: string | null;
    updatedAt: number | null;
    transcoderVideo: boolean;
    transcoderAudio: boolean;
    myPlex: boolean;
    myPlexSigninState: string | null;
}

/**
 * Raw Plex API types.
 *
 * Plex responses are XML by default. Every request from this module asks for
 * JSON, but numeric fields still arrive as either numbers or strings and
 * booleans can arrive as true/false or 1/0. These types describe that input
 * before normalization.
 */

export interface PlexRawStream {
    id?: number | string;
    streamType?: number | string;
    codec?: string;
    language?: string;
    languageTag?: string;
    languageCode?: string;
    displayTitle?: string;
    extendedDisplayTitle?: string;
    title?: string;
    index?: number | string;
    channels?: number | string;
    bitrate?: number | string;
    width?: number | string;
    height?: number | string;
    samplingRate?: number | string;
    bitDepth?: number | string;
    frameRate?: number | string;
    profile?: string;
    default?: boolean | number | string;
    forced?: boolean | number | string;
    selected?: boolean | number | string;
}

export interface PlexRawPart {
    id?: number | string;
    key?: string;
    file?: string;
    duration?: number | string;
    size?: number | string;
    container?: string;
    videoProfile?: string;
    Stream?: PlexRawStream[];
}

export interface PlexRawMedia {
    id?: number | string;
    duration?: number | string;
    bitrate?: number | string;
    width?: number | string;
    height?: number | string;
    aspectRatio?: number | string;
    audioChannels?: number | string;
    audioCodec?: string;
    videoCodec?: string;
    videoResolution?: string;
    container?: string;
    videoFrameRate?: string;
    videoProfile?: string;
    Part?: PlexRawPart[];
}

export interface PlexRawTag {
    tag?: string;
}

export interface PlexRawItem {
    ratingKey?: number | string;
    key?: string;
    librarySectionID?: number | string;
    librarySectionTitle?: string;
    type?: string;
    title?: string;
    titleSort?: string;
    summary?: string;
    thumb?: string;
    art?: string;
    year?: number | string;
    duration?: number | string;
    index?: number | string;
    parentIndex?: number | string;
    parentRatingKey?: number | string;
    grandparentRatingKey?: number | string;
    parentTitle?: string;
    grandparentTitle?: string;
    parentYear?: number | string;
    leafCount?: number | string;
    viewedLeafCount?: number | string;
    childCount?: number | string;
    addedAt?: number | string;
    updatedAt?: number | string;
    contentRating?: string;
    studio?: string;
    audienceRating?: number | string;
    rating?: number | string;
    originallyAvailableAt?: string;
    Media?: PlexRawMedia[];
    Marker?: PlexRawMarker[];
    Genre?: PlexRawTag[];
    Director?: PlexRawTag[];
    Writer?: PlexRawTag[];
}

export interface PlexRawMarker {
    type?: string;
    startTimeOffset?: number | string;
    endTimeOffset?: number | string;
}

export interface PlexRawLibrary {
    key?: number | string;
    title?: string;
    type?: string;
    agent?: string;
    scanner?: string;
    language?: string;
    uuid?: string;
    refreshing?: boolean | number | string;
    hidden?: boolean | number | string;
    updatedAt?: number | string;
    createdAt?: number | string;
    scannedAt?: number | string;
}

export interface PlexRawMediaContainer {
    size?: number | string;
    totalSize?: number | string;
    offset?: number | string;
    librarySectionID?: number | string;
    librarySectionTitle?: string;
    Metadata?: PlexRawItem[];
    Directory?: PlexRawLibrary[];
    [key: string]: unknown;
}

export interface PlexRawServerInfo {
    friendlyName?: string;
    version?: string;
    machineIdentifier?: string;
    platform?: string;
    platformVersion?: string;
    updatedAt?: number | string;
    transcoderVideo?: boolean | number | string;
    transcoderAudio?: boolean | number | string;
    myPlex?: boolean | number | string;
    myPlexSigninState?: string;
}
