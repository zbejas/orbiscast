import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../database/client';
import { settings as settingsTable } from '../database/schema';
import { getLogger } from '../../utils/logger';
import { decryptSecret, encryptSecret, type KeyMaterial, maskSecret, encryptionKey } from '../../utils/crypto';
import type { MediaQuality, SettingsDto } from '../../shared/types';

const logger = getLogger();

export const QUALITY_VALUES = ['720p-4', '1080p-8', '1080p-12', '4k-20'] as const;
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const streamSchema = z.object({
    bitrateVideo: z.number().int().min(500).max(50_000).default(5000),
    bitrateVideoMax: z.number().int().min(500).max(50_000).default(7500),
    minimizeLatency: z.boolean().default(true),
    disableTranscode: z.boolean().default(false),
    defaultStreamTimeout: z.number().int().min(1).max(720).default(10),
});

const plexSchema = z.object({
    serverUrl: z.string().default('http://127.0.0.1:32400'),
    tokenEncrypted: z.string().default(''),
    tokenLast4: z.string().default(''),
    clientIdentifier: z.string().default(''),
    channelName: z.string().min(1).max(80).default('Plex'),
    idleMinutes: z.number().int().min(1).max(120).default(5),
    emptyGraceSeconds: z.number().int().min(0).max(600).default(30),
    defaultQuality: z.enum(QUALITY_VALUES).default('1080p-8'),
});

const discordSchema = z.object({
    botTokenEncrypted: z.string().default(''),
    botTokenLast4: z.string().default(''),
    userTokenEncrypted: z.string().default(''),
    userTokenLast4: z.string().default(''),
    baseUrl: z.string().default(''),
    trustedOrigins: z.array(z.string()).default([]),
});

const authSchema = z.object({
    enabled: z.boolean().default(false),
});

const playbackSchema = z.object({
    /** Queue the next episode when the current one ends. */
    autoplayNextEpisode: z.boolean().default(false),
    /** Skip a Plex intro marker when playback reaches it. */
    autoSkipIntro: z.boolean().default(false),
});

const uiSchema = z.object({
    timezone: z.string().default(systemTimezone),
    logLevel: z.enum(LOG_LEVELS).default('info'),
    publicUrl: z.string().default(''),
    trustedOrigins: z.array(z.string()).default([]),
    /** Media source ids in the WebUI tab order. Unknown ids are ignored. */
    mediaSourceOrder: z.array(z.number().int().positive()).max(500).default([]),
    /** Most recently selected playback channels, newest first. */
    recentVoiceChannels: z
        .array(
            z.object({
                guildId: z.string().min(1).max(64),
                guildName: z.string().max(200).default(''),
                channelId: z.string().min(1).max(64),
                channelName: z.string().max(200).default(''),
            })
        )
        .max(3)
        .default([]),
});

const metaSchema = z.object({
    envImported: z.boolean().default(false),
});

export type StreamSettings = z.infer<typeof streamSchema>;
export type StoredPlexSettings = z.infer<typeof plexSchema>;
export type StoredDiscordSettings = z.infer<typeof discordSchema>;
export type AuthSettings = z.infer<typeof authSchema>;
export type PlaybackSettings = z.infer<typeof playbackSchema>;
export type UiSettings = z.infer<typeof uiSchema>;
export type MetaSettings = z.infer<typeof metaSchema>;

export interface StoredSettings {
    stream: StreamSettings;
    playback: PlaybackSettings;
    plex: StoredPlexSettings;
    discord: StoredDiscordSettings;
    auth: AuthSettings;
    ui: UiSettings;
    meta: MetaSettings;
}

/** Legacy Plex connection shape used by the one-time media-source migration. */
export interface LegacyPlexConfig {
    serverUrl: string;
    tokenSet: boolean;
    tokenLast4: string | null;
    channelName: string;
    idleMinutes: number;
    emptyGraceSeconds: number;
    defaultQuality: MediaQuality;
}

export interface SettingsUpdateInput {
    stream?: Partial<StreamSettings>;
    playback?: Partial<PlaybackSettings>;
    plex?: Partial<{
        serverUrl: string;
        token: string;
        channelName: string;
        idleMinutes: number;
        emptyGraceSeconds: number;
        defaultQuality: MediaQuality;
    }>;
    discord?: Partial<{
        botToken: string;
        userToken: string;
        baseUrl: string;
        trustedOrigins: string[];
    }>;
    auth?: Partial<AuthSettings>;
    ui?: Partial<UiSettings>;
}

