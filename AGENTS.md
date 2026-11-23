# AGENTS.md

Guidance for AI coding agents and humans working in this repository.

## What this is

OrbisCast is a Discord bot that streams IPTV channels and on-demand Plex or Jellyfin media into Discord voice channels. A browser WebUI manages configuration, IPTV curation, the EPG, media sources, Discord permissions, streaming settings, logs, and optional authentication.

It uses a **bot token** for slash commands and a **user (self-bot) token** for the actual video stream. Discord does not allow regular bots to send video.

> [!CAUTION]
> Self-bots violate Discord's Terms of Service and can get an account banned. Never commit real tokens or credentials. All configuration is stored in SQLite, and Discord and media server tokens are encrypted at rest.

## Tech stack

- **Language:** TypeScript, compiled to **CommonJS** for the server (`tsconfig.json`). The WebUI is ESM and built with Vite.
- **Runtime:** Node.js >= 22.12. Better Auth 1.7.x is ESM-only and relies on `require(esm)`.
- **Bot client:** `discord.js` v14.
- **Streaming:** `@dank074/discord-video-stream` v7 and its peer `@lng2004/discord.js-selfbot-v13`.
- **HTTP:** Express 5, Helmet, compression, Zod.
- **Database:** SQLite with Drizzle ORM and `better-sqlite3`. Migrations live in `drizzle/`.
- **WebUI:** React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5.
- **Auth:** Better Auth with the username plugin, disabled by default.
- **Logging:** Winston with a rotating file in `data/logs/app.log` and an in-memory ring buffer for the WebUI.
- **Tests:** Vitest for unit and API tests, Playwright for browser tests.

## Requirements

- Node.js >= 22.12
- FFmpeg on `PATH`, built with **libzmq** for the `azmq` audio filter. Debian's `ffmpeg` package has it. Static builds bundled with `node-av` do not.
- Docker base image must be glibc-based and recent. `node:22-trixie-slim` is used because `node-datachannel` needs GLIBC 2.38+.
- At least one IPTV M3U playlist for IPTV, and a Plex or Jellyfin server for on-demand playback.

## Repository layout

```
src/
  index.ts                       Boot: SQLite, settings, services, HTTP server
  runtime.ts                     Process-wide service container
  cli/admin.ts                   Auth lockout recovery CLI
  interfaces/iptv.ts             Legacy parser types used by the IPTV embeds
  shared/types.ts                DTOs shared by the API and WebUI
  utils/
    crypto.ts                    AES-256-GCM token encryption and key file
    logger.ts                    Winston logger, file rotation, memory transport
    log-bus.ts                   Ring buffer and SSE log subscriptions
    redact.ts                    Secret redaction for log lines
    cache.ts                     data/cache helpers
    channels.ts                  Channel id sanitization helpers
  modules/
    database/
      schema.ts                  Drizzle schema for app tables
      client.ts                  SQLite open, pragmas, migrations
      repo.ts                    Typed queries and transactions
    settings/index.ts            Typed settings, defaults, token encryption
    setup/import-env.ts          One-time legacy .env import
    iptv/
      service.ts                 Paired source refresh, parsing, DB sync
      downloaders.ts             Fetch with retries, timeout, size cap
      parsers/                   M3U and XMLTV parsers
      utils.ts                   XMLTV date parsing
    discord/service.ts           Bot client, commands, role allowlist, live reconnect
    streaming/
      index.ts                   Self-bot voice connection and FFmpeg playback
      media-stream.ts            Packet pacing for the persistent provider stream
      persistent-session.ts      Media stream that survives source swaps
      library-fixes.ts           Runtime patches for the streaming library
      ffmpeg.ts                  Valid low-latency options and FFmpeg stderr tail
    playback/engine.ts           Global playback state machine and conflict rules
    media/
      service.ts                 Media sources, browsing, queue, playback, placeholder
      types.ts                   Provider contract and normalized media models
      auth-proxy.ts              Loopback proxy that injects provider headers
      quality.ts                 Shared quality presets
      resume.ts                  Resume thresholds and saved-position clamping
      providers/                 Plex and Jellyfin adapters
    plex/
      client.ts                  Plex Media Server HTTP client
      transcode.ts               HLS transcode URL and subtitle selection
    jellyfin/
      client.ts                  Jellyfin HTTP client and response normalization
    auth/                        Better Auth schema, factory, setup helpers
    embeds/                      Discord embed builders
  web/
    app.ts                       Express API, SSE, static SPA serving
    auth.ts                      Better Auth Express adapter
web/                             React SPA (workspace package)
test/                            Vitest tests, fixtures, and Playwright tests
drizzle/                         Generated SQL migrations
assets/                          Media placeholder slide
docs/                            Subsystem documentation
```

## Commands

