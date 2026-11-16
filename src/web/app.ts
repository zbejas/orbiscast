import express, { type NextFunction, type Request, type Response, type RequestHandler } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { z, ZodError } from 'zod';
import type { Db } from '../modules/database/client';
import {
    addQueueItem,
    attachChannelGuide,
    clearQueue,
    createSource,
    deleteSource,
    getChannelById,
    getChannelDto,
    getGuildSettings,
    getSource,
    listChannelGroups,
    listPlexLibraries,
    listQueue,
    listSources,
    listVisibleChannels,
    queryChannels,
    queryProgrammes,
    removeQueueItem,
    reorderQueue,
    setChannelVisibility,
    updateSource,
    upsertGuildSettings,
} from '../modules/database/repo';
import type { SettingsService, SettingsUpdateInput } from '../modules/settings';
import type { IptvService } from '../modules/iptv/service';
import type { PlaybackEngine } from '../modules/playback/engine';
import type { DiscordService } from '../modules/discord/service';
import type { PlexService } from '../modules/plex/service';
import { getLogs, subscribeLogs } from '../utils/log-bus';
import { configureLogger, getLogger } from '../utils/logger';
import { AuthSetupError, AuthValidationError } from '../modules/auth/setup';
import { AuthenticationRequiredError } from '../modules/auth';
import { PlexError } from '../modules/plex';
import { isAPIError } from 'better-auth/api';
import type { AuthAdapter } from './auth';
import type { ChannelDto, PlaybackStateDto, QueueItemDto } from '../shared/types';

const logger = getLogger();

export interface AppServices {
    dataDir: string;
    db: Db;
    settings: SettingsService;
    iptv: IptvService;
    playback: PlaybackEngine;
    plex: PlexService;
    discord: DiscordService;
    events: EventEmitter;
    auth?: AuthAdapter;
}

const urlSchema = z.string().refine(value => {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}, 'Invalid URL');

const sourceSchema = z.object({
    name: z.string().min(1).max(120),
    playlistUrl: urlSchema,
    xmltvUrl: urlSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    refreshMinutes: z.number().int().min(1).max(10080).optional(),
});

const sourceUpdateSchema = sourceSchema.partial().extend({ id: z.number().int().optional() }).strict();

const visibilitySchema = z.object({
    ids: z.array(z.number().int().positive()).min(1).max(10000),
    visible: z.boolean(),
});

const tokenSchema = z
    .object({
        botToken: z.string().min(1).optional(),
        userToken: z.string().min(1).optional(),
    })
    .strict();

const guildSettingsSchema = z.object({
    allowedRoleIds: z.array(z.string()).max(250),
    enabled: z.boolean().optional(),
});

const playbackSchema = z.object({
    guildId: z.string().min(1),
    voiceChannelId: z.string().min(1),
});

const iptvPlaybackSchema = playbackSchema.extend({
    channelId: z.number().int().positive(),
});

const queueSchema = z.object({
    ratingKey: z.string().min(1),
    type: z.enum(['movie', 'episode']),
    title: z.string().min(1),
    showTitle: z.string().nullable().optional(),
    seasonNumber: z.number().int().nullable().optional(),
    episodeNumber: z.number().int().nullable().optional(),
    durationMs: z.number().int().nullable().optional(),
    thumbUrl: z.string().nullable().optional(),
    quality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']),
    subtitleMode: z.union([z.literal('auto'), z.literal('off'), z.number().int()]).default('auto'),
});

/**
 * Builds the Express application. Kept as a factory so tests can inject a
 * temporary database and fake services.
 *
 * @param services - Runtime services
 * @returns Express application
 */
