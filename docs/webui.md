# WebUI and API

## Overview

The WebUI is a React single-page app served by the same Express process that runs the bot. It replaces environment files and JSON databases with a SQLite-backed settings model, a channel curation table, an EPG timeline, Plex and Jellyfin browsing, saved playback progress, a shared playback queue, Discord permissions, and live logs. Authentication is optional and off by default.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Boot sequence, service construction, HTTP listener, shutdown |
| `src/runtime.ts` | Process-wide service container for command modules |
| `src/web/app.ts` | Express factory, routes, SSE, auth middleware, static serving |
| `src/web/auth.ts` | Better Auth instance and Express adapter |
| `src/shared/types.ts` | DTOs shared by the API and WebUI |
| `src/modules/settings/index.ts` | Typed settings, defaults, encryption, public DTOs |
| `src/modules/setup/onboarding.ts` | Bot invite, one-time streamer invite, auto-join, fallback watcher |
| `src/modules/setup/invite.ts` | Bot OAuth2 invite URL and required permissions |
| `web/src/App.tsx` | Router and application shell |
| `web/src/components/` | Design system primitives and shell |
| `web/src/routes/` | Dashboard, Channels, IPTV, Media, Media sources, Discord, Logs, Settings, Setup, Login |
| `web/src/lib/api.ts` | Typed fetch wrapper and API helpers |
| `web/src/lib/sse.ts` | EventSource hooks for playback and logs |
| `test/api/app.test.ts` | Express app tests with a temporary SQLite database |
| `test/e2e/` | Playwright tests (see the test section) |

## How it works

### Request flow

```
Browser -> Express
  /api/health             public
  /api/auth/*             Better Auth handler plus config and enable routes
  /api/*                  session middleware when auth is enabled
  /api/events             SSE: playback, sources, discord, media, queue, history, settings
  /api/logs/stream        SSE: log lines
  everything else         web/dist SPA, with history fallback
```

`createApp` is a factory. It takes the database, settings, IPTV, playback, media, Discord, event emitter, and auth adapter. Tests construct the same services against a temporary database.

### Settings

`SettingsService` loads one JSON row per section from the `settings` table, merges defaults, and validates with Zod. Updates write only the changed sections and emit a `settings` event. Discord tokens stay in settings. Media source tokens are encrypted in `media_sources`; the public DTO returns `tokenSet` and `tokenLast4`, never the token.

### Authentication

Better Auth is created at boot even when auth is disabled, so enabling it does not require a restart. The username plugin is used with a single admin. The synthetic email address required by Better Auth is never shown in the UI.

- `GET /api/auth/config` returns `enabled` and `hasUser`.
- `POST /api/auth/enable` creates the first admin or enables auth for an existing user.
- `POST /api/auth/disable` requires a valid session.
- `GET /api/auth/session` returns the current user or null.
- `POST /api/auth/login` and `POST /api/auth/logout` wrap the Better Auth username sign-in and sign-out APIs for the SPA.
- Better Auth also handles its own routes under `/api/auth/*`.
- The session cookie is HttpOnly, SameSite=Lax, and lasts seven days.

The adapter is built with the public URL and trusted origins present at boot. Changing those values requires a restart. The default empty base URL derives the origin from the request, which works for same-origin LAN access.

### SSE

`/api/events` sends an initial snapshot for playback, sources, Discord, media, queue, and history, then forwards `playback`, `sources`, `discord`, `media`, `queue`, `history`, and `settings` events. Voice state changes in the active stream channel re-emit `playback`, so the Dashboard viewer list updates when someone joins or leaves. `/api/logs/stream` sends the last 200 lines and then forwards new lines. Both endpoints send a comment heartbeat every 20 seconds and clean up listeners on close. When auth is enabled, the session middleware protects both.

### Origin checks and dev proxy

Mutations check the `Origin` header. Same-origin requests pass. In non-production, localhost origins pass so the Vite dev server on port 5173 can proxy to the API on 3000. Additional origins come from `settings.ui.trustedOrigins`. Health and auth routes are exempt.

### Settings application

`PATCH /api/settings` reloads the playback stream settings, applies the timezone to `process.env.TZ`, and reconfigures the logger level. Discord token changes validate both tokens first, then save and reconnect. Media source changes rebuild that source's provider and proxy. `POST /api/settings/recent-voice-channels` stores up to three recent playback channels in `settings.ui.recentVoiceChannels` for the voice prompt.

### Discord onboarding

The Discord page handles the full invitation flow:

