import { randomUUID } from 'node:crypto';
import type { PlexQuality, PlexStream } from './types';

/** A video quality preset used by the Plex HLS transcoder. */
export interface PlexQualityPreset {
    width: number;
    height: number;
    bitrateKbps: number;
    videoResolution: string;
}

/** Available quality presets, keyed by the value stored in the database. */
export const QUALITY_PRESETS = {
    '720p-4': {
        width: 1280,
        height: 720,
        bitrateKbps: 4000,
        videoResolution: '1280x720'
    },
    '1080p-8': {
        width: 1920,
        height: 1080,
        bitrateKbps: 8000,
        videoResolution: '1920x1080'
    },
    '1080p-12': {
        width: 1920,
        height: 1080,
        bitrateKbps: 12000,
        videoResolution: '1920x1080'
    },
    '4k-20': {
        width: 3840,
        height: 2160,
        bitrateKbps: 20000,
        videoResolution: '3840x2160'
    }
} as const satisfies Record<PlexQuality, PlexQualityPreset>;

/** Quality used when the caller does not specify one. */
export const DEFAULT_QUALITY: PlexQuality = '1080p-8';

/**
 * Client profile that tells Plex to produce a raw Matroska transcode stream.
 *
 * Plex's HLS packager can advertise `.ts` segments while producing Matroska
 * chunks, which leaves FFmpeg waiting on 404s. The raw endpoint is stable and
 * supports seek-by-offset, which is how the app replaces sources.
 */
const PLEX_TRANSCODE_PROFILE =
    'add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mkv&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)';

/** How a subtitle stream was selected. */
export type PlexSubtitleReason = 'default' | 'forced' | 'first';

/** The subtitle stream chosen for playback. */
export interface PlexSubtitleSelection {
    stream: PlexStream;
    streamId: number;
    reason: PlexSubtitleReason;
}

/**
 * Subtitle codecs that are text based. This is used as a display hint only:
 * Plex burns image subtitles as well when the track has a stream index.
 */
const TEXT_SUBTITLE_CODECS = new Set([
    'ass',
    'eia_608',
    'cea608',
    'mov_text',
    'smi',
    'srt',
    'ssa',
    'subrip',
    'sami',
    'text',
    'ttml',
    'vtt',
    'webvtt'
]);

/** The token value written into redacted URLs. */
const REDACTED_TOKEN = 'redacted';

/**
 * Returns true when a stream is a text subtitle that can be burned.
 *
 * @param stream - Normalized Plex stream
 */
export function isTextSubtitleStream(stream: PlexStream): boolean {
    if (stream.type !== 'subtitle' && stream.streamType !== 3) {
        return false;
    }
    if (!stream.codec) {
        return false;
    }
    return TEXT_SUBTITLE_CODECS.has(stream.codec.trim().toLowerCase());
}

/**
 * Returns true when a stream is a subtitle that Plex can burn into the video.
 *
 * Plex burns a subtitle with a per-part stream index. The transcode request
 * itself takes the global stream id in `subtitleStreamID`; the provider maps
 * the index back to the id.
 *
 * @param stream - Normalized Plex stream
 */
export function isBurnableSubtitleStream(stream: PlexStream): boolean {
    return stream.type === 'subtitle' && typeof stream.index === 'number' && Number.isInteger(stream.index) && stream.index >= 0;
}

/**
 * Picks the subtitle stream to burn.
 *
 * Priority is the default track, then a forced track, then the first burnable
 * track. Plex can burn image subtitles when they have a stream index, so codec
 * is not used to filter here.
 *
 * @param streams - Streams from one or more media parts
 */
export function pickSubtitleStream(streams: readonly PlexStream[]): PlexSubtitleSelection | null {
    const candidates = streams.filter(isBurnableSubtitleStream);
    if (candidates.length === 0) {
        return null;
    }

    const defaultStream = candidates.find((stream) => stream.default);
    if (defaultStream && defaultStream.index !== null) {
        return { stream: defaultStream, streamId: defaultStream.id, reason: 'default' };
    }

    const forcedStream = candidates.find((stream) => stream.forced);
    if (forcedStream && forcedStream.index !== null) {
        return { stream: forcedStream, streamId: forcedStream.id, reason: 'forced' };
    }

    const firstStream = candidates[0];
    if (!firstStream || firstStream.index === null) {
        return null;
    }
    return { stream: firstStream, streamId: firstStream.id, reason: 'first' };
}

/** Options for building a Plex HLS transcode URL. */
export interface BuildTranscodeUrlOptions {
    baseUrl: string;
    token: string | null;
    clientIdentifier: string;
    ratingKey: string;
    mediaIndex: number;
    partIndex: number;
    quality: PlexQuality;
    subtitleStreamId: number | null;
    offsetSeconds: number;
    sessionId: string;
}

/** Options for building a Plex transcode stop URL. */
export interface BuildStopSessionUrlOptions {
    baseUrl: string;
    token: string;
    sessionId: string;
}

/**
 * Builds the HLS transcode URL passed to FFmpeg.
 *
 * The token is a query parameter on purpose: FFmpeg does not receive the
 * client's headers. Callers must treat the returned URL as a secret.
 *
 * @param options - Transcode selection and session information
 */