export function createApp(services: AppServices) {
    const app = express();
    const webDist = join(process.cwd(), 'web', 'dist');

    app.disable('x-powered-by');
    app.use(
        helmet({
            strictTransportSecurity: false,
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", 'data:', 'blob:'],
                    mediaSrc: ["'self'"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'", 'data:'],
                    objectSrc: ["'none'"],
                    frameAncestors: ["'none'"],
                    upgradeInsecureRequests: null,
                },
            },
        })
    );
    app.use(compression());
    app.use(express.json({ limit: '1mb' }));

    app.use('/api', (req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            const origin = req.headers.origin;
            if (origin) {
                const host = req.headers.host;
                let sameOrigin = false;
                try {
                    sameOrigin = Boolean(host && new URL(origin).host === host);
                } catch {
                    sameOrigin = false;
                }
                const isDevOrigin =
                    process.env.NODE_ENV !== 'production' &&
                    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
                const allowed =
                    sameOrigin ||
                    isDevOrigin ||
                    services.settings.getUi().trustedOrigins.includes(origin);
                if (!allowed) {
                    _res.status(403).json({ error: { code: 'origin_rejected', message: 'Origin not allowed' } });
                    return;
                }
            }
        }
        next();
    });

    if (services.auth) {
        app.get('/api/auth/config', async (_req, res) => {
            const hasUser = await services.auth!.hasUser();
            res.json({ enabled: services.settings.isAuthEnabled(), hasUser });
        });

        app.post('/api/auth/enable', async (req, res) => {
            if (services.settings.isAuthEnabled()) {
                res.status(409).json({
                    error: { code: 'already_enabled', message: 'Auth is already enabled' },
                });
                return;
            }
            const schema = z.object({
                username: z.string().min(3).max(30),
                password: z.string().min(8).max(128),
            });
            const input = schema.parse(req.body);

            if (await services.auth!.hasUser()) {
                services.settings.update({ auth: { enabled: true } });
                res.json({ enabled: true, createdAdmin: false });
                return;
            }

            const admin = await services.auth!.createAdmin(input.username, input.password);
            services.settings.update({ auth: { enabled: true } });
            res.status(201).json({ enabled: true, createdAdmin: true, admin });
        });

        app.post('/api/auth/disable', async (req, res) => {
            if (!services.settings.isAuthEnabled()) {
                res.status(400).json({ error: { code: 'not_enabled', message: 'Auth is not enabled' } });
                return;
            }
            const session = await services.auth!.readSession(req.headers);
            if (!session) {
                res.status(401).json({
                    error: { code: 'authentication_required', message: 'Sign in to continue' },
                });
                return;
            }
            services.settings.update({ auth: { enabled: false } });
            res.json({ enabled: false });
        });

        app.get('/api/auth/session', async (req, res) => {
            const session = (await services.auth!.readSession(req.headers)) as {
                user?: { id: string; name: string };
            } | null;
            res.json({
                user: session?.user ? { id: session.user.id, name: session.user.name } : null,
            });
        });

        app.post('/api/auth/login', async (req, res) => {
            const schema = z.object({
                username: z.string().min(1),
                password: z.string().min(1),
            });
            const input = schema.parse(req.body);
            const result = await services.auth!.login(input.username, input.password);
            if (result.cookies.length > 0) {
                res.setHeader('set-cookie', result.cookies);
            }
            res.json({ user: result.user });
        });

        app.post('/api/auth/logout', async (req, res) => {
            try {
                const cookies = await services.auth!.logout(req.headers);
                if (cookies.length > 0) {
                    res.setHeader('set-cookie', cookies);
                }
            } catch {
                // A missing or expired session is already logged out.
            }
            res.status(204).end();
        });

        app.use('/api/auth', services.auth.handle);
    }

    app.use('/api', (req, res, next) => {
        if (!services.settings.isAuthEnabled()) {
            return next();
        }
        if (req.path === '/health' || req.path.startsWith('/auth')) {
            return next();
        }
        if (!services.auth) {
            res.status(503).json({
                error: { code: 'auth_unavailable', message: 'Auth is enabled but not initialized' },
            });
            return;
        }
        return services.auth.middleware(req, res, next);
    });

    app.get('/api/health', (_req, res) => {
        res.json({ ok: true, uptime: process.uptime(), version: process.env.npm_package_version ?? '0.0.0' });
    });

    app.get('/api/setup/status', (_req, res) => {
        const tokens = services.settings.getDiscordTokens();
        const status = services.discord.getStatus();
        const sources = listSources(services.db);
        res.json({
            needsSetup: sources.length === 0 || !tokens.botToken || !tokens.userToken,
            discordConfigured: Boolean(tokens.botToken && tokens.userToken),
            discordValid: status.bot === 'online' && status.streamer === 'online',
            sourcesConfigured: sources.length > 0,
            plexConfigured: services.settings.getPlexConfig().tokenSet,
            plexValid: services.plex.getConfig().connected,
            authEnabled: services.settings.isAuthEnabled(),
        });
    });

    app.get('/api/settings', (_req, res) => {
        res.json(services.settings.getPublic());
    });

    app.patch('/api/settings', async (req: Request, res: Response) => {
        const body = req.body as SettingsUpdateInput;
        if (body.auth?.enabled === true && services.auth && !(await services.auth.hasUser())) {
            res.status(400).json({
                error: {
                    code: 'auth_setup_required',
                    message: 'Create an admin account before enabling auth',
                },
            });
            return;
        }
        if (body.discord?.botToken || body.discord?.userToken) {
            const current = services.settings.getDiscordTokens();
            const validation = await services.discord.validateTokens(
                body.discord.botToken ?? current.botToken,
                body.discord.userToken ?? current.userToken
            );
            if (!validation.ok) {
                res.status(400).json({
                    error: { code: 'invalid_discord_token', message: validation.error ?? 'Invalid Discord token' },
                });
                return;
            }
        }

        const updated = services.settings.update(body);
        services.playback.reloadSettings();
        process.env.TZ = updated.timezone;
        configureLogger({ dataDir: services.dataDir, level: updated.logLevel });
        if (body.discord?.botToken || body.discord?.userToken) {
            void services.discord.reconnect();
        }
        res.json(updated);
    });

    app.get('/api/sources', (_req, res) => {
        const sources = listSources(services.db).map(source => ({
            ...source,
            refreshing: services.iptv.isRefreshing(source.id),
        }));
        res.json(sources);
    });

    app.post('/api/sources', (req, res) => {
        const input = sourceSchema.parse(req.body);
        const created = createSource(services.db, input);
        services.iptv.reschedule(created.id);
        void services.iptv.refreshSource(created.id);
        const dto = listSources(services.db).find(source => source.id === created.id);
        res.status(201).json(dto ? { ...dto, refreshing: true } : { ...created, refreshing: true });
    });

    app.patch('/api/sources/:id', (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        const existing = getSource(services.db, id);
        if (!existing) {
            res.status(404).json({ error: { code: 'not_found', message: 'Source not found' } });
            return;
        }
        const input = sourceUpdateSchema.parse(req.body);
        updateSource(services.db, id, input);
        services.iptv.reschedule(id);
        const dto = listSources(services.db).find(source => source.id === id);
        res.json(dto ? { ...dto, refreshing: services.iptv.isRefreshing(id) } : null);
    });

    app.delete('/api/sources/:id', (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!getSource(services.db, id)) {
            res.status(404).json({ error: { code: 'not_found', message: 'Source not found' } });
            return;
        }
        services.iptv.removeSource(id);
        deleteSource(services.db, id);
        services.events.emit('sources', listSources(services.db));
        res.status(204).end();
    });

    app.post('/api/sources/:id/refresh', async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!getSource(services.db, id)) {
            res.status(404).json({ error: { code: 'not_found', message: 'Source not found' } });
            return;
        }
        const ok = await services.iptv.refreshSource(id, true);
        res.json({ ok, source: listSources(services.db).find(source => source.id === id) ?? null });
    });

    app.get('/api/channels', (req, res) => {
        const visibleParam = typeof req.query.visible === 'string' ? req.query.visible : undefined;
        const visibilityParam =
            req.query.visibility === 'visible' || req.query.visibility === 'hidden' || req.query.visibility === 'all'
                ? req.query.visibility
                : undefined;
        const result = queryChannels(services.db, {
            page: parseIntParam(req.query.page),
            pageSize: parseIntParam(req.query.pageSize),
            sourceId: parseIntParam(req.query.sourceId),
            visible: visibleParam === undefined ? undefined : visibleParam === 'true',
            visibility: visibilityParam,
            group: typeof req.query.group === 'string' ? req.query.group : undefined,
            q: typeof req.query.q === 'string' ? req.query.q : undefined,
            search: typeof req.query.search === 'string' ? req.query.search : undefined,
        });
        res.json({ ...result, items: attachChannelGuide(services.db, result.items) });
    });

    app.get('/api/channels/plex', (_req, res) => {
        const plex = services.settings.getPlexConfig();
        const state = services.playback.getState();
        const dto: ChannelDto = {
            id: 0,
            sourceId: null,
            sourceName: 'Plex',
            name: plex.channelName,
            logo: null,
            group: null,
            tvgId: null,
            visible: plex.tokenSet,
            kind: 'plex',
            nowPlaying: state.mode === 'plex' ? state.title : null,
            next: null,
        };
        res.json(dto);
    });

    app.patch('/api/channels/visibility', (req, res) => {
        const input = visibilitySchema.parse(req.body);
        const changed = setChannelVisibility(services.db, input.ids, input.visible);
        services.events.emit('sources', listSources(services.db));
        res.json({ changed, updated: changed });
    });

    app.patch('/api/channels/:id/visibility', (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        const schema = z.object({ visible: z.boolean() });
        const input = schema.parse(req.body);
        const changed = setChannelVisibility(services.db, [id], input.visible);
        if (changed === 0) {
            res.status(404).json({ error: { code: 'not_found', message: 'Channel not found' } });
            return;
        }
        services.events.emit('sources', listSources(services.db));
        res.json(getChannelDto(services.db, id));
    });

    app.get('/api/channels/groups', (req, res) => {
        const sourceId = parseIntParam(req.query.sourceId);
        res.json({ groups: listChannelGroups(services.db, sourceId) });
    });

    app.get('/api/guide', (req, res) => {
        const day = typeof req.query.day === 'string' ? req.query.day : new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            res.status(400).json({ error: { code: 'invalid_day', message: 'day must be YYYY-MM-DD' } });
            return;
        }
        const dayStart = new Date(`${day}T00:00:00`).getTime();
        const nextDay = new Date(dayStart);
        nextDay.setDate(nextDay.getDate() + 1);
        const dayEnd = nextDay.getTime();
        const channels = queryChannels(services.db, {
            visibility: 'visible',
            pageSize: 200,
        }).items;
        const tvgIds = channels
            .map(channel => channel.tvgId)
            .filter((tvgId): tvgId is string => Boolean(tvgId));
        const rows =
            tvgIds.length > 0
                ? queryProgrammes(services.db, {
                      start: Math.floor(dayStart / 1000),
                      end: Math.ceil(dayEnd / 1000),
                      channelTvgIds: tvgIds,
                  })
                : [];
        res.json({
            dayStart,
            dayEnd,
            channels,
            programmes: rows.map(row => ({
                id: row.id,
                sourceId: row.sourceId,
                channelTvgId: row.channelTvgId,
                title: row.title,
                description: row.description,
                start: row.startTimestamp * 1000,
                stop: row.stopTimestamp * 1000,
                category: row.category || null,
            })),
        });
    });

    app.get('/api/epg', (req, res) => {
        const now = Math.floor(Date.now() / 1000);
        const start = parseIntParam(req.query.start) ?? now;
        const end = parseIntParam(req.query.end) ?? now + 6 * 3600;
        const channelIds =
            typeof req.query.channelIds === 'string'
                ? req.query.channelIds.split(',').map(id => id.trim()).filter(Boolean)
                : undefined;
        const rows = queryProgrammes(services.db, {
            start,
            end,
            channelTvgIds: channelIds,
            sourceId: parseIntParam(req.query.sourceId),
        });
        res.json({ programmes: rows });
    });

    app.get('/api/discord/status', (_req, res) => {
        res.json(services.discord.getStatus());
    });

    app.post('/api/discord/validate', async (req, res) => {
        const input = tokenSchema.parse(req.body ?? {});
        const current = services.settings.getDiscordTokens();
        const result = await services.discord.validateTokens(
            input.botToken ?? current.botToken,
            input.userToken ?? current.userToken
        );
        if (!result.ok) {
            res.status(400).json({ error: { code: 'invalid_token', message: result.error ?? 'Invalid token' } });
            return;
        }
        res.json(services.discord.getStatus());
    });

    app.get('/api/discord/tokens', (_req, res) => {
        const stored = services.settings.getDiscord();
        res.json({
            botTokenSet: Boolean(stored.botTokenEncrypted),
            userTokenSet: Boolean(stored.userTokenEncrypted),
            botLast4: stored.botTokenLast4 || null,
            userLast4: stored.userTokenLast4 || null,
        });
    });

    app.post('/api/discord/tokens', async (req, res) => {
        const input = tokenSchema.parse(req.body);
        const current = services.settings.getDiscordTokens();
        const validation = await services.discord.validateTokens(
            input.botToken ?? current.botToken,
            input.userToken ?? current.userToken
        );
        if (!validation.ok) {
            res.status(400).json({ error: { code: 'invalid_token', message: validation.error } });
            return;
        }
        services.settings.update({ discord: { ...input } });
        await services.discord.reconnect();
        res.json(services.discord.getStatus());
    });

    app.put('/api/discord/tokens', async (req, res) => {
        const input = tokenSchema.parse(req.body);
        const current = services.settings.getDiscordTokens();
        const validation = await services.discord.validateTokens(
            input.botToken ?? current.botToken,
            input.userToken ?? current.userToken
        );
        if (!validation.ok) {
            res.status(400).json({ error: { code: 'invalid_token', message: validation.error } });
            return;
        }
        services.settings.update({ discord: { ...input } });
        await services.discord.reconnect();
        res.json(services.discord.getStatus());
    });

    app.post('/api/discord/reconnect', async (_req, res) => {
        await services.discord.reconnect();
        res.json(services.discord.getStatus());
    });

    app.get('/api/discord/guilds', (_req, res) => {
        res.json(services.discord.getStatus().guilds);
    });

    app.get('/api/discord/guilds/:id', (req, res) => {
        const guild = services.discord.getStatus().guilds.find(item => item.id === req.params.id);
        if (!guild) {
            res.status(404).json({ error: { code: 'not_found', message: 'Guild not found' } });
            return;
        }
        res.json({ ...guild, ...getGuildSettings(services.db, guild.id) });
    });

    app.patch('/api/discord/guilds/:id/settings', (req, res) => {
        const input = guildSettingsSchema.parse(req.body);
        const stored = upsertGuildSettings(
            services.db,
            req.params.id,
            input.allowedRoleIds,
            input.enabled ?? true
        );
        services.events.emit('discord', services.discord.getStatus());
        res.json(stored);
    });

    app.put('/api/discord/guilds/:id/roles', (req, res) => {
        const schema = z.object({ roleIds: z.array(z.string()).max(250) });
        const input = schema.parse(req.body);
        upsertGuildSettings(services.db, req.params.id, input.roleIds, true);
        services.events.emit('discord', services.discord.getStatus());
        const guild = services.discord.getStatus().guilds.find(item => item.id === req.params.id);
        if (!guild) {
            res.status(404).json({ error: { code: 'not_found', message: 'Guild not found' } });
            return;
        }
        res.json({ ...guild, allowedRoleIds: input.roleIds });
    });

    app.get('/api/playback', (_req, res) => {
        res.json(services.playback.getState());
    });

    app.post('/api/playback/stop', async (_req, res) => {
        res.json(await services.playback.stop());
    });

    app.post('/api/playback/skip', async (_req, res) => {
        res.json(await services.playback.skip());
    });

    app.post('/api/playback/pause', async (_req, res) => {
        res.json(await services.playback.pause());
    });

    app.post('/api/playback/resume', async (_req, res) => {
        res.json(await services.playback.resume());
    });

    app.post('/api/playback/iptv', async (req, res) => {
        const input = iptvPlaybackSchema.parse(req.body);
        const channel = getChannelById(services.db, input.channelId);
        if (!channel || !channel.visible) {
            res.status(404).json({ error: { code: 'not_found', message: 'Channel not found or not visible' } });
            return;
        }
        const result = await services.playback.playIptv(
            {
                id: channel.id,
                name: channel.name,
                tvgId: channel.tvgId,
                logo: channel.logo,
                group: channel.groupTitle,
                url: channel.streamUrl,
            },
            { guildId: input.guildId, voiceChannelId: input.voiceChannelId }
        );
        res.status(result.ok ? 200 : 409).json(result);
    });

    app.post('/api/playback/plex', async (req, res) => {
        const input = playbackSchema.parse(req.body);
        const result = await services.playback.playPlex(input);
        res.status(result.ok ? 200 : 409).json(result);
    });

    app.get('/api/queue', (_req, res) => {
        res.json(listQueue(services.db));
    });

    app.post('/api/queue', (req, res) => {
        const input = queueSchema.parse(req.body);
        const created = addQueueItem(services.db, {
            ...input,
            subtitleMode: String(input.subtitleMode),
        });
        services.events.emit('queue', listQueue(services.db));
        res.status(201).json(created);
    });

    app.delete('/api/queue/:id', (req, res) => {
        const removed = removeQueueItem(services.db, Number.parseInt(req.params.id, 10));
        if (!removed) {
            res.status(404).json({ error: { code: 'not_found', message: 'Queue item not found' } });
            return;
        }
        services.events.emit('queue', listQueue(services.db));
        res.status(204).end();
    });

    app.delete('/api/queue', (_req, res) => {
        clearQueue(services.db);
        services.events.emit('queue', listQueue(services.db));
        res.status(204).end();
    });

    app.post('/api/queue/reorder', (req, res) => {
        const schema = z.object({ ids: z.array(z.number().int().positive()) });
        const input = schema.parse(req.body);
        reorderQueue(services.db, input.ids);
        services.events.emit('queue', listQueue(services.db));
        res.json(listQueue(services.db));
    });

    app.post('/api/queue/shuffle', (_req, res) => {
        const items = listQueue(services.db);
        const ids = items.map(item => item.id);
        for (let index = ids.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
        }
        reorderQueue(services.db, ids);
        services.events.emit('queue', listQueue(services.db));
        res.json(listQueue(services.db));
    });

    app.post('/api/queue/play', async (req, res) => {
        const input = playbackSchema.parse(req.body);
        const result = await services.playback.playPlex(input);
        res.status(result.ok ? 200 : 409).json(result);
    });

    app.get('/api/plex/config', (_req, res) => {
        res.json(services.plex.getConfig());
    });

    app.put('/api/plex/config', async (req, res) => {
        const schema = z.object({
            serverUrl: urlSchema.optional(),
            token: z.string().optional(),
            channelName: z.string().min(1).max(80).optional(),
            idleMinutes: z.number().int().min(1).max(120).optional(),
            emptyGraceSeconds: z.number().int().min(0).max(600).optional(),
            defaultQuality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']).optional(),
        });
        const input = schema.parse(req.body);
        services.settings.update({ plex: input });
        const config = await services.plex.connect();
        res.json(config);
    });

    app.post('/api/plex/validate', async (_req, res) => {
        res.json(await services.plex.connect());
    });

    app.get('/api/plex/libraries', async (_req, res) => {
        res.json(await services.plex.getLibraries());
    });

    app.patch('/api/plex/libraries/:key', (req, res) => {
        const schema = z.object({ enabled: z.boolean() });
        const input = schema.parse(req.body);
        res.json(services.plex.setLibraryEnabled(req.params.key, input.enabled));
    });

    app.get('/api/plex/search', async (req, res) => {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        res.json({ items: await services.plex.search(query) });
    });

    app.get('/api/plex/items', async (req, res) => {
        const library = typeof req.query.library === 'string' ? req.query.library : '';
        const search = typeof req.query.search === 'string' ? req.query.search : '';
        if (search.trim()) {
            const items = await services.plex.search(search.trim());
            res.json(library ? items.filter(item => item.libraryKey === library) : items);
            return;
        }
        if (!library) {
            res.json([]);
            return;
        }
        const page = await services.plex.getLibraryItems(library, 0, 200);
        res.json(page.items);
    });

    app.get('/api/plex/items/:ratingKey/children', async (req, res) => {
        res.json(await services.plex.getChildren(req.params.ratingKey));
    });

    app.get('/api/plex/queue', (_req, res) => {
        res.json(services.plex.getQueue());
    });

    app.post('/api/plex/queue', async (req, res) => {
        const schema = z.object({
            ratingKey: z.string().min(1),
            quality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']),
            subtitleMode: z.union([z.literal('auto'), z.literal('off'), z.number().int()]).default('auto'),
        });
        const input = schema.parse(req.body);
        const item = await services.plex.addToQueue(input.ratingKey, input.quality, String(input.subtitleMode));
        res.status(201).json(item);
    });

    app.delete('/api/plex/queue/:id', (req, res) => {
        const removed = removeQueueItem(services.db, Number.parseInt(req.params.id, 10));
        if (!removed) {
            res.status(404).json({ error: { code: 'not_found', message: 'Queue item not found' } });
            return;
        }
        services.events.emit('queue', listQueue(services.db));
        res.status(204).end();
    });

    app.post('/api/plex/queue/:id/move', (req, res) => {
        const schema = z.object({ direction: z.enum(['up', 'down']) });
        const input = schema.parse(req.body);
        res.json(services.plex.moveQueueItem(Number.parseInt(req.params.id, 10), input.direction));
    });

    app.post('/api/plex/queue/shuffle', (_req, res) => {
        res.json(services.plex.shuffleQueue());
    });

    app.delete('/api/plex/queue', (_req, res) => {
        clearQueue(services.db);
        services.events.emit('queue', listQueue(services.db));
        res.status(204).end();
    });

    app.post('/api/plex/queue/:id/play', async (req, res) => {
        const input = playbackSchema.parse(req.body);
        const result = await services.plex.playQueueItem(Number.parseInt(req.params.id, 10), input);
        if (!result.ok) {
            res.status(409).json({ error: { code: 'playback_conflict', message: result.message } });
            return;
        }
        res.json(services.playback.getState());
    });

    app.post('/api/plex/play', async (req, res) => {
        const schema = playbackSchema.extend({
            ratingKey: z.string().min(1),
            quality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']),
            subtitleMode: z.union([z.literal('auto'), z.literal('off'), z.number().int()]).default('auto'),
            queueItemId: z.number().int().positive().nullable().optional(),
        });
        const input = schema.parse(req.body);
        const result =
            input.queueItemId !== undefined && input.queueItemId !== null
                ? await services.plex.playQueueItem(input.queueItemId, {
                      guildId: input.guildId,
                      voiceChannelId: input.voiceChannelId,
                  })
                : await services.plex.playNow(
                      input.ratingKey,
                      input.quality,
                      String(input.subtitleMode),
                      { guildId: input.guildId, voiceChannelId: input.voiceChannelId }
                  );
        if (!result.ok) {
            res.status(409).json({ error: { code: 'playback_conflict', message: result.message } });
            return;
        }
        res.json(services.playback.getState());
    });

    app.post('/api/plex/placeholder', async (req, res) => {
        const input = playbackSchema.parse(req.body);
        const result = await services.playback.startPlaceholder(input);
        if (!result.ok) {
            res.status(409).json({ error: { code: 'playback_conflict', message: result.message } });
            return;
        }
        res.json(services.playback.getState());
    });

    app.get('/api/plex/libraries/:key/items', async (req, res) => {
        const start = parseIntParam(req.query.start) ?? 0;
        const size = Math.min(200, parseIntParam(req.query.size) ?? 50);
        res.json(await services.plex.getLibraryItems(req.params.key, start, size));
    });

    app.get('/api/plex/shows/:ratingKey/seasons', async (req, res) => {
        res.json({ items: await services.plex.getSeasons(req.params.ratingKey) });
    });

    app.get('/api/plex/seasons/:ratingKey/episodes', async (req, res) => {
        res.json({ items: await services.plex.getEpisodes(req.params.ratingKey) });
    });

    app.get('/api/plex/items/:ratingKey', async (req, res) => {
        res.json(await services.plex.getItem(req.params.ratingKey));
    });

    app.get('/api/plex/thumb/:ratingKey', async (req, res) => {
        const width = parseIntParam(req.query.width);
        const height = parseIntParam(req.query.height);
        const image = await services.plex.fetchThumbnail(req.params.ratingKey, width, height);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.type(image.contentType).send(image.body);
    });

    app.post('/api/plex/queue/season', async (req, res) => {
        const schema = z.object({
            seasonRatingKey: z.string().min(1),
            quality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']),
            subtitleMode: z.union([z.literal('auto'), z.literal('off'), z.number().int()]).default('auto'),
        });
        const input = schema.parse(req.body);
        const items = await services.plex.addSeasonToQueue(
            input.seasonRatingKey,
            input.quality,
            String(input.subtitleMode)
        );
        res.status(201).json({ items });
    });

    app.post('/api/plex/queue/show', async (req, res) => {
        const schema = z.object({
            showRatingKey: z.string().min(1),
            quality: z.enum(['720p-4', '1080p-8', '1080p-12', '4k-20']),
            subtitleMode: z.union([z.literal('auto'), z.literal('off'), z.number().int()]).default('auto'),
        });
        const input = schema.parse(req.body);
        const items = await services.plex.addShowToQueue(
            input.showRatingKey,
            input.quality,
            String(input.subtitleMode)
        );
        res.status(201).json({ items });
    });

    app.get('/api/logs', (req, res) => {
        res.json({
            lines: getLogs({
                level: typeof req.query.level === 'string' ? req.query.level : undefined,
                q: typeof req.query.q === 'string' ? req.query.q : undefined,
                limit: parseIntParam(req.query.limit),
            }),
        });
    });

    app.get('/api/events', (req, res) => {
        openSse(res);
        const send = (name: string, data: unknown) => {
            res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        send('playback', services.playback.getState());
        send('sources', listSources(services.db));
        send('discord', services.discord.getStatus());
        send('queue', listQueue(services.db));

        const onPlayback = (state: PlaybackStateDto) => send('playback', state);
        const onSources = (sources: unknown) => send('sources', sources);
        const onDiscord = (status: unknown) => send('discord', status);
        const onQueue = (queue: QueueItemDto[]) => send('queue', queue);
        const onSettings = (settings: unknown) => send('settings', settings);
        services.events.on('playback', onPlayback);
        services.events.on('sources', onSources);
        services.events.on('discord', onDiscord);
        services.events.on('queue', onQueue);
        services.events.on('settings', onSettings);

        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
        res.on('close', () => {
            clearInterval(heartbeat);
            services.events.off('playback', onPlayback);
            services.events.off('sources', onSources);
            services.events.off('discord', onDiscord);
            services.events.off('queue', onQueue);
            services.events.off('settings', onSettings);
        });
    });

    app.get('/api/logs/stream', (req, res) => {
        openSse(res);
        const level = typeof req.query.level === 'string' ? req.query.level : undefined;
        const limit = parseIntParam(req.query.limit) ?? 200;
        for (const line of getLogs({ level, limit })) {
            res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
        }
        const unsubscribe = subscribeLogs(entry => {
            if (level && entry.level !== level) return;
            res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
        });
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
        res.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    app.use(express.static(webDist, { index: false }));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) {
            next();
            return;
        }
        const index = join(webDist, 'index.html');
        if (existsSync(index)) {
            res.sendFile('index.html', { root: webDist });
        } else {
            res.status(404).send('WebUI is not built. Run npm run build:web.');
        }
    });

    app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
        if (res.headersSent) {
            return;
        }
        if (error instanceof ZodError) {
            res.status(400).json({
                error: { code: 'validation_failed', message: 'Invalid request', details: error.issues },
            });
            return;
        }
        if (error instanceof AuthValidationError) {
            res.status(400).json({
                error: { code: 'validation_failed', message: error.message, details: { field: error.field } },
            });
            return;
        }
        if (error instanceof AuthSetupError) {
            res.status(409).json({ error: { code: 'auth_setup_failed', message: error.message } });
            return;
        }
        if (error instanceof AuthenticationRequiredError) {
            res.status(401).json({
                error: { code: 'authentication_required', message: 'Sign in to continue' },
            });
            return;
        }
        if (error instanceof PlexError) {
            res.status(502).json({
                error: { code: error.code.toLowerCase(), message: error.message },
            });
            return;
        }
        if (isAPIError(error)) {
            res.status(error.statusCode ?? 400).json({
                error: {
                    code: error.body?.code ?? 'auth_error',
                    message:
                        error.statusCode === 401
                            ? 'Invalid username or password'
                            : (error.body?.message ?? 'Authentication failed'),
                },
            });
            return;
        }
        logger.error(`${req.method} ${req.path} failed: ${error}`);
        res.status(500).json({
            error: { code: 'internal_error', message: 'Internal server error' },
        });
    });

    return app;
}

function parseIntParam(value: unknown): number | undefined {
    if (typeof value !== 'string' || value === '') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function openSse(res: Response): void {
    res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');
}

// Kept as a lazy import to avoid a circular module for the batch visibility
// update. The functions are stable and synchronous.