1. `GET /api/discord/status` includes `botInviteUrl` when the bot token is stored and the application ID is known.
2. The user opens the invite URL, picks a server, and authorizes the bot with the requested permissions.
3. `DiscordService` sees `guildCreate`, registers the slash commands, and starts `StreamerOnboarding` for that guild.
4. The onboarding controller creates a one-time invite with the bot client and accepts it with the self-bot token.
5. A 20 second poll confirms the join. `streamerJoin` reports `joining`, `joined`, `partial`, or `error` in the status payload.
6. When Discord blocks the automatic join (verification or onboarding), the status carries `fallbackInviteUrl` and a one-hour watcher marks the guild joined once the user accepts it manually.

`POST /api/discord/streamer/join` retries one guild (`{"guildId": "..."}`) or every guild (empty body). It returns `202` with the current status; the page polls every two seconds while `streamerJoin.state` is `joining`. The endpoint returns `409` when the bot or streamer is offline.

The status payload never contains tokens. `streamerGuildIds` lists the guilds the streaming account is in, and `guildReady` in `/api/setup/status` is true only when the streaming account is in every guild the bot is in.

### Media routes

| Route | Purpose |
|---|---|
| `GET /api/media/sources` | List configured sources with connection state |
| `POST /api/media/sources/order` | Save the WebUI source tab order |
| `POST /api/media/sources` | Add a Plex or Jellyfin source and validate it |
| `PATCH /api/media/sources/:id` | Update connection, timers, or channel settings |
| `DELETE /api/media/sources/:id` | Remove a source, its libraries, and queue entries |
| `POST /api/media/sources/:id/validate` | Re-test the saved connection |
| `GET /api/media/sources/:id/libraries` | List libraries |
| `PATCH /api/media/sources/:id/libraries/:key` | Enable or disable a library |
| `GET /api/media/sources/:id/items` | Browse or search one source. Library browse accepts `start` and `size` (max 200 per request) and returns `{ items, total, start, size }`. The WebUI walks every page up to 5,000 items, then reveals 60 at a time. |
| `GET /api/media/items/:sourceId/:itemId` | Item detail with streams |
| `GET /api/media/items/:sourceId/:itemId/children` | Seasons or episodes |
| `GET /api/media/thumb/:sourceId/:itemId` | Server-side thumbnail proxy |
| `GET /api/media/queue` | Global queue |
| `GET /api/media/playback/item` | Active item with its streams |
| `POST /api/media/playback/subtitle` | Switch the active subtitle track |
| `GET /api/media/history` | Resumable playback history, newest first |
| `DELETE /api/media/history/:id` | Remove one resume entry |
| `POST /api/media/queue` | Add a movie or episode |
| `POST /api/media/queue/season`, `/show` | Expand a season or show |
| `POST /api/media/queue/:id/play` | Start a queued item |
| `POST /api/media/play` | Add and start an item |
| `POST /api/media/sources/:id/placeholder` | Open a source's virtual channel |
| `GET /api/channels/media` | Virtual channels for enabled sources |

The old `/api/plex/*` and `/api/queue` aliases were removed. The WebUI uses the media routes only.

### WebUI behavior

