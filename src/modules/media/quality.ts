import type { MediaQuality } from '../../shared/types';

/** A video quality preset used by a provider HLS transcoder. */
export interface MediaQualityPreset {
    width: number;
    height: number;
    bitrateKbps: number;
    videoResolution: string;
}

/** Highest output height Discord clients render reliably. */
export const DISCORD_MAX_HEIGHT = 1080;

/** Available quality presets, keyed by the value stored in the database. */
export const MEDIA_QUALITY_PRESETS = {
    '720p-4': {
        width: 1280,
        height: 720,
        bitrateKbps: 4000,
        videoResolution: '1280x720',
    },
    '1080p-8': {
        width: 1920,
        height: 1080,
        bitrateKbps: 8000,
        videoResolution: '1920x1080',
    },
    '1080p-12': {
        width: 1920,
        height: 1080,
        bitrateKbps: 12000,
        videoResolution: '1920x1080',
    },
    '4k-20': {
        width: 3840,
        height: 2160,
        bitrateKbps: 20000,
        videoResolution: '3840x2160',
    },
} as const satisfies Record<MediaQuality, MediaQualityPreset>;

/**
 * Caps the provider's quality preset to a height Discord can render.
 *
 * @param quality - Queue item quality preset
 * @returns Output height for the Discord re-encode
 */
export function discordHeightForQuality(quality: MediaQuality): number {
    return Math.min(MEDIA_QUALITY_PRESETS[quality].height, DISCORD_MAX_HEIGHT);
}
