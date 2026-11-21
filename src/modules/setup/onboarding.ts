import {
    ChannelType,
    PermissionsBitField,
    type Client,
    type Guild,
    type GuildBasedChannel,
    type NewsChannel,
    type StageChannel,
    type TextChannel,
    type VoiceChannel,
} from 'discord.js';
import type { StreamerJoinDto } from '../../shared/types';
import { getLogger } from '../../utils/logger';
import {
    acceptGuildInvite,
    fetchStreamerGuildMember,
    getStreamerGuildIds,
    getStreamerInfo,
    isStreamerInGuild,
} from '../streaming';

const logger = getLogger();

const JOIN_WAIT_TIMEOUT_MS = 20_000;
const JOIN_POLL_INTERVAL_MS = 1_000;
const JOIN_WATCH_INTERVAL_MS = 15_000;
const JOIN_WATCH_LIFETIME_MS = 60 * 60_000;
const INVITE_MAX_AGE_SECONDS = 3_600;

type InvitableChannel = TextChannel | NewsChannel | VoiceChannel | StageChannel;

interface GuildAttempt {
    guildName: string;
    state: 'joining' | 'joined' | 'error';
    fallbackInviteUrl: string | null;
    error: string | null;
}

export interface StreamerOnboardingOptions {
    getClient: () => Client | null;
    notify: () => void;
}

/**
 * Adds the streaming account to every server the bot is in.
 *
 * The bot creates a one-time invite, the user client accepts it with the saved
 * token, and a short poll confirms the join. When Discord blocks the automatic
 * join (verification or onboarding), the WebUI gets a fallback invite and a
 * background watcher marks the guild as joined once the user accepts it.
 */
export class StreamerOnboarding {
    private attempts = new Map<string, GuildAttempt>();
    private inFlight = new Set<string>();
    private watchers = new Map<string, { interval: NodeJS.Timeout; timeout: NodeJS.Timeout }>();

    constructor(private readonly options: StreamerOnboardingOptions) {}

    /**
     * Starts an attempt for every guild the bot is currently in.
     */
    start(): void {
        const client = this.options.getClient();
        if (!client?.isReady()) {
            return;
        }

        for (const guild of client.guilds.cache.values()) {
            this.attempts.delete(guild.id);
            void this.ensureGuild(guild);
        }
    }

    /**
     * Handles the bot joining a guild.
     *
     * @param guild - Guild the bot joined
     */
    handleGuildCreate(guild: Guild): void {
        void this.ensureGuild(guild);
    }

    /**
     * Handles the streaming account joining a guild.
     *
     * @param guildId - Guild the streaming account joined
     */
    handleStreamerJoined(guildId: string): void {
        const client = this.options.getClient();
        const guild = client?.guilds.cache.get(guildId);
        if (!client?.isReady() || !guild) {
            return;
        }
        this.markJoined(guildId, guild.name);
    }

    /**
     * Handles the bot leaving a guild.
     *
     * @param guildId - Guild the bot left
     */
    handleGuildDelete(guildId: string): void {
        this.stopWatcher(guildId);
        this.attempts.delete(guildId);
        this.inFlight.delete(guildId);
        this.options.notify();
    }

