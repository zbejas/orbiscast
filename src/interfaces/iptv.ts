/**
 * Represents an IPTV channel entry
 */
export interface ChannelEntry {
    xui_id: number;
    tvg_id?: string;
    tvg_name?: string;
    tvg_logo?: string;
    group_title?: string;
    url: string;
    created_at?: string;
    country?: string;
}

/**
 * Represents a programme entry for TV guide information
 */
export interface ProgrammeEntry {
    start: string;
    stop: string;
    start_timestamp: number;
    stop_timestamp: number;
    channel: string;
    title: string;
    description: string;
    category: string;
    created_at: string;
    subtitle?: string;
    episode_num?: string;
    season?: number;
    episode?: number;
    icon?: string;
    image?: string;
    date?: string;
    previously_shown?: boolean;
}
