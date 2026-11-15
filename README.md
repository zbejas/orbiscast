# OrbisCast

[![GitHub build status](https://img.shields.io/github/actions/workflow/status/zbejas/orbiscast/master.yml?label=master%20build)](https://github.com/zbejas/orbiscast/actions/workflows/master.yml)
[![GitHub last commit](https://img.shields.io/github/last-commit/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/commits/master)
[![GitHub issues](https://img.shields.io/github/issues/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/pulls)
[![GitHub license](https://img.shields.io/github/license/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/blob/master/LICENSE.md)
[![Release](https://img.shields.io/github/v/release/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/releases)
[![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/zbejas/orbiscast?sort=date)](https://hub.docker.com/r/zbejas/orbiscast)
[![Docker Pulls](https://img.shields.io/docker/pulls/zbejas/orbiscast)](https://hub.docker.com/r/zbejas/orbiscast)

OrbisCast streams IPTV channels and on-demand Plex media into Discord voice channels. A browser-based WebUI manages the bot, IPTV sources, channel visibility, the EPG, Plex, Discord permissions, streaming settings, and logs. Configuration lives in SQLite, not in environment variables.

The Plex integration adds a virtual on-demand channel. When selected in Discord it joins the voice channel and loops a branded placeholder. Playback starts only when someone picks a movie or episode in the WebUI. The queue is managed in the WebUI, with play, pause, resume, stop, skip, reorder, shuffle, and clear.

> [!CAUTION]
> Self-bots violate Discord's Terms of Service and can get an account banned. Use a secondary account and accept the risk. Never commit real tokens. The WebUI encrypts Discord and Plex tokens at rest, but the host and the `data/` volume still need protection.

> [!NOTE]
> This project streams content you are allowed to access. You are responsible for complying with copyright law and your IPTV or Plex provider's terms.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 22.12 or newer | Better Auth is ESM-only and needs `require(esm)` support. |
| FFmpeg on `PATH` | Must include `libzmq` for the `azmq` audio filter used by the streaming library. Debian's `ffmpeg` package includes it. Static builds bundled with `node-av` do not. |
| A Discord bot token and a Discord user token | The bot exposes slash commands. The user token performs the actual voice stream. |
| An IPTV M3U playlist | One or more sources. XMLTV is optional. |
| A Plex server and token | Optional. Required only for Plex on-demand playback. |
| A recent glibc for Docker | `node-datachannel` needs GLIBC 2.38+. The provided image uses `node:22-trixie-slim`. |

## Quick start with Docker

```bash
git clone https://github.com/zbejas/orbiscast
cd orbiscast
docker compose up -d
```

Open `http://localhost:3000` or `http://<host-ip>:3000` and follow the setup checklist:

1. Save your Discord bot token and user token. The bot and streamer status turn green when both log in.
2. Add an IPTV source. Paste the M3U URL and, optionally, an XMLTV URL.
3. Pick which channels are visible. New sources start with every channel hidden.
4. Configure Plex if you want on-demand playback. Enter the server URL and token, then enable the libraries you want to browse.
5. Optionally enable WebUI auth in Settings.

All data lives in `./data` on the host, mounted at `/app/data` in the container. The SQLite database, encryption keys, logs, cache, and generated placeholder clip live there.

### Upgrading from an env-based install

Older versions read `.env`. The new version imports that file once and then ignores it:

- Docker: place the old `.env` at `./data/.env` before the first start. Remove it after the import is logged.
- Manual: keep `.env` in the project root for the first start, then delete it.

The import maps `PLAYLIST`, `XMLTV`, `REFRESH_IPTV`, the Discord tokens, streaming settings, `DEBUG`, and `TZ`. `GUILD` is ignored because commands are registered in every guild the bot joins. `RAM_CACHE`, `CACHE_DIR`, and `OPENVPN_*` are ignored. The Discord and Plex tokens are encrypted immediately.

## Manual install

```bash
git clone https://github.com/zbejas/orbiscast
cd orbiscast
npm ci
npm run build
npm run start:prod
```

The WebUI and API listen on port `3000`. `PORT` is an optional override; everything else is configured in the browser.

For development:

```bash
npm run dev
```

This starts the API on `3000` and Vite on `5173`. Open `http://localhost:5173`. Vite proxies `/api` to the API process.

## Discord commands

Commands are registered in every guild the bot joins. The per-guild role allowlist protects all commands. An empty allowlist means only members with Manage Server or Administrator can use commands. Members with Manage Server always bypass the allowlist.

| Command | Description |
|---|---|
| `/stream <channel>` | Stream a visible IPTV channel, or select the Plex on-demand channel to show its placeholder. |
| `/stop` | Stop the current stream. |
| `/channels [page]` | List visible channels and the Plex channel. |
| `/programme <channel>` | Show the programme guide for a channel. |
| `/refresh <type>` | Refresh every IPTV source. |

The Plex channel is not a separate command. It appears in `/channels` and in the `/stream` autocomplete using the name set in Plex settings.

## IPTV sources and channels

- A source pairs one M3U playlist with an optional XMLTV guide and refreshes both together.
- New sources start with every channel hidden. Use the Channels page to search, filter by group, and select what should appear in Discord.
- Visibility survives source refreshes. A failed refresh keeps the last good channels and guide.
- The Guide page renders a scrollable timeline for visible channels. The timezone is configured in Settings.

## Plex on demand

1. Set the Plex server URL and token in the Plex page or Settings. OrbisCast validates the connection and lists libraries.
2. Enable the libraries you want to browse.
3. Select the Plex channel in Discord. The streamer joins your voice channel and loops the placeholder.
4. In the WebUI Plex page, browse or search, choose a movie or episode, set the quality and subtitle track, and add it to the queue.
5. Press Play and choose the guild and voice channel. The placeholder is replaced by the Plex stream.

Behavior details:

- One self-bot means one stream. Starting a new real playback while IPTV or Plex is active is rejected. Stop the current stream first.
- The placeholder is an idle state, not a stream. Starting real playback replaces it.
- The placeholder leaves after the configured idle timeout (default 5 minutes), or after the configured grace period when the voice channel is empty (default 30 seconds).
- Plex transcodes on the server. Quality presets are 720p 4 Mbps, 1080p 8 Mbps (default), 1080p 12 Mbps, and 4K 20 Mbps. The quality is chosen per play in the WebUI.
- Subtitles are burned in. Auto picks the Plex default track, then a forced track, then the first track that Plex can burn. The WebUI dropdown lets you choose Off or a specific burnable track. Image subtitle tracks without a stream index cannot be burned and are shown as unavailable.
- Pause freezes the Discord stream without ending it. The voice connection and Plex session stay open, so viewers stay connected to a still image. Resume continues the same stream. Stop and skip stop the transcode.
- When the queue ends, OrbisCast stops playback and leaves the voice channel.
- Thumbnails are proxied through the WebUI so the Plex token never reaches the browser.

## Configuration

There are no required environment variables. The only optional variable is:

| Variable | Purpose |
|---|---|
| `PORT` | Override the HTTP port. Default `3000`. |

Application settings live in SQLite:

```
data/
  orbiscast.db
  keys.json          # AES-GCM key and Better Auth secret, mode 0600
  logs/app.log
  cache/
```

`data/keys.json` is required to decrypt saved provider tokens. Back it up with the database. Losing it means re-entering the Discord and Plex tokens. Treat the whole directory as secret.

### WebUI auth

Auth is off by default. To enable it, open Settings, choose a username and password, and save. Auth uses Better Auth with a single admin account and a seven-day session cookie.

- If auth is enabled and you lose the password, run `npm run admin -- auth reset <username> <password>` on the host.
- To turn auth off from the host, run `npm run admin -- auth disable`.
- Behind a reverse proxy, set the public URL in Settings before enabling auth. Changing it requires a restart.
- Auth is not a substitute for network isolation. If the WebUI is reachable from the internet, put it behind HTTPS and enable auth.

## Updating

Pull the new image or code, keep the `data/` volume, and restart. Database migrations run automatically on boot. Back up `data/` before a major version change.

## Troubleshooting

| Symptom | Check |
|---|---|
| The bot is online but the streamer is not | The user token is invalid or the account is logged out. Generate a fresh token and save it in Discord settings. |
| The bot joins voice but no video | FFmpeg is missing `libzmq`, or another process on the same host uses port `42069`. Only one OrbisCast stream can run on a host. In Docker, do not expose `42069`. |
| The streamer cannot join the voice channel | The self-bot account must be a member of the guild and have permission to join that voice channel. |
| A Plex item fails with a 400 | The Plex server rejected the transcode. Check that the Plex transcoder is enabled, the file is readable, and the chosen subtitle track is burnable. Try another quality or turn subtitles off. |
| Plex metadata works but playback fails | Plex transcoding can fail on unsupported files or under load. Check the Plex server logs and try a lower quality. |
| No channels in Discord | Channels are hidden by default. Open Channels and select the ones you want. |
| Source refresh fails | Check the source URL and credentials. The last good channels and guide stay available. |
| Auth lockout | Use the admin CLI commands above. |
| Port 3000 is taken | Set `PORT` or change the Docker port mapping. |

## Development

```bash
npm run typecheck       # server and WebUI
npm test                # unit and API tests
npm run build           # server and WebUI
npm run test:e2e        # Playwright
```

The server is TypeScript compiled to CommonJS. The WebUI is a React SPA built with Vite. The API is Express. See [AGENTS.md](AGENTS.md) for the architecture and [docs/](docs/README.md) for subsystem docs.

## License

GPL-3.0. See [LICENSE.md](LICENSE.md).