export function buildTranscodeUrl(options: BuildTranscodeUrlOptions): string {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const token = options.token === null ? null : requireNonEmpty(options.token, 'token');
    const clientIdentifier = requireNonEmpty(options.clientIdentifier, 'clientIdentifier');
    const ratingKey = requireNonEmpty(options.ratingKey, 'ratingKey');
    const sessionId = requireNonEmpty(options.sessionId, 'sessionId');
    const quality = QUALITY_PRESETS[options.quality];

    if (!quality) {
        throw new Error(`Unknown Plex quality preset: ${String(options.quality)}`);
    }
    requireIndex(options.mediaIndex, 'mediaIndex');
    requireIndex(options.partIndex, 'partIndex');

    const subtitleStreamId = options.subtitleStreamId;
    if (subtitleStreamId !== null && subtitleStreamId !== undefined) {
        requireIndex(subtitleStreamId, 'subtitleStreamId');
    }

    const url = new URL(`${baseUrl}/video/:/transcode/universal/start.mkv`);
    const params = url.searchParams;
    params.set('hasMDE', '1');
    params.set('path', `/library/metadata/${ratingKey}`);
    params.set('mediaIndex', String(options.mediaIndex));
    params.set('partIndex', String(options.partIndex));
    params.set('protocol', 'http');
    params.set('fastSeek', '1');
    params.set('location', 'lan');
    params.set('directPlay', '0');
    params.set('directStream', '1');
    params.set('directStreamVideo', '1');
    params.set('X-Plex-Client-Profile-Extra', PLEX_TRANSCODE_PROFILE);
    params.set('X-Plex-Client-Profile-Name', 'Chrome');

    if (subtitleStreamId !== null && subtitleStreamId !== undefined) {
        params.set('subtitles', 'burn');
        params.set('subtitleStreamID', String(subtitleStreamId));
        params.set('subtitleSize', '100');
    } else {
        params.set('subtitles', 'none');
        params.set('subtitleStreamID', '0');
    }

    params.set('videoResolution', quality.videoResolution);
    params.set('videoBitrate', String(quality.bitrateKbps));
    params.set('maxVideoBitrate', String(quality.bitrateKbps));
    params.set('offset', formatOffset(options.offsetSeconds));
    params.set('session', sessionId);
    params.set('X-Plex-Client-Identifier', clientIdentifier);
    if (token) {
        params.set('X-Plex-Token', token);
    }

    return url.toString();
}

/**
 * Builds the Plex transcode decision URL from a start URL.
 *
 * Plex chooses the burned subtitle while making the decision. The start
 * request reuses that decision, so the app asks Plex to decide first with the
 * same session and stream selection.
 *
 * @param startUrl - URL returned by buildTranscodeUrl
 */
export function buildTranscodeDecisionUrl(startUrl: string): string {
    const url = new URL(startUrl);
    const suffix = '/start.mkv';
    if (!url.pathname.endsWith(suffix)) {
        throw new Error('Expected a Plex transcode start URL');
    }
    url.pathname = `${url.pathname.slice(0, -suffix.length)}/decision`;
    return url.toString();
}

/**
 * Builds the URL used to stop a Plex transcode session.
 *
 * @param options - Server, token, and session information
 */
export function buildStopSessionUrl(options: BuildStopSessionUrlOptions): string {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const token = requireNonEmpty(options.token, 'token');
    const sessionId = requireNonEmpty(options.sessionId, 'sessionId');
    const url = new URL(`${baseUrl}/video/:/transcode/universal/stop`);
    url.searchParams.set('session', sessionId);
    url.searchParams.set('X-Plex-Token', token);
    return url.toString();
}

/**
 * Masks the Plex token in a URL so the URL is safe to log.
 *
 * @param input - Absolute or relative URL
 */
export function redactPlexUrl(input: string): string {
    try {
        const url = new URL(input);
        let redacted = false;
        for (const key of Array.from(url.searchParams.keys())) {
            if (key.toLowerCase() === 'x-plex-token') {
                url.searchParams.set(key, REDACTED_TOKEN);
                redacted = true;
            }
        }
        return redacted ? url.toString() : input;
    } catch {
        return input.replace(/([?&](?:x-plex-token)=)[^&#]*/gi, `$1${REDACTED_TOKEN}`);
    }
}

/**
 * Creates a unique, URL-safe Plex transcode session identifier.
 */
export function createSessionId(): string {
    return `orbiscast-${randomUUID()}`;
}

function normalizeBaseUrl(baseUrl: string): string {
    const trimmed = requireNonEmpty(baseUrl, 'baseUrl').replace(/\/+$/, '');
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('Plex base URL is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Plex base URL must use http or https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Plex base URL must not contain credentials');
    }
    if (parsed.search || parsed.hash) {
        throw new Error('Plex base URL must not contain a query string or fragment');
    }
    return trimmed;
}

function requireNonEmpty(value: string, field: string): string {
    if (!value || !value.trim()) {
        throw new Error(`Plex ${field} is required`);
    }
    return value;
}

function requireIndex(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Plex ${field} must be a non-negative integer`);
    }
}

function formatOffset(offsetSeconds: number): string {
    if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
        throw new Error('Plex offsetSeconds must be a non-negative number');
    }
    return String(Math.round(offsetSeconds * 1000) / 1000);
}