- The shell uses an 80px icon rail from 768px to 1023px, a 240px extended rail at 1024px and wider, and a drawer below 768px. Navigation is grouped into Watch (Dashboard, Media, Channels, IPTV) and System (Discord, Logs, Settings), with a 64px top app bar and a persistent now-playing mini player on desktop and mobile. The mobile mini player is a safe-area bottom bar and reserves body scroll padding so it never covers the last control.
- When auth is enabled, the shell waits for `/api/auth/session` and redirects unauthenticated visitors to `/login`, preserving the intended path. The login page redirects back after sign-in. When auth is disabled, the login page redirects home.
- Settings uses a sticky Configuration rail on desktop (Streaming, Sources, General, Security) with the active panel beside it. Below 768px the rail hides and the sections stack. Deep links such as `#auth` select Security, and validation jumps to the section with errors.
- Channels and tables use semantic tables and container queries. Tables stack below 600px.
- Confirmation dialogs use native `<dialog>` with `showModal()`. There is no manual focus trap and no `role="dialog"`.
- Media source add, edit, library toggles, and removal are inline on `/media/sources`, not dialogs. The playback voice prompt and destructive playback confirmations still use dialogs.
- Toasts use `popover="manual"` and dismiss themselves after 6 seconds (10 seconds for errors). The dismiss button removes one immediately. Do not add hover-pause: toasts often appear under the pointer after a bottom-right action, which would keep them on screen. Inline errors are used for forms.
- The queue is closed by default. Below 1280px it opens as a native right sheet with focus containment, Escape dismissal, and focus return to the Queue button. At 1280px and wider it is a sticky column beside the library.
- The queue uses move up and move down buttons for keyboard access; drag is an enhancement. Clear removes queued, played, and failed rows but keeps the active playback row.
- The queue panel always shows Autoplay next episode and Skip intros switches. Both write `settings.playback`. While media is playing it also shows a subtitle picker that posts to `/api/media/playback/subtitle`. The Dashboard playback card shows the same picker.
- The media progress bar is a seek control. Dragging it restarts the provider transcode at the chosen offset through `POST /api/playback/seek`.
- An episode detail page links its series name, and the breadcrumb links the show, to the show view. The link works when the item was opened from history and has no show key in the URL.
- A season detail page has a Play this season action beside the poster. It uses the same voice channel prompt as Play now, queues the whole season through `POST /api/media/queue/season`, then starts episode 1. The remaining episodes stay queued in provider order.
- The playback voice prompt shows up to three recently selected channels under Last selected and preselects the most recent one. Starting playback saves the channel through `POST /api/settings/recent-voice-channels`; duplicates are removed and the list is capped at three.
- The Media page selects a source with a tab strip, not a dropdown. The first tab is selected by default. Drag a tab to reorder it, use the arrow buttons beside the tabs, or focus a tab and press Alt plus Left or Right Arrow. The order is stored in `settings.ui.mediaSourceOrder`.
- The library grid reveals 60 items at a time with Load more. The client walks the paginated items endpoint up to 5,000 items, so a large library is not silently truncated at the old 200-item page cap. Provider search is still limited by the adapter search cap.
- `/media/sources` is the Plex and Jellyfin management page. Add, edit, test, remove, and enable libraries inline. Source forms and library toggles are page sections, not dialogs. The Media nav item stays active there.
- `/plex` redirects to `/media/sources`.
- The Dashboard shows a Continue watching card when resumable media exists. Each row links to `/media?source=<id>&item=<id>&play=1`; the media page opens that item and the voice channel prompt automatically.
- The Dashboard playback card lists the non-bot members in the stream voice channel under Watching now, excluding the streaming account. Names come from the self-bot voice state cache. The current viewer count sits next to the playback status chip, and the persistent now-playing card, rail, and mobile bar carry the same count on every page.
- The Media page puts Continue watching above the library tabs. Resume starts playback from the saved position; opening the row shows the item detail. Each saved row can be removed from the list. A completed episode adds an Up next recommendation for the next episode, which starts from the beginning and cannot be removed.
- An item detail page with saved progress labels the primary action `Resume from <time>` and adds Start over.
- Every page has one `<h1>`, a skip link, landmarks, visible focus, and labeled controls.

## Gotchas and invariants

- **Auth adapter lifetime:** `baseURL` and `trustedOrigins` are fixed when the adapter is created. A public URL change needs a restart. Do not remove this note without making the adapter rebuild dynamically.
- **Auth enable guard:** `PATCH /api/settings` refuses to enable auth when no user exists. Use the auth enable route so the first admin is created. Disabling auth is allowed from settings.
- **Token fields are write-only:** A missing token field keeps the current token. An empty string clears it. Never return decrypted values from a route.
- **Static path:** Express serves `web/dist` relative to `process.cwd()`. The Docker image copies it to `/app/web/dist`. In development, Vite serves the app and proxies `/api`.
- **SPA fallback:** The fallback only handles GET requests outside `/api`. Missing builds return a 404 with the build command.
- **Media items page:** `GET /api/media/sources/:id/items` returns `{ items, total, start, size }`. The 200 value is a per-request page size, not a library cap. The WebUI also accepts the legacy bare array while an older server is running. Do not reintroduce a total-item cap.
- **Test mode:** `--test-mode` skips Discord login, IPTV refresh, and media validation. Playwright uses it. It does not fake playback.
- **CSP:** Helmet allows same-origin scripts and styles, data/blob images, and same-origin connections. A new external image or font host needs a CSP change.
- **Redaction:** Do not log full source, transcode, or media URLs. Use `redactSecrets`.

## Related docs

- [Media sources](media.md) - Plex and Jellyfin routes, proxy, queue, and resume behavior
- [IPTV](iptv.md) - source and channel data behind the WebUI
- [Database](database.md) - settings and auth tables
- [Operations](operations.md) - deployment, auth recovery, and data
