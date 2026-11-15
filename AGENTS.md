# AGENTS.md

Guidance for AI coding agents and humans working in this repository.

## What this is

OrbisCast is a Discord bot that streams IPTV channels and on-demand Plex media into Discord voice channels. A browser WebUI manages configuration, IPTV curation, the EPG, Plex, Discord permissions, streaming settings, logs, and optional authentication.

It uses a **bot token** for slash commands and a **user (self-bot) token** for the actual video stream. Discord does not allow regular bots to send video.

> [!CAUTION]
> Self-bots violate Discord's Terms of Service and can get an account banned. Never commit real tokens or credentials. All configuration is stored in SQLite, and Discord and Plex tokens are encrypted at rest.

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
- At least one IPTV M3U playlist for IPTV, and a Plex server and token for Plex playback.

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
    streaming/index.ts           Self-bot voice connection and FFmpeg playback
    playback/engine.ts           Global playback state machine and conflict rules
    plex/
      client.ts                  Plex Media Server HTTP client
      transcode.ts               HLS transcode URL and subtitle selection
      proxy.ts                   Loopback proxy that injects Plex headers for FFmpeg
      service.ts                 Plex browsing, queue, playback, placeholder
    auth/                        Better Auth schema, factory, setup helpers
    embeds/                      Discord embed builders
  web/
    app.ts                       Express API, SSE, static SPA serving
    auth.ts                      Better Auth Express adapter
web/                             React SPA (workspace package)
test/                            Vitest tests, fixtures, and Playwright tests
drizzle/                         Generated SQL migrations
assets/                          Plex placeholder slide
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
7. Construct `IptvService`, `PlaybackEngine`, `PlexService`, `DiscordService`, and the auth adapter.
8. Start Express, then start Discord, Plex validation, and the IPTV scheduler.

`--test-mode` skips Discord login, IPTV refresh, and Plex validation. Playwright uses it.

## Configuration and secrets

- There are no required environment variables. `PORT` is an optional override.
- All settings live in SQLite. The `settings` table stores one JSON row per section.
- `data/keys.json` holds the AES-256-GCM key and the Better Auth secret. Losing it makes saved provider tokens unrecoverable.
- Discord and Plex tokens are encrypted with AES-256-GCM. API responses return only masked values or the last four characters.
- IPTV source URLs are stored plaintext by decision. Do not add them to logs or docs.
- `.env` is read once by `src/modules/setup/import-env.ts` when the database is pristine. It checks the project root and `data/.env`. After the import marker is set, `.env` is ignored.
- Never log tokens, session cookies, Plex transcode URLs, or source URLs with credentials. Use `redactSecrets` from `src/utils/redact.ts`.

## IPTV pipeline

- A source pairs one M3U playlist with an optional XMLTV guide.
- `IptvService.refreshSource` downloads both, parses the playlist, merges XMLTV channel metadata by `tvg-id` then name, and writes channels and programmes.
- Only playlist entries with a stream URL become channels. XMLTV-only channels are not playable rows.
- Channel rows are upserted by `(source_id, stable_key)` and preserve the `visible` flag. Rows not seen in a successful refresh are deleted.
- A failed playlist download aborts the refresh and keeps the last good data. A failed guide download updates channels and keeps the old guide.
- Programmes older than seven days are pruned after a successful guide refresh.
- Each source has its own refresh timer. `refreshSource` coalesces concurrent refreshes for the same source.

## Discord

- `DiscordService` owns the bot client, command registration, guild lookup, role allowlists, and live token reconnect.
- Commands are registered per guild on ready and on `guildCreate`.
- The per-guild role allowlist protects every command. An empty allowlist means only Manage Server or Administrator. Manage Server bypasses.
- The bot and streamer clients are recreated on token changes. Never call `logout()` on the self-bot; it revokes the user token. Use `destroy()` through `shutdownStreamer()`.
- Playback is global. One self-bot can only join one voice channel, so a second real playback is rejected while IPTV or Plex is active.
- `/stream` on the Plex channel starts the placeholder, not content playback. Content starts from the WebUI.

## Playback

`PlaybackEngine` is the single state machine:

```
idle -> placeholder -> iptv | plex
iptv | plex -> idle on stop, natural end, or queue end
```

- The placeholder is idle and replaceable. It is not a conflict.
- Real playback is exclusive. `isBusy()` covers IPTV and Plex only.
- The placeholder uses a generated 6-second MP4 loop from `assets/plex-placeholder.png`. The FFmpeg pipeline loops it with `-stream_loop -1`.
- The spectator monitor applies to IPTV and Plex playback, not the placeholder.
- Plex pause freezes the Discord stream without ending it: the voice connection and Plex session stay open, and FFmpeg is suspended with SIGSTOP. Resume continues the same stream. Stop and skip stop the transcode.
- The queue is persisted in SQLite and managed only in the WebUI.

## Plex

