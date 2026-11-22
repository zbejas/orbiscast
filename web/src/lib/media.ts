import type { MediaLibraryDto, MediaQuality } from '@shared/types';

/** Quality presets shown in source, queue, and item controls. */
export const QUALITY_OPTIONS: Array<{ value: MediaQuality; label: string }> = [
    { value: '720p-4', label: '720p · 4 Mbps' },
    { value: '1080p-8', label: '1080p · 8 Mbps' },
    { value: '1080p-12', label: '1080p · 12 Mbps' },
    { value: '4k-20', label: '4K · 20 Mbps' },
];

export function qualityLabel(quality: MediaQuality): string {
    return QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? quality;
}

/** Movie and TV libraries can be browsed; music and photo libraries cannot. */
export function isPlayableLibrary(library: MediaLibraryDto): boolean {
    return library.type === 'movie' || library.type === 'show';
}

export function libraryTypeLabel(type: string): string {
    switch (type) {
        case 'movie':
            return 'Movies';
        case 'show':
            return 'TV shows';
        case 'artist':
            return 'Music';
        case 'photo':
            return 'Photos';
        default:
            return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown';
    }
}