```bash
npm ci                  # install server and WebUI dependencies
npm run dev             # API on :3000, Vite on :5173
npm run dev:api         # API only, watch mode
npm run dev:web         # Vite only
npm run build           # type-safe server build and WebUI build
npm run build:api
npm run build:web
npm run start:prod      # run dist/index.js
npm start               # run TypeScript directly with tsx
npm run typecheck       # server and WebUI
npm test                # Vitest
npm run test:watch
npm run test:coverage
npm run test:e2e        # Playwright
npm run db:generate     # generate a Drizzle migration
npm run db:check        # check migration consistency
npm run admin -- auth status
npm run admin -- auth disable
npm run admin -- auth reset <username> <password>
```

Before proposing changes, run `npm run typecheck`, `npm test`, and `npm run build`. For WebUI work, also run `npm run test:e2e` and inspect the rendered page at desktop and mobile widths.

## Boot sequence

1. Parse `--port`, `--data-dir`, and `--test-mode`.
2. Open `data/orbiscast.db`, enable WAL, foreign keys, and a busy timeout.
3. Run pending Drizzle migrations.
4. Load or create `data/keys.json` with mode 0600.
5. Construct `SettingsService`, run the one-time `.env` import if the database is pristine, then write defaults.
6. Apply the timezone and log level from settings.
7. Construct `IptvService`, `PlaybackEngine`, `MediaService`, `DiscordService`, and the auth adapter.
8. Start Express, then start Discord, media validation, and the IPTV scheduler.

`--test-mode` skips Discord login, IPTV refresh, and media validation. Playwright uses it.

## Configuration and secrets

- There are no required environment variables. `PORT` is an optional override.
- All settings live in SQLite. The `settings` table stores one JSON row per section.
- `data/keys.json` holds the AES-256-GCM key and the Better Auth secret. Losing it makes saved provider tokens unrecoverable.
- Discord and media server tokens are encrypted with AES-256-GCM. API responses return only masked values or the last four characters.
- IPTV source URLs are stored plaintext by decision. Do not add them to logs or docs.
- `.env` is read once by `src/modules/setup/import-env.ts` when the database is pristine. It checks the project root and `data/.env`. After the import marker is set, `.env` is ignored.
- Never log tokens, session cookies, provider transcode URLs, or source URLs with credentials. Use `redactSecrets` from `src/utils/redact.ts`.

## IPTV pipeline

- A source pairs one M3U playlist with an optional XMLTV guide.
- `IptvService.refreshSource` downloads both, parses the playlist, merges XMLTV channel metadata by `tvg-id` then name, and writes channels and programmes.
- Only playlist entries with a stream URL become channels. XMLTV-only channels are not playable rows.
- Channel rows are upserted by `(source_id, stable_key)` and preserve the `visible` flag. Rows not seen in a successful refresh are deleted.
- A failed playlist download aborts the refresh and keeps the last good data. A failed guide download updates channels and keeps the old guide.
- Programmes older than seven days are pruned after a successful guide refresh.
- Each source has its own refresh timer. `refreshSource` coalesces concurrent refreshes for the same source.

## Discord

- `DiscordService` owns the bot client, command registration, guild lookup, role allowlists, live token reconnect, and the streamer onboarding flow.
- Commands are registered per guild on ready and on `guildCreate`.
- `StreamerOnboarding` (in `src/modules/setup/onboarding.ts`) adds the streaming account to every guild the bot is in. It creates a one-time invite with the bot client, accepts it with the self-bot token, and exposes a fallback invite when Discord blocks the automatic join. Never accept invites on behalf of the bot token.
- The bot invite URL is built from the OAuth2 application ID, which is the bot user ID. It requests Create Instant Invite, View Channels, Send Messages, Embed Links, Read Message History, Connect, and Speak.
- The per-guild role allowlist protects every command. An empty allowlist means only Manage Server or Administrator. Manage Server bypasses.
- The bot and streamer clients are recreated on token changes. Never call `logout()` on the self-bot; it revokes the user token. Use `destroy()` through `shutdownStreamer()`.
- Playback is global. One self-bot can only join one voice channel, so a second real playback is rejected while IPTV or media is active.
- `/stream` on a media channel starts the placeholder, not content playback. Content starts from the WebUI.

## Playback

`PlaybackEngine` is the single state machine:

```
idle -> placeholder -> iptv | media
iptv | media -> idle on stop, natural end, or queue end
```

