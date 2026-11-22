import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    GuildMember,
    MessageFlags,
    Partials,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    type AutocompleteInteraction,
    type Interaction,
} from 'discord.js';
import { EventEmitter } from 'node:events';
import type { Db } from '../database/client';
import { channelRef, findVisibleChannelByRef, getGuildSettings, listGuildSettings, listVisibleChannels, queryProgrammes } from '../database/repo';
import type { SettingsService } from '../settings';
import type { PlaybackEngine } from '../playback/engine';
import type { IptvService } from '../iptv/service';
import { getLogger } from '../../utils/logger';
import {
    getStreamerGuildIds,
    getStreamerStatus,
    initializeStreamer,
    onStreamerGuildJoin,
    reconnectStreamer,
    shutdownStreamer,
} from '../streaming';
import { ProgrammeEmbedProcessor } from '../embeds/programme';
import { formatChannelLabel } from '../../utils/channels';
import { StreamerOnboarding } from '../setup/onboarding';
import { buildBotInviteUrl } from '../setup/invite';
import type { ConnectionState, DiscordStatusDto, GuildDto } from '../../shared/types';
import type { ProgrammeEntry } from '../../interfaces/iptv';

const logger = getLogger();
const COMMANDS_PER_PAGE = 20;

type ChannelPageItem =
    | { kind: 'media'; sourceId: number; label: string }
    | { kind: 'iptv'; id: number; label: string };

export interface DiscordValidationResult {
    ok: boolean;
    botTag?: string;
    streamerTag?: string;
    error?: string;
}

/**
 * Owns the bot client and all Discord command handling. The self-bot voice
 * connection lives in the streaming module and is driven by PlaybackEngine.
 */
export class DiscordService {
    private client: Client | null = null;
    private botState: ConnectionState = 'offline';
    private streamerState: ConnectionState = 'offline';
    private botTag: string | null = null;
    private streamerTag: string | null = null;
    private error: string | null = null;
    private reconnectLock: Promise<void> | null = null;
    private applicationId: string | null = null;
    private streamerJoinUnsubscribe: (() => void) | null = null;
    private readonly onboarding: StreamerOnboarding;

    constructor(
        private readonly db: Db,
        private readonly settings: SettingsService,
        private readonly playback: PlaybackEngine,
        private readonly iptv: IptvService,
        private readonly events: EventEmitter
    ) {
        this.onboarding = new StreamerOnboarding({
            getClient: () => this.client,
            notify: () => this.emit(),
        });
    }

    /**
     * Starts both Discord clients when tokens are configured.
     */
    async start(): Promise<void> {
        const { botToken, userToken } = this.settings.getDiscordTokens();
        if (!botToken || !userToken) {
            this.botState = 'offline';
            this.streamerState = 'offline';
            this.error = 'Discord tokens are not configured.';
            this.emit();
            return;
        }

        this.botState = 'connecting';
        this.streamerState = 'connecting';
        this.error = null;
        this.streamerJoinUnsubscribe ??= onStreamerGuildJoin(guildId =>
            this.onboarding.handleStreamerJoined(guildId)
        );
        this.emit();

        await Promise.allSettled([this.startStreamer(userToken), this.startBot(botToken)]);

        if (this.bothOnline()) {
            this.onboarding.start();
        }
    }

    private bothOnline(): boolean {
        return this.botState === 'online' && this.streamerState === 'online';
    }

    /**
     * Recreates both clients after a token change.
     */
    async reconnect(): Promise<DiscordValidationResult> {
        if (this.reconnectLock) {
            await this.reconnectLock;
            return { ok: this.botState === 'online', error: this.error ?? undefined };
        }

        this.reconnectLock = (async () => {
            await this.stop();
            await this.start();
        })();

        try {
            await this.reconnectLock;
            return {
                ok: this.botState === 'online' && this.streamerState === 'online',
                botTag: this.botTag ?? undefined,
                streamerTag: this.streamerTag ?? undefined,
                error: this.error ?? undefined,
            };
        } finally {
            this.reconnectLock = null;
        }
    }

    /**
     * Stops both clients. The self-bot is destroyed, never logged out.
     */
    async stop(): Promise<void> {
        this.streamerJoinUnsubscribe?.();
        this.streamerJoinUnsubscribe = null;
        this.onboarding.stop();
        try {
            this.client?.destroy();
        } catch (error) {
            logger.warn(`Error destroying bot client: ${error}`);
        }
        this.client = null;
        this.botState = 'offline';
        this.botTag = null;
        await shutdownStreamer();
        this.streamerState = 'offline';
        this.streamerTag = null;
        this.emit();
    }

