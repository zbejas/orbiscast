# WebUI and API

## Overview

The WebUI is a React single-page app served by the same Express process that runs the bot. It replaces environment files and JSON databases with a SQLite-backed settings model, a channel curation table, an EPG timeline, Plex browsing, a playback queue, Discord permissions, and live logs. Authentication is optional and off by default.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Boot sequence, service construction, HTTP listener, shutdown |
| `src/runtime.ts` | Process-wide service container for command modules |
| `src/web/app.ts` | Express factory, routes, SSE, auth middleware, static serving |
| `src/web/auth.ts` | Better Auth instance and Express adapter |
| `src/shared/types.ts` | DTOs shared by the API and WebUI |
| `src/modules/settings/index.ts` | Typed settings, defaults, encryption, public DTOs |
| `web/src/App.tsx` | Router and application shell |
| `web/src/components/` | Design system primitives and shell |
| `web/src/routes/` | Dashboard, Channels, Guide, Plex, Sources, Discord, Logs, Settings, Setup, Login |
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
  /api/events             SSE: playback, sources, discord, queue, settings
  /api/logs/stream        SSE: log lines
  everything else         web/dist SPA, with history fallback
```

`createApp` is a factory. It takes the database, settings, IPTV, playback, Plex, Discord, event emitter, and auth adapter. Tests construct the same services against a temporary database.

### Settings

`SettingsService` loads one JSON row per section from the `settings` table, merges defaults, and validates with Zod. Updates write only the changed sections and emit a `settings` event. Discord and Plex tokens are encrypted before the row is written; the public DTO returns `tokenSet` and `tokenLast4`, never the token.

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

`/api/events` sends an initial snapshot for playback, sources, Discord, and queue, then forwards `playback`, `sources`, `discord`, `queue`, and `settings` events. `/api/logs/stream` sends the last 200 lines and then forwards new lines. Both endpoints send a comment heartbeat every 20 seconds and clean up listeners on close. When auth is enabled, the session middleware protects both.

### Origin checks and dev proxy

Mutations check the `Origin` header. Same-origin requests pass. In non-production, localhost origins pass so the Vite dev server on port 5173 can proxy to the API on 3000. Additional origins come from `settings.ui.trustedOrigins`. Health and auth routes are exempt.

### Settings application

`PATCH /api/settings` reloads the playback stream settings, applies the timezone to `process.env.TZ`, and reconfigures the logger level. Discord token changes validate both tokens first, then save and reconnect. Plex server or token changes rebuild the Plex client and proxy.

### WebUI behavior

- The shell uses a 240px sidebar at 1024px and wider, an icon rail from 768px to 1023px, and a drawer below 768px.
- When auth is enabled, the shell waits for `/api/auth/session` and redirects unauthenticated visitors to `/login`, preserving the intended path. The login page redirects back after sign-in. When auth is disabled, the login page redirects home.
- Channels and tables use semantic tables and container queries. Tables stack below 600px.
- Confirmation dialogs use native `<dialog>` with `showModal()`. There is no manual focus trap and no `role="dialog"`.
- Toasts use `popover="manual"` and remain until dismissed. Inline errors are used for forms.
- The queue uses move up and move down buttons for keyboard access; drag is an enhancement.
- Every page has one `<h1>`, a skip link, landmarks, visible focus, and labeled controls.

## Gotchas and invariants

- **Auth adapter lifetime:** `baseURL` and `trustedOrigins` are fixed when the adapter is created. A public URL change needs a restart. Do not remove this note without making the adapter rebuild dynamically.
- **Auth enable guard:** `PATCH /api/settings` refuses to enable auth when no user exists. Use the auth enable route so the first admin is created. Disabling auth is allowed from settings.
- **Token fields are write-only:** A missing token field keeps the current token. An empty string clears it. Never return decrypted values from a route.
- **Static path:** Express serves `web/dist` relative to `process.cwd()`. The Docker image copies it to `/app/web/dist`. In development, Vite serves the app and proxies `/api`.
- **SPA fallback:** The fallback only handles GET requests outside `/api`. Missing builds return a 404 with the build command.
- **Test mode:** `--test-mode` skips Discord login, IPTV refresh, and Plex validation. Playwright uses it. It does not fake playback.
- **CSP:** Helmet allows same-origin scripts and styles, data/blob images, and same-origin connections. A new external image or font host needs a CSP change.
- **Redaction:** Do not log full source, transcode, or media URLs. Use `redactSecrets`.

## Related docs

- [Plex](plex.md) - Plex routes, proxy, and queue behavior
- [IPTV](iptv.md) - source and channel data behind the WebUI
- [Database](database.md) - settings and auth tables
- [Operations](operations.md) - deployment, auth recovery, and data