- `PlexClient` talks to Plex Media Server with JSON responses and the `X-Plex-Token` header.
- Thumbnails go through `/api/plex/thumb/:ratingKey`, which uses the `/photo/:/transcode` endpoint and returns resized images. Never send a Plex URL with the token to the browser.
- Transcode URLs are built by `buildTranscodeUrl`. Plex expects the **stream index** in `subtitleStreamID`, not the global stream id.
- FFmpeg cannot send the required Plex client headers through the streaming library, so `PlexProxy` runs on a random loopback port and injects `X-Plex-*` and `X-Plex-Token` headers. The URL passed to FFmpeg has no token. The proxy also rewrites absolute Plex URLs in HLS manifests.
- The Plex transcode session is stopped on stop, skip, natural end, error, and app shutdown.
- The placeholder timers: idle timeout (default 5 minutes) and empty-channel grace (default 30 seconds). Both are configurable.
- The placeholder stream uses the same voice connection but does not start the normal spectator monitor.

## WebUI and API

- Express serves `/api`, SSE streams, and the built SPA from `web/dist`.
- `createApp` is a factory so API tests can inject a temporary database and real service instances.
- When auth is enabled, every `/api` route except health and auth requires a Better Auth session. SSE endpoints use the same middleware.
- Mutations check the `Origin` header. Same-origin requests pass; localhost Vite origins pass in non-production; additional origins come from settings.
- SSE endpoints: `/api/events` for playback, sources, Discord, queue, and settings; `/api/logs/stream` for log lines.
- The WebUI uses native `<dialog>`, `popover="manual"` toasts, semantic tables, and responsive container queries. Read `PRODUCT.md` and `.impeccable/surfaces/webui.md` before UI work.

## Environment variables

No required variables. `PORT` is optional. `DATA_DIR` is not read; use `--data-dir` for manual runs or the Docker volume.

## Coding conventions

- Match the existing style: 4-space indentation, single quotes, JSDoc on exported functions.
- Keep changes small and focused. Prefer the existing module boundaries.
- Never log tokens, session cookies, or full transcode URLs.
- Add a test for pure logic: parsers, crypto, settings, queue math, transcode URLs, redaction.
- Do not commit `node_modules`, `dist`, `web/dist`, `data/`, `cache/`, `.env`, `.tmp`, or Playwright output.

## Testing notes

- Tests live in `test/`. Vitest uses Node and does not need Discord or Plex.
- `test/api/app.test.ts` builds the real Express app with a temporary SQLite database and real services. It covers settings, sources, channels, auth, and the queue.
- `test/plex/` covers the Plex client and transcode builder with synthetic fixtures.
- `test/auth/` covers Better Auth sign-up, sign-in, sessions, and validation.
- Playwright should seed data through the API and use `--test-mode`. Real Discord and Plex are manual acceptance tests.
- A full manual acceptance pass needs a real guild, a real voice channel, a real IPTV source, and a real Plex library. Plex transcode sessions and subtitles must be checked on the server.

## Known issues

- **ZMQ port 42069:** `discord-video-stream` binds a ZMQ socket for volume control. Only one OrbisCast stream can run per host. Another process using 42069 makes FFmpeg fail with `Address already in use`. Run OrbisCast in its own container and do not expose 42069.
- **Plex image subtitles:** Some Plex image tracks have no stream index and cannot be burned. They appear in the picker as unavailable. Text tracks usually work.
- **Plex transcode 400:** Plex can reject a transcode for an unsupported file or while the transcoder is unhealthy. Try another item, quality, or with subtitles off.
- **`node-av` / `node-datachannel`:** Native bindings need a recent glibc. Alpine and `bookworm` fail. Use `node:22-trixie-slim`.
- **`tsx` and `unicorn-magic`:** `package.json` overrides `unicorn-magic` to `^0.4.1` because the older conditional exports are import-only. Keep the override until `npm-run-path` updates.
- **`npm audit`:** Reports transitive issues in `ip` through `werift` and `node-av`. There is no non-breaking fix upstream. Do not run `npm audit fix --force`.
- **Self-bot ToS:** Using a user token for streaming violates Discord's Terms of Service. The product keeps the caution visible.

## Docs and routing

| Task | Read |
|---|---|
| Product intent, users, principles | [PRODUCT.md](PRODUCT.md) |
| WebUI direction and surface contract | [.impeccable/surfaces/webui.md](.impeccable/surfaces/webui.md) |
| WebUI and API | [docs/webui.md](docs/webui.md) |
| Plex client, proxy, transcode, queue | [docs/plex.md](docs/plex.md) |
| IPTV sources, sync, EPG | [docs/iptv.md](docs/iptv.md) |
| Deployment, data, admin CLI | [docs/operations.md](docs/operations.md) |
| Database schema and migrations | [docs/database.md](docs/database.md) |

## Pull requests

- Branch from `master`, keep commits scoped and descriptive.
- CI runs typecheck and tests on pushes and pull requests.
- The Docker release workflow builds and publishes the image when a GitHub release is published.