    /**
     * Validates a bot token and a user token without saving them.
     *
     * @param botToken - Discord bot token
     * @param userToken - Discord user token
     */
    async validateTokens(botToken: string, userToken: string): Promise<DiscordValidationResult> {
        try {
            const [bot, user] = await Promise.all([
                fetchDiscordIdentity(botToken, true),
                fetchDiscordIdentity(userToken, false),
            ]);
            this.applicationId = bot.id;
            return { ok: true, botTag: bot.tag, streamerTag: user.tag };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Token validation failed' };
        }
    }

    /**
     * Returns the status DTO used by the WebUI.
     */
    getStatus(): DiscordStatusDto {
        const stored = new Map(listGuildSettings(this.db).map(row => [row.guildId, row]));
        const guilds: GuildDto[] =
            this.client?.isReady() === true
                ? this.client.guilds.cache.map(guild => {
                      const settings = stored.get(guild.id);
                      return {
                          id: guild.id,
                          name: guild.name,
                          iconUrl: guild.iconURL({ size: 64 }),
                          allowedRoleIds: settings?.allowedRoleIds ?? [],
                          roles: guild.roles.cache
                              .filter(role => role.id !== guild.id)
                              .map(role => ({ id: role.id, name: role.name, color: role.color }))
                              .sort((a, b) => a.name.localeCompare(b.name)),
                          voiceChannels: guild.channels.cache
                              .filter(channel => channel.isVoiceBased())
                              .map(channel => ({ id: channel.id, name: channel.name, guildId: guild.id }))
                              .sort((a, b) => a.name.localeCompare(b.name)),
                      };
                  })
                : [];

        return {
            bot: this.botState,
            streamer: this.streamerState,
            botTag: this.botTag,
            streamerTag: this.streamerTag,
            error: this.error,
            guilds,
            botInviteUrl: this.getBotInviteUrl(),
            streamerGuildIds: getStreamerGuildIds(),
            streamerJoin: this.onboarding.getState(),
        };
    }

    /**
     * Returns the OAuth2 invite URL for the bot.
     */
    getBotInviteUrl(): string | null {
        const { botToken } = this.settings.getDiscordTokens();
        if (!botToken) {
            return null;
        }
        return buildBotInviteUrl(this.client?.user?.id ?? this.applicationId);
    }

    /**
     * Retries adding the streaming account to one guild or all of them.
     *
     * @param guildId - Guild to retry
     */
    retryStreamerJoin(guildId?: string): void {
        this.onboarding.retry(guildId);
    }

    /**
     * Returns the cached Discord client, if online.
     */
    getClient(): Client | null {
        return this.client;
    }

