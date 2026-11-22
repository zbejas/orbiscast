import type { MediaLibraryType } from '../../shared/types';

/** Raw Jellyfin item fields used by the client. */
export interface JellyfinRawItem {
    Id?: string;
    Name?: string;
    Type?: string;
    ParentId?: string;
    SeriesId?: string;
    SeasonId?: string;
    SeriesName?: string;
    SeasonName?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    ProductionYear?: number;
    RunTimeTicks?: number;
    Overview?: string;
    CollectionType?: string;
    ImageTags?: Record<string, string>;
    MediaSources?: JellyfinRawMediaSource[];
    MediaStreams?: JellyfinRawStream[];
    UserData?: { Played?: boolean };
}

/** Raw Jellyfin media source. */
export interface JellyfinRawMediaSource {
    Id?: string;
    Name?: string;
    Container?: string;
    RunTimeTicks?: number;
    MediaStreams?: JellyfinRawStream[];
}

/** Raw Jellyfin stream. */
export interface JellyfinRawStream {
    Index?: number;
    Type?: string;
    Codec?: string;
    Language?: string;
    DisplayTitle?: string;
    Title?: string;
    IsDefault?: boolean;
    IsForced?: boolean;
    IsExternal?: boolean;
    IsTextSubtitleStream?: boolean;
}

/** Raw Jellyfin list response. */
export interface JellyfinRawList {
    Items?: JellyfinRawItem[];
    TotalRecordCount?: number;
}

/** Raw Jellyfin server information. */
export interface JellyfinRawServerInfo {
    ServerName?: string;
    Version?: string;
    Id?: string;
}

/** Raw Jellyfin user. */
export interface JellyfinRawUser {
    Id?: string;
    Name?: string;
    Policy?: { IsAdministrator?: boolean };
}

/** Normalized Jellyfin library. */
export interface JellyfinLibrary {
    id: string;
    title: string;
    type: MediaLibraryType;
}
