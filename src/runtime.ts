import type Database from 'better-sqlite3';
import type { EventEmitter } from 'node:events';
import type { Db } from './modules/database/client';
import type { KeyMaterial } from './utils/crypto';
import type { SettingsService } from './modules/settings';
import type { IptvService } from './modules/iptv/service';
import type { PlaybackEngine } from './modules/playback/engine';
import type { DiscordService } from './modules/discord/service';

export interface Runtime {
    dataDir: string;
    sqlite: Database.Database;
    db: Db;
    keys: KeyMaterial;
    settings: SettingsService;
    events: EventEmitter;
    iptv: IptvService;
    playback: PlaybackEngine;
    discord: DiscordService;
}

let current: Runtime | null = null;

/**
 * Stores the process-wide runtime after boot.
 *
 * @param runtime - Fully constructed runtime
 */
export function setRuntime(runtime: Runtime): void {
    current = runtime;
}

/**
 * Returns the process-wide runtime.
 *
 * @returns The active runtime
 * @throws Error when called before boot
 */
export function getRuntime(): Runtime {
    if (!current) {
        throw new Error('Runtime has not been initialized');
    }
    return current;
}