const playbackUpdateSchema = z
    .object({
        autoplayNextEpisode: z.boolean().optional(),
        autoSkipIntro: z.boolean().optional(),
    })
    .strict();

const uiUpdateSchema = z
    .object({
        timezone: z.string().optional(),
        logLevel: z.enum(LOG_LEVELS).optional(),
        publicUrl: z.string().optional(),
        trustedOrigins: z.array(z.string()).optional(),
        mediaSourceOrder: z.array(z.number().int().positive()).max(500).optional(),
    })
    .strict();

const updateSchema = z
    .object({
        stream: streamSchema.partial().optional(),
        playback: playbackUpdateSchema.optional(),
        plex: z
            .object({
                serverUrl: z.string().min(1).optional(),
                token: z.string().optional(),
                channelName: z.string().min(1).max(80).optional(),
                idleMinutes: z.number().int().min(1).max(120).optional(),
                emptyGraceSeconds: z.number().int().min(0).max(600).optional(),
                defaultQuality: z.enum(QUALITY_VALUES).optional(),
            })
            .strict()
            .optional(),
        discord: z
            .object({
                botToken: z.string().optional(),
                userToken: z.string().optional(),
                baseUrl: z.string().optional(),
                trustedOrigins: z.array(z.string()).optional(),
            })
            .strict()
            .optional(),
        auth: authSchema.partial().optional(),
        ui: uiUpdateSchema.optional(),
    })
    .strict();

/**
 * Reads and writes the typed settings stored in SQLite.
 *
 * Secrets are encrypted before they reach the database and are only decrypted
 * on demand inside the service.
 */
export class SettingsService {
    private cache: StoredSettings;

    constructor(
        private readonly db: Db,
        private readonly keys: KeyMaterial,
        private readonly events?: EventEmitter
    ) {
        this.cache = this.load();
    }

    /**
     * Writes any missing default sections so the database is self-describing.
     */
    init(): void {
        const now = Date.now();
        const rows = this.readRows();
        const defaults: Record<string, unknown> = {
            stream: streamSchema.parse({}),
            playback: playbackSchema.parse({}),
            plex: { ...plexSchema.parse({}), clientIdentifier: randomUUID() },
            discord: discordSchema.parse({}),
            auth: authSchema.parse({}),
            ui: uiSchema.parse({}),
            meta: metaSchema.parse({}),
        };

        for (const [key, value] of Object.entries(defaults)) {
            if (!rows.has(key)) {
                this.db
                    .insert(settingsTable)
                    .values({ key, value: JSON.stringify(value), updatedAt: now })
                    .run();
            }
        }

        const plex = this.readSection('plex', plexSchema);
        if (!plex.clientIdentifier) {
            this.writeSection('plex', { ...plex, clientIdentifier: randomUUID() }, now);
        }

        this.cache = this.load();
    }

    /**
     * Returns the public settings DTO. Never includes secrets.
     */
    getPublic(): SettingsDto {
        return {
            timezone: this.cache.ui.timezone,
            logLevel: this.cache.ui.logLevel,
            publicUrl: this.cache.ui.publicUrl,
            trustedOrigins: this.cache.ui.trustedOrigins,
            recentVoiceChannels: this.cache.ui.recentVoiceChannels,
            stream: { ...this.cache.stream },
            playback: { ...this.cache.playback },
            auth: { enabled: this.cache.auth.enabled },
        };
    }

    /**
     * Returns the legacy Plex connection DTO used for migration.
     */
    getPlexConfig(): LegacyPlexConfig {
        return {
            serverUrl: this.cache.plex.serverUrl,
            tokenSet: Boolean(this.cache.plex.tokenEncrypted),
            tokenLast4: this.cache.plex.tokenLast4 || null,
            channelName: this.cache.plex.channelName,
            idleMinutes: this.cache.plex.idleMinutes,
            emptyGraceSeconds: this.cache.plex.emptyGraceSeconds,
            defaultQuality: this.cache.plex.defaultQuality,
        };
    }

    /**
     * Returns the stream settings used by the playback engine.
     */
    getStream(): StreamSettings {
        return { ...this.cache.stream };
    }