    private async startBot(token: string): Promise<void> {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
            partials: [Partials.Channel],
        });
        this.client = client;

        client.once('clientReady', async () => {
            this.botState = 'online';
            this.botTag = client.user?.tag ?? null;
            this.applicationId = client.user?.id ?? this.applicationId;
            this.error = null;
            logger.info(`Discord bot connected as ${this.botTag}`);
            this.emit();

            for (const guild of client.guilds.cache.values()) {
                await this.registerCommands(guild.id).catch(error =>
                    logger.error(`Failed to register commands in ${guild.name}: ${error}`)
                );
            }
        });

        client.on('guildCreate', guild => {
            void this.registerCommands(guild.id).catch(error =>
                logger.error(`Failed to register commands in ${guild.name}: ${error}`)
            );
            this.onboarding.handleGuildCreate(guild);
        });

        client.on('guildDelete', guild => {
            this.onboarding.handleGuildDelete(guild.id);
        });

        client.on('interactionCreate', interaction => {
            void this.handleInteraction(interaction).catch(error => logger.error(`Interaction error: ${error}`));
        });

        client.on('error', error => {
            logger.error(`Discord client error: ${error}`);
            this.error = error.message;
            this.botState = 'error';
            this.emit();
        });

        try {
            await client.login(token);
        } catch (error) {
            this.botState = 'error';
            this.error = error instanceof Error ? error.message : 'Bot login failed';
            logger.error(`Discord bot login failed: ${this.error}`);
            this.emit();
        }
    }

    private async startStreamer(token: string): Promise<void> {
        const ok = await initializeStreamer(token);
        const status = getStreamerStatus();
        this.streamerState = ok ? 'online' : 'error';
        this.streamerTag = status.tag;
        if (!ok) {
            this.error = 'Streamer login failed. Check the user token.';
        }
        this.emit();
    }

    private async registerCommands(guildId: string): Promise<void> {
        if (!this.client?.user) return;
        const { botToken } = this.settings.getDiscordTokens();
        if (!botToken) return;

        const commands = [
            new SlashCommandBuilder()
                .setName('stream')
                .setDescription('Stream a channel')
                .addStringOption(option =>
                    option
                        .setName('channel')
                        .setDescription('IPTV channel or an on-demand media channel')
                        .setAutocomplete(true)
                        .setRequired(true)
                ),
            new SlashCommandBuilder().setName('stop').setDescription('Stop the current stream'),
            new SlashCommandBuilder()
                .setName('channels')
                .setDescription('List available channels')
                .addStringOption(option => option.setName('page').setDescription('Page number or "all"')),
            new SlashCommandBuilder()
                .setName('programme')
                .setDescription('Show the programme guide for a channel')
                .addStringOption(option =>
                    option.setName('channel').setDescription('Channel name').setAutocomplete(true)
                ),
            new SlashCommandBuilder()
                .setName('refresh')
                .setDescription('Refresh IPTV data')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('What to refresh')
                        .setRequired(true)
                        .addChoices(
                            { name: 'all', value: 'all' },
                            { name: 'channels', value: 'channels' },
                            { name: 'programme', value: 'programme' }
                        )
                ),
        ].map(command => command.toJSON());

        const rest = new REST({ version: '10' }).setToken(botToken);
        await rest.put(Routes.applicationGuildCommands(this.client.user.id, guildId), { body: commands });
    }

    private async handleInteraction(interaction: Interaction): Promise<void> {
        if (interaction.isAutocomplete()) {
            await this.handleAutocomplete(interaction);
            return;
        }
        if (interaction.isButton()) {
            await this.handleButton(interaction);
            return;
        }
        if (!interaction.isChatInputCommand()) {
            return;
        }

        if (!this.canUse(interaction)) {
            await interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        switch (interaction.commandName) {
            case 'stream':
                await this.handleStream(interaction);
                break;
            case 'stop':
                await this.handleStop(interaction);
                break;
            case 'channels':
                await this.handleChannels(interaction);
                break;
            case 'programme':
                await this.handleProgramme(interaction);
                break;
            case 'refresh':
                await this.handleRefresh(interaction);
                break;
            default:
                break;
        }
    }

    private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
        if (!this.canUse(interaction)) {
            await interaction.respond([]);
            return;
        }

        const focused = interaction.options.getFocused().toLowerCase();
        const mediaChannels = this.playback.getMediaChannels();
        const rows = listVisibleChannels(this.db, 1000);
        const byName = rows.filter(channel => channel.name.toLowerCase().includes(focused));
        const byGroup = rows.filter(
            channel =>
                !channel.name.toLowerCase().includes(focused) &&
                Boolean(channel.groupTitle?.toLowerCase().includes(focused)) &&
                focused.length > 0
        );
        const choices = [...byName, ...byGroup].slice(0, 25).map(channel => ({
            name: formatChannelLabel(channel.name, channel.groupTitle),
            value: channelRef(channel.id),
        }));

        const mediaChoices = mediaChannels
            .filter(channel => channel.name.toLowerCase().includes(focused))
            .map(channel => ({
                name: channel.name.slice(0, 100),
                value: channel.name.slice(0, 100),
            }));
        choices.unshift(...mediaChoices);

        await interaction.respond(choices.slice(0, 25));
    }

    private async handleStream(interaction: ChatInputCommandInteraction): Promise<void> {
        const channelRefValue = interaction.options.getString('channel', true);
        const member = interaction.member as GuildMember | null;
        const voiceChannel = member?.voice.channel;
        if (!voiceChannel || !interaction.guildId) {
            await interaction.reply({
                content: 'Join a voice channel first.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const mediaChannel = this.playback
            .getMediaChannels()
            .find(channel => channel.name.toLowerCase() === channelRefValue.toLowerCase());

        if (mediaChannel?.sourceId != null) {
            const result = await this.playback.startPlaceholder(mediaChannel.sourceId, {
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
            });
            await interaction.editReply(result.message);
            return;
        }

        const channel = findVisibleChannelByRef(this.db, channelRefValue);
        if (!channel) {
            await interaction.editReply('Channel not found or not visible.');
            return;
        }

        const result = await this.playback.playIptv(
            {
                id: channel.id,
                name: channel.name,
                tvgId: channel.tvgId,
                logo: channel.logo,
                group: channel.groupTitle,
                url: channel.streamUrl,
            },
            { guildId: interaction.guildId, voiceChannelId: voiceChannel.id }
        );
        await interaction.editReply(result.message);
    }

    private async handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
        const result = await this.playback.stop();
        await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    }

    private async handleChannels(interaction: ChatInputCommandInteraction): Promise<void> {
        const pageOption = interaction.options.getString('page');
        const page = pageOption === 'all' ? 1 : Math.max(1, Number.parseInt(pageOption ?? '1', 10) || 1);
        const { pageItems, total, totalPages, safePage } = this.buildChannelsPage(page);

        const embed = new EmbedBuilder()
            .setTitle('Channels')
            .setColor('#5865f2')
            .setDescription(
                pageItems.length > 0
                    ? pageItems
                          .map(item => `- ${item.label}${item.kind === 'media' ? ' (on demand)' : ''}`)
                          .join('\n')
                    : 'No visible channels. Add and select channels in the WebUI.'
            )
            .setFooter({ text: `Page ${safePage} of ${totalPages} | ${total} channels` });

        await interaction.reply({
            embeds: [embed],
            components: this.channelButtons(pageItems, safePage, totalPages),
            flags: MessageFlags.Ephemeral,
        });
    }

    private buildChannelsPage(page: number): {
        pageItems: ChannelPageItem[];
        total: number;
        totalPages: number;
        safePage: number;
    } {
        const media = this.playback.getMediaChannels().map(channel => ({
            kind: 'media' as const,
            sourceId: channel.sourceId ?? 0,
            label: channel.name,
        }));
        const iptv = listVisibleChannels(this.db, 5000).map(channel => ({
            kind: 'iptv' as const,
            id: channel.id,
            label: formatChannelLabel(channel.name, channel.groupTitle),
        }));
        const all = [...media, ...iptv];
        const total = all.length;
        const totalPages = Math.max(1, Math.ceil(total / COMMANDS_PER_PAGE));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * COMMANDS_PER_PAGE;
        return {
            pageItems: all.slice(start, start + COMMANDS_PER_PAGE),
            total,
            totalPages,
            safePage,
        };
    }

    private channelButtons(
        pageItems: ChannelPageItem[],
        safePage: number,
        totalPages: number
    ): ActionRowBuilder<ButtonBuilder>[] {
        const components: ActionRowBuilder<ButtonBuilder>[] = [];
        for (let index = 0; index < pageItems.length; index += 5) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (const item of pageItems.slice(index, index + 5)) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            item.kind === 'media'
                                ? `play_media_${item.sourceId}`
                                : `play_channel_${item.id}`
                        )
                        .setLabel(item.label.slice(0, 80))
                        .setStyle(item.kind === 'media' ? ButtonStyle.Secondary : ButtonStyle.Primary)
                );
            }
            components.push(row);
        }

        if (totalPages > 1) {
            components.push(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`channels_prev_${safePage}`)
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(safePage <= 1),
                    new ButtonBuilder()
                        .setCustomId(`channels_next_${safePage}`)
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(safePage >= totalPages)
                )
            );
        }

        return components;
    }

    private async handleProgramme(interaction: ChatInputCommandInteraction): Promise<void> {
        const channelRefValue = interaction.options.getString('channel');
        if (!channelRefValue) {
            await interaction.reply({
                content: 'Provide a channel name. Use /channels to see visible channels.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const channel = findVisibleChannelByRef(this.db, channelRefValue);
        if (!channel?.tvgId) {
            await interaction.reply({
                content: 'Channel not found or has no guide.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const now = Math.floor(Date.now() / 1000);
        const rows = queryProgrammes(this.db, {
            start: now - 3600,
            end: now + 24 * 3600,
            channelTvgIds: [channel.tvgId],
        });
        const entries: ProgrammeEntry[] = rows.map(row => ({
            start: new Date(row.startTimestamp * 1000).toISOString(),
            stop: new Date(row.stopTimestamp * 1000).toISOString(),
            start_timestamp: row.startTimestamp,
            stop_timestamp: row.stopTimestamp,
            channel: row.channelTvgId,
            title: row.title,
            description: row.description,
            category: row.category,
            created_at: new Date(row.createdAt).toISOString(),
            subtitle: row.subtitle ?? undefined,
            episode_num: row.episodeNum ?? undefined,
            season: row.season ?? undefined,
            episode: row.episode ?? undefined,
            icon: row.icon ?? undefined,
            image: row.image ?? undefined,
            date: row.date ?? undefined,
            previously_shown: row.previouslyShown ?? undefined,
        }));

        const embeds = ProgrammeEmbedProcessor.generateProgrammeInfoEmbeds(channel.name, entries);
        if (embeds.length === 0) {
            await interaction.editReply('No upcoming programmes found for this channel.');
            return;
        }
        await interaction.editReply({ embeds: embeds.slice(0, 10) });
    }

    private async handleRefresh(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const count = await this.iptv.refreshAll(true);
        await interaction.editReply(`Refreshed ${count} source${count === 1 ? '' : 's'}.`);
    }

    private async handleButton(interaction: ButtonInteraction): Promise<void> {
        if (!this.canUse(interaction)) {
            await interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const member = interaction.member as GuildMember | null;
        const voiceChannel = member?.voice.channel;
        if (!voiceChannel || !interaction.guildId) {
            await interaction.reply({
                content: 'Join a voice channel first.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (interaction.customId === 'stop_stream') {
            await interaction.deferUpdate();
            const result = await this.playback.stop();
            await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
        }

        if (interaction.customId.startsWith('play_media_')) {
            const sourceId = Number.parseInt(interaction.customId.replace('play_media_', ''), 10);
            await interaction.deferUpdate();
            const result = await this.playback.startPlaceholder(sourceId, {
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
            });
            await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
        }

        if (interaction.customId.startsWith('play_channel_')) {
            const id = Number.parseInt(interaction.customId.replace('play_channel_', ''), 10);
            const channel = listVisibleChannels(this.db, 5000).find(item => item.id === id);
            if (!channel) {
                await interaction.reply({ content: 'Channel not found.', flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.deferUpdate();
            const result = await this.playback.playIptv(
                {
                    id: channel.id,
                    name: channel.name,
                    tvgId: channel.tvgId,
                    logo: channel.logo,
                    group: channel.groupTitle,
                    url: channel.streamUrl,
                },
                { guildId: interaction.guildId, voiceChannelId: voiceChannel.id }
            );
            await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
            return;
        }

        if (interaction.customId.startsWith('channels_prev_') || interaction.customId.startsWith('channels_next_')) {
            await interaction.deferUpdate();
            const current = Number.parseInt(interaction.customId.split('_').pop() ?? '1', 10);
            const next = interaction.customId.startsWith('channels_next_') ? current + 1 : Math.max(1, current - 1);
            const { pageItems, total, totalPages, safePage } = this.buildChannelsPage(next);
            const embed = new EmbedBuilder()
                .setTitle('Channels')
                .setColor('#5865f2')
                .setDescription(
                    pageItems
                        .map(item => `- ${item.label}${item.kind === 'media' ? ' (on demand)' : ''}`)
                        .join('\n') || 'No visible channels.'
                )
                .setFooter({ text: `Page ${safePage} of ${totalPages} | ${total} channels` });

            await interaction.editReply({
                embeds: [embed],
                components: this.channelButtons(pageItems, safePage, totalPages),
            });
        }
    }

    private canUse(interaction: { guildId: string | null; memberPermissions?: { has: (flag: bigint) => boolean } | null; member?: unknown }): boolean {
        if (!interaction.guildId) {
            return false;
        }
        if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return true;
        }
        const member = interaction.member as GuildMember | null;
        const stored = getGuildSettings(this.db, interaction.guildId);
        if (!stored.enabled || stored.allowedRoleIds.length === 0) {
            return false;
        }
        return member?.roles?.cache?.some(role => stored.allowedRoleIds.includes(role.id)) ?? false;
    }

    private emit(): void {
        this.events.emit('discord', this.getStatus());
    }
}

async function fetchDiscordIdentity(token: string, bot: boolean): Promise<{ id: string; tag: string }> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: bot ? `Bot ${token}` : token },
    });
    if (!response.ok) {
        throw new Error(`Discord rejected the ${bot ? 'bot' : 'user'} token (${response.status})`);
    }
    const user = (await response.json()) as {
        id: string;
        username: string;
        discriminator?: string;
        global_name?: string | null;
    };
    return {
        id: user.id,
        tag:
            user.global_name ||
            (user.discriminator && user.discriminator !== '0'
                ? `${user.username}#${user.discriminator}`
                : user.username),
    };
}