    /**
     * Retries one guild, or every guild when none is provided.
     *
     * @param guildId - Guild to retry
     */
    retry(guildId?: string): void {
        const client = this.options.getClient();
        if (!client?.isReady()) {
            return;
        }

        if (guildId) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                return;
            }
            this.attempts.delete(guildId);
            void this.ensureGuild(guild);
            return;
        }

        this.start();
    }

    /**
     * Stops watchers and clears transient state. Called when the clients stop.
     */
    stop(): void {
        for (const guildId of [...this.watchers.keys()]) {
            this.stopWatcher(guildId);
        }
        this.attempts.clear();
        this.inFlight.clear();
    }

    /**
     * Returns the aggregate onboarding state for the WebUI.
     */
    getState(): StreamerJoinDto {
        const client = this.options.getClient();
        const botGuildIds = client?.isReady() === true ? [...client.guilds.cache.keys()] : [];
        const streamerReady = getStreamerInfo() !== null;

        if (!streamerReady) {
            return this.result('idle', null, null, null);
        }

        const streamerGuildIds = getStreamerGuildIds();
        const missing = botGuildIds.filter(id => !streamerGuildIds.includes(id));
        const current = this.currentAttempt();

        if (current) {
            return this.result('joining', current.id, current.attempt.guildName, current.attempt.fallbackInviteUrl);
        }

        if (botGuildIds.length > 0 && missing.length === 0) {
            return this.result('joined', null, null, null);
        }

        const failed = this.lastFailedAttempt();
        if (failed) {
            return {
                state: 'error',
                guildId: failed.id,
                guildName: failed.attempt.guildName,
                fallbackInviteUrl: failed.attempt.fallbackInviteUrl,
                error: failed.attempt.error,
            };
        }

        if (botGuildIds.length > 0) {
            return this.result('partial', null, null, null);
        }

        return this.result('idle', null, null, null);
    }

    private result(
        state: StreamerJoinDto['state'],
        guildId: string | null,
        guildName: string | null,
        fallbackInviteUrl: string | null,
        error: string | null = null
    ): StreamerJoinDto {
        return { state, guildId, guildName, fallbackInviteUrl, error };
    }

    private currentAttempt(): { id: string; attempt: GuildAttempt } | null {
        for (const [id, attempt] of this.attempts) {
            if (this.inFlight.has(id)) {
                return { id, attempt };
            }
        }
        return null;
    }

    private lastFailedAttempt(): { id: string; attempt: GuildAttempt } | null {
        let found: { id: string; attempt: GuildAttempt } | null = null;
        for (const [id, attempt] of this.attempts) {
            if (attempt.state === 'error') {
                found = { id, attempt };
            }
        }
        return found;
    }

    /**
     * Brings the streaming account into one guild.
     *
     * @param guild - Guild to prepare
     */
    private async ensureGuild(guild: Guild): Promise<void> {
        if (this.inFlight.has(guild.id) || !guild.client.isReady()) {
            return;
        }

        if (isStreamerInGuild(guild.id)) {
            this.markJoined(guild.id, guild.name);
            return;
        }

        this.inFlight.add(guild.id);
        this.attempts.set(guild.id, {
            guildName: guild.name,
            state: 'joining',
            fallbackInviteUrl: null,
            error: null,
        });
        this.options.notify();

        try {
            const info = getStreamerInfo();
            if (!info) {
                this.fail(
                    guild,
                    null,
                    'The streaming account is not connected. Save the streamer token and reconnect Discord.'
                );
                return;
            }

            // The guild cache can lag behind a fresh login. Confirm membership
            // before creating an invite the account cannot use.
            if (await fetchStreamerGuildMember(guild.id)) {
                this.markJoined(guild.id, guild.name);
                return;
            }

            const invite = await this.createInvite(guild);
            if (!invite) {
                this.fail(
                    guild,
                    null,
                    `The bot could not create an invite in ${guild.name}. Give it Create Instant Invite and View Channels in a text channel, then retry.`
                );
                return;
            }

            if (!this.options.getClient()?.guilds.cache.has(guild.id)) {
                return;
            }

            this.attempts.set(guild.id, {
                guildName: guild.name,
                state: 'joining',
                fallbackInviteUrl: invite.url,
                error: null,
            });
            this.options.notify();

            const accepted = await acceptGuildInvite(invite.code);
            if (!accepted.success) {
                this.fail(
                    guild,
                    invite.url,
                    `The streaming account could not accept the invite automatically: ${accepted.error ?? 'unknown error'}. Use the fallback invite while logged in as the streaming account.`
                );
                this.startWatcher(guild.id);
                return;
            }

            if (await this.waitForMember(guild.id)) {
                this.markJoined(guild.id, guild.name);
                return;
            }

            this.fail(
                guild,
                invite.url,
                'The streaming account accepted the invite, but Discord did not add it to the server. If the server requires verification, complete it as the streaming account, then use the fallback invite link. This page updates automatically.'
            );
            this.startWatcher(guild.id);
        } catch (error) {
            logger.error(`Unexpected error while adding the streaming account to ${guild.name}: ${error}`);
            this.fail(guild, null, 'OrbisCast hit an unexpected error while adding the streaming account.');
        } finally {
            this.inFlight.delete(guild.id);
            this.options.notify();
        }
    }

    /**
     * Creates a one-time invite the streaming account can accept.
     *
     * @param guild - Guild to invite the streaming account to
     */
    private async createInvite(
        guild: Guild
    ): Promise<{ code: string; url: string; channelId: string } | null> {
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me) {
            logger.error(`Could not resolve the bot member in ${guild.name}`);
            return null;
        }

        const candidates = new Set<InvitableChannel>();
        if (isInvitableChannel(guild.systemChannel)) {
            candidates.add(guild.systemChannel);
        }

        const channels = [...guild.channels.cache.values()]
            .filter(isInvitableChannel)
            .sort((a, b) => {
                const aIsText = a.type === ChannelType.GuildText || a.type === ChannelType.GuildAnnouncement;
                const bIsText = b.type === ChannelType.GuildText || b.type === ChannelType.GuildAnnouncement;
                return Number(bIsText) - Number(aIsText) || a.position - b.position;
            });

        for (const channel of channels) {
            candidates.add(channel);
        }

        for (const channel of candidates) {
            const permissions = channel.permissionsFor(me);
            if (
                !permissions?.has(PermissionsBitField.Flags.CreateInstantInvite) ||
                !permissions.has(PermissionsBitField.Flags.ViewChannel)
            ) {
                continue;
            }

            try {
                const invite = await channel.createInvite({
                    maxAge: INVITE_MAX_AGE_SECONDS,
                    maxUses: 1,
                    unique: true,
                    reason: 'OrbisCast streaming account onboarding',
                });
                logger.info(`Created a one-time onboarding invite in #${channel.name} for ${guild.name}`);
                return { code: invite.code, url: invite.url, channelId: channel.id };
            } catch (error) {
                logger.debug(`Could not create an invite in #${channel.name}: ${error}`);
            }
        }

        return null;
    }

    /**
     * Waits for the streaming account to appear in a guild.
     *
     * @param guildId - Guild ID to check
     */
    private async waitForMember(guildId: string): Promise<boolean> {
        const deadline = Date.now() + JOIN_WAIT_TIMEOUT_MS;

        while (Date.now() < deadline) {
            if (await fetchStreamerGuildMember(guildId)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, JOIN_POLL_INTERVAL_MS));
        }

        return false;
    }

    /**
     * Watches for a manually accepted fallback invite.
     *
     * @param guildId - Guild ID to watch
     */
    private startWatcher(guildId: string): void {
        if (this.watchers.has(guildId)) {
            return;
        }

        const interval = setInterval(() => {
            void (async () => {
                try {
                    if (!(await fetchStreamerGuildMember(guildId))) {
                        return;
                    }
                    const guild = this.options.getClient()?.guilds.cache.get(guildId);
                    this.markJoined(guildId, guild?.name ?? null);
                } catch (error) {
                    logger.debug(`Streamer join watcher error for guild ${guildId}: ${error}`);
                }
            })();
        }, JOIN_WATCH_INTERVAL_MS);
        interval.unref?.();

        const timeout = setTimeout(() => {
            this.stopWatcher(guildId);
        }, JOIN_WATCH_LIFETIME_MS);
        timeout.unref?.();

        this.watchers.set(guildId, { interval, timeout });
    }

    /**
     * Stops a background join watcher.
     *
     * @param guildId - Guild ID to stop watching
     */
    private stopWatcher(guildId: string): void {
        const watcher = this.watchers.get(guildId);
        if (!watcher) {
            return;
        }
        clearInterval(watcher.interval);
        clearTimeout(watcher.timeout);
        this.watchers.delete(guildId);
    }

    private markJoined(guildId: string, guildName: string | null): void {
        const client = this.options.getClient();
        if (!client?.isReady() || !client.guilds.cache.has(guildId)) {
            return;
        }
        this.stopWatcher(guildId);
        const existing = this.attempts.get(guildId);
        this.attempts.set(guildId, {
            guildName: guildName ?? existing?.guildName ?? guildId,
            state: 'joined',
            fallbackInviteUrl: null,
            error: null,
        });
        this.options.notify();
    }

    private fail(guild: Guild, fallbackInviteUrl: string | null, error: string): void {
        if (!this.options.getClient()?.guilds.cache.has(guild.id)) {
            return;
        }
        this.attempts.set(guild.id, {
            guildName: guild.name,
            state: 'error',
            fallbackInviteUrl,
            error,
        });
        logger.warn(`Streaming account onboarding for ${guild.name}: ${error}`);
    }
}

function isInvitableChannel(channel: GuildBasedChannel | null): channel is InvitableChannel {
    if (!channel) {
        return false;
    }

    return (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice
    );
}