    /**
     * Returns the playback behavior settings used by the media service.
     */
    getPlayback(): PlaybackSettings {
        return { ...this.cache.playback };
    }

    /**
     * Returns the raw timezone and log level settings.
     */
    getUi(): UiSettings {
        return { ...this.cache.ui };
    }

    /**
     * Persists the WebUI media source tab order.
     *
     * @param ids - Source ids in display order
     */
    setMediaSourceOrder(ids: number[]): void {
        const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
        const now = Date.now();
        this.writeSection('ui', { ...this.cache.ui, mediaSourceOrder: unique }, now);
        this.cache = this.load();
        this.events?.emit('settings', this.getPublic());
    }

    /**
     * Persists the most recently selected playback channels, newest first.
     * Duplicate channels are removed and the list is capped at three.
     *
     * @param entries - Recent guild and channel pairs
     * @returns The stored recent channel list
     */
    setRecentVoiceChannels(
        entries: UiSettings['recentVoiceChannels']
    ): UiSettings['recentVoiceChannels'] {
        const seen = new Set<string>();
        const unique = entries
            .filter(entry => {
                const key = `${entry.guildId}:${entry.channelId}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 3);
        const now = Date.now();
        this.writeSection('ui', { ...this.cache.ui, recentVoiceChannels: unique }, now);
        this.cache = this.load();
        this.events?.emit('settings', this.getPublic());
        return unique;
    }

    /**
     * Returns the decrypted Plex token, or null when none is configured.
     */
    getPlexToken(): string | null {
        if (!this.cache.plex.tokenEncrypted) {
            return null;
        }
        return decryptSecret(this.cache.plex.tokenEncrypted, encryptionKey(this.keys));
    }

    /**
     * Encrypts a provider secret for storage in a media source row.
     *
     * @param value - Plaintext token
     * @returns Ciphertext and the last four characters
     */
    encodeSecret(value: string): { encrypted: string; last4: string } {
        return {
            encrypted: encryptSecret(value, encryptionKey(this.keys)),
            last4: value.slice(-4),
        };
    }

    /**
     * Decrypts a provider secret stored in a media source row.
     *
     * @param encrypted - Ciphertext from the database
     * @returns Plaintext token, or null when the value is empty
     */
    decodeSecret(encrypted: string): string | null {
        if (!encrypted) {
            return null;
        }
        return decryptSecret(encrypted, encryptionKey(this.keys));
    }

    /**
     * Returns the decrypted Discord tokens. Missing tokens are empty strings.
     */
    getDiscordTokens(): { botToken: string; userToken: string } {
        const key = encryptionKey(this.keys);
        return {
            botToken: this.cache.discord.botTokenEncrypted
                ? decryptSecret(this.cache.discord.botTokenEncrypted, key)
                : '',
            userToken: this.cache.discord.userTokenEncrypted
                ? decryptSecret(this.cache.discord.userTokenEncrypted, key)
                : '',
        };
    }

    /**
     * Returns the non-secret Discord settings.
     */
    getDiscord(): StoredDiscordSettings {
        return { ...this.cache.discord };
    }

    /**
     * Returns the decrypted auth secret used by Better Auth.
     */
    getAuthSecret(): string {
        return this.keys.authSecret;
    }

    /**
     * Returns true when the operator enabled the login screen.
     */
    isAuthEnabled(): boolean {
        return this.cache.auth.enabled;
    }

    /**
     * Returns true when the one-time .env import already ran.
     */
    isEnvImported(): boolean {
        return this.cache.meta.envImported;
    }

    /**
     * Returns the Plex client identifier used for transcode sessions.
     */
    getPlexClientIdentifier(): string {
        return this.cache.plex.clientIdentifier;
    }

    /**
     * Applies a validated partial update. Token fields encrypt new values; an
     * empty string clears a token, while an omitted field keeps the existing one.
     *
     * @param input - Partial settings update
     * @returns The updated public settings
     */
    update(input: SettingsUpdateInput): SettingsDto {
        const parsed = updateSchema.parse(input);
        const now = Date.now();
        const key = encryptionKey(this.keys);

        if (parsed.stream) {
            this.writeSection('stream', { ...this.cache.stream, ...parsed.stream }, now);
        }

        if (parsed.playback) {
            this.writeSection('playback', { ...this.cache.playback, ...parsed.playback }, now);
        }

        if (parsed.plex) {
            const next = { ...this.cache.plex };
            if (parsed.plex.serverUrl !== undefined) next.serverUrl = parsed.plex.serverUrl;
            if (parsed.plex.channelName !== undefined) next.channelName = parsed.plex.channelName;
            if (parsed.plex.idleMinutes !== undefined) next.idleMinutes = parsed.plex.idleMinutes;
            if (parsed.plex.emptyGraceSeconds !== undefined) next.emptyGraceSeconds = parsed.plex.emptyGraceSeconds;
            if (parsed.plex.defaultQuality !== undefined) next.defaultQuality = parsed.plex.defaultQuality;
            if (parsed.plex.token !== undefined) {
                if (parsed.plex.token === '') {
                    next.tokenEncrypted = '';
                    next.tokenLast4 = '';
                } else {
                    next.tokenEncrypted = encryptSecret(parsed.plex.token, key);
                    next.tokenLast4 = parsed.plex.token.slice(-4);
                }
            }
            this.writeSection('plex', next, now);
        }

        if (parsed.discord) {
            const next = { ...this.cache.discord };
            if (parsed.discord.baseUrl !== undefined) next.baseUrl = parsed.discord.baseUrl;
            if (parsed.discord.trustedOrigins !== undefined) next.trustedOrigins = parsed.discord.trustedOrigins;
            if (parsed.discord.botToken !== undefined) {
                if (parsed.discord.botToken === '') {
                    next.botTokenEncrypted = '';
                    next.botTokenLast4 = '';
                } else {
                    next.botTokenEncrypted = encryptSecret(parsed.discord.botToken, key);
                    next.botTokenLast4 = parsed.discord.botToken.slice(-4);
                }
            }
            if (parsed.discord.userToken !== undefined) {
                if (parsed.discord.userToken === '') {
                    next.userTokenEncrypted = '';
                    next.userTokenLast4 = '';
                } else {
                    next.userTokenEncrypted = encryptSecret(parsed.discord.userToken, key);
                    next.userTokenLast4 = parsed.discord.userToken.slice(-4);
                }
            }
            this.writeSection('discord', next, now);
        }

        if (parsed.auth) {
            this.writeSection('auth', { ...this.cache.auth, ...parsed.auth }, now);
        }

        if (parsed.ui) {
            this.writeSection('ui', { ...this.cache.ui, ...parsed.ui }, now);
        }

        this.cache = this.load();
        const publicSettings = this.getPublic();
        this.events?.emit('settings', publicSettings);
        return publicSettings;
    }

    /**
     * Marks the one-time .env import as complete.
     */
    markEnvImported(): void {
        this.writeSection('meta', { ...this.cache.meta, envImported: true }, Date.now());
        this.cache = this.load();
    }

    private load(): StoredSettings {
        const rows = this.readRows();
        return {
            stream: this.parseSection(rows, 'stream', streamSchema),
            playback: this.parseSection(rows, 'playback', playbackSchema),
            plex: this.parseSection(rows, 'plex', plexSchema),
            discord: this.parseSection(rows, 'discord', discordSchema),
            auth: this.parseSection(rows, 'auth', authSchema),
            ui: this.parseSection(rows, 'ui', uiSchema),
            meta: this.parseSection(rows, 'meta', metaSchema),
        };
    }

    private readRows(): Map<string, string> {
        const rows = this.db.select().from(settingsTable).all();
        return new Map(rows.map(row => [row.key, row.value]));
    }

    private parseSection<T extends z.ZodType>(rows: Map<string, string>, key: string, schema: T): z.infer<T> {
        const raw = rows.get(key);
        if (!raw) {
            return schema.parse({});
        }
        try {
            return schema.parse(JSON.parse(raw));
        } catch (error) {
            logger.error(`Invalid settings section "${key}", using defaults: ${error}`);
            return schema.parse({});
        }
    }

    private readSection<T extends z.ZodType>(key: string, schema: T): z.infer<T> {
        return this.parseSection(this.readRows(), key, schema);
    }

    private writeSection(key: string, value: unknown, now: number): void {
        this.db
            .insert(settingsTable)
            .values({ key, value: JSON.stringify(value), updatedAt: now })
            .onConflictDoUpdate({
                target: settingsTable.key,
                set: { value: JSON.stringify(value), updatedAt: now },
            })
            .run();
    }
}