- The placeholder is idle and replaceable. It is not a conflict.
- Real playback is exclusive. `isBusy()` covers IPTV and media only.
- The placeholder uses a generated 6-second MP4 loop from `assets/plex-placeholder.png`. The FFmpeg pipeline loops it with `-stream_loop -1`.
- The spectator monitor applies to IPTV and media playback, not the placeholder.
- Media pause sends Discord's `STREAM_SET_PAUSED` and suspends FFmpeg with SIGSTOP: the voice connection and provider session stay open, and viewers see Discord's paused screen. Buffered frames are held while paused. Resume sends SIGCONT, clears the pause state, and rebases both packet pacers so audio cannot catch up in a burst. Seek replaces the provider transcode at the chosen offset without recreating the Discord stream; a seek while paused also clears the pause state. Stop and skip stop the transcode.
- The queue is persisted in SQLite and managed only in the WebUI. Stop and skip remove the current queue row. Stopping or skipping at or after 85 percent marks the history row completed.
- `settings.playback.autoplayNextEpisode` queues and starts the next episode when an episode ends naturally and the queue is empty. `settings.playback.autoSkipIntro` skips a Plex intro marker once per item. Both default to off.

## Streaming library

- `streaming/library-fixes.ts` patches the signed Exp-Golomb writer, contains frame-preparation errors, and floors the WebRTC video pacer at 2.5x the configured maximum bitrate. The pacer floor stops keyframe bursts from collapsing during low-motion scenes. `applyLibraryFixes()` runs once and is awaited before IPTV or media playback starts.
- Do not use the library's `minimizeLatency` option. It passes `-flags lowdelay`, which FFmpeg rejects. Live IPTV uses the valid `low_delay` options from `streaming/ffmpeg.ts` as `customInputOptions` instead.
- Do not use the library's one-second forced keyframe interval. `KEYFRAME_OPTIONS` in `streaming/ffmpeg.ts` overrides it with two seconds. At 1080p a one-second keyframe is large enough to arrive as a visible stall while audio continues.
- FFmpeg stderr is kept in a bounded tail and logged on failure through `redactSecrets`, so provider credentials stay out of logs.

## Media sources

- `MediaService` owns every Plex and Jellyfin source, the shared queue, playback, pause, seek, subtitle switching, saved history, and the placeholder.
- `media_history` stores one resume row per `(source_id, item_id)`. Progress is saved every 15 seconds and on pause, seek, stop, skip, end, and shutdown. Deleting a source cascades its history.
- `resolveResumePosition` skips completed items, short starts, and the end guard. Never resume a finished item without clearing its completed flag.
- `setSubtitleMode` rebuilds the provider source at the current position and swaps it into the live Discord stream. It updates both the queue row and the history row. Only one source swap runs at a time.
- Plex `subtitleStreamID` is the global `Stream.id`. The service resolves a mode to a per-part index; `PlexProvider.preparePlayback` maps that index to the stream id, persists it with `PUT /library/parts/{partId}`, then builds the transcode URL. Subtitles off persists `0` and sends `subtitles=none`. Jellyfin takes the index directly.
- `GET /api/media/history` uses `getHistoryWithNext`, which appends synthetic `recommended` rows for the next unwatched episode of a finished series. Recommendation ids are negative; do not pass them to delete-history routes.
- Plex `getItem` requests `includeMarkers=1`. An `intro` marker becomes `MediaItemDetail.intro`; Jellyfin items have no intro marker.
- A source row stores the kind, server URL, encrypted token, client identifier, Jellyfin user, virtual channel name, timers, and default quality.
- `media_libraries` is unique on `(source_id, library_key)` and preserves enabled flags across validation.
- `media_queue_items` is global. Every entry carries `source_id` and cascades when the source is deleted. Clearing the queue keeps the active playback row so the queue panel and playback state stay aligned.
- The legacy `plex_libraries`, `plex_queue_items`, and `settings.plex` rows are migrated once when no media source exists.
- `PlexProvider` and `JellyfinProvider` implement the shared `MediaProvider` contract. Keep provider-specific HTTP, transcode URLs, and stream mapping inside those adapters.
- The Discord re-encode fits a 1920x1080 box (`discordHeightForQuality`, then `buildScaleFilter`) without upscaling either dimension. A 4K preset is a provider resolution only; the app downscales it because the software encoder cannot sustain 4K. Do not return to `scale=-2:height`, which upscaled 1920x800 content to 2592x1080.
- On-demand media keeps FFmpeg's input buffering. Do not pass `-re` or the low-latency input options to Plex or Jellyfin playback: they starve the demuxer read-ahead and freeze the picture while audio continues. The low-latency options are for live IPTV.
- `AuthProxy` injects Plex or Jellyfin headers on loopback. Never put a provider token in an FFmpeg URL.
- Jellyfin rejects `StartTimeTicks` on segment requests. The proxy strips it from non-manifest requests.
- Thumbnails go through `/api/media/thumb/:sourceId/:itemId`. Never send a provider URL with a token to the browser.
- The placeholder timers are per source: idle timeout and empty-channel grace.
- The placeholder stream uses the same voice connection but does not start the normal spectator monitor.

## WebUI and API

- Express serves `/api`, SSE streams, and the built SPA from `web/dist`.
- `createApp` is a factory so API tests can inject a temporary database and real service instances.
- When auth is enabled, every `/api` route except health and auth requires a Better Auth session. SSE endpoints use the same middleware.
- Mutations check the `Origin` header. Same-origin requests pass; localhost Vite origins pass in non-production; additional origins come from settings.
- SSE endpoints: `/api/events` for playback, sources, Discord, queue, history, and settings; `/api/logs/stream` for log lines.
- The WebUI uses native `<dialog>`, `popover="manual"` toasts, semantic tables, and responsive container queries. Read `PRODUCT.md` and `.impeccable/surfaces/webui.md` before UI work.
- The Media page selects sources with draggable tabs. The order lives in `settings.ui.mediaSourceOrder`; the first tab is the default. Keep drag, arrow-button, and Alt plus arrow reordering in sync.
- `/media/sources` manages Plex and Jellyfin sources and libraries with inline forms. Do not reintroduce source or library dialogs on the Media page.

## Environment variables

No required variables. `PORT` is optional. `DATA_DIR` is not read; use `--data-dir` for manual runs or the Docker volume.

## Coding conventions

- Match the existing style: 4-space indentation, single quotes, JSDoc on exported functions.
- Keep changes small and focused. Prefer the existing module boundaries.
- Never log tokens, session cookies, or full transcode URLs.
- Add a test for pure logic: parsers, crypto, settings, queue math, transcode URLs, redaction.
- Do not commit `node_modules`, `dist`, `web/dist`, `data/`, `cache/`, `.env`, `.tmp`, or Playwright output.

## Testing notes

- Tests live in `test/`. Vitest uses Node and does not need Discord or media servers.
- `test/api/app.test.ts` builds the real Express app with a temporary SQLite database and real services. It covers settings, sources, channels, auth, and the media queue.
- `test/plex/` covers the Plex client and transcode builder with synthetic fixtures. `test/media/` covers the provider contract, resume thresholds, Jellyfin mapping, and media queue behavior.
- `test/auth/` covers Better Auth sign-up, sign-in, sessions, and validation.
- Playwright should seed data through the API and use `--test-mode`. Real Discord and media servers are manual acceptance tests.
- A full manual acceptance pass needs a real guild, a real voice channel, a real IPTV source, and a real Plex or Jellyfin library. Transcode sessions and subtitles must be checked on the server.

## Known issues

- **ZMQ port 42069:** `discord-video-stream` binds a ZMQ socket for volume control. Only one OrbisCast stream can run per host. Another process using 42069 makes FFmpeg fail with `Address already in use`. Run OrbisCast in its own container and do not expose 42069.
- **Image subtitles:** Some Plex image tracks have no stream index and cannot be burned. They appear in the picker as unavailable. Jellyfin image subtitles work when the server can burn them.
- **Provider transcode 400:** Plex or Jellyfin can reject a transcode for an unsupported file or while the transcoder is unhealthy. Try another item, quality, or with subtitles off.
- **Jellyfin seek:** Segment requests reject `StartTimeTicks`; the proxy strips it. Keep that behavior.
- **`node-av` / `node-datachannel`:** Native bindings need a recent glibc. Alpine and `bookworm` fail. Use `node:22-trixie-slim`.
- **`tsx` and `unicorn-magic`:** `package.json` overrides `unicorn-magic` to `^0.4.1` because the older conditional exports are import-only. Keep the override until `npm-run-path` updates.
- **`npm audit`:** Reports transitive issues in `ip` through `werift` and `node-av`. There is no non-breaking fix upstream. Do not run `npm audit fix --force`.
- **Self-bot ToS:** Using a user token for streaming violates Discord's Terms of Service. The product keeps the caution visible.

## Docs and routing

| Task | Read |
|---|---|
| Product intent, users, principles | [PRODUCT.md](PRODUCT.md) |
| Visual system, tokens, components | [DESIGN.md](DESIGN.md) |
| WebUI direction and surface contract | [.impeccable/surfaces/webui.md](.impeccable/surfaces/webui.md) |
| WebUI and API | [docs/webui.md](docs/webui.md) |
| Media sources, providers, proxy, transcode, queue | [docs/media.md](docs/media.md) |
| IPTV sources, sync, EPG | [docs/iptv.md](docs/iptv.md) |
| Deployment, data, admin CLI | [docs/operations.md](docs/operations.md) |
| Database schema and migrations | [docs/database.md](docs/database.md) |

## Pull requests

- Branch from `master`, keep commits scoped and descriptive.
- CI runs typecheck and tests on pushes and pull requests.
- The Docker release workflow builds and publishes the image when a GitHub release is published.
