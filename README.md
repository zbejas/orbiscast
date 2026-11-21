# OrbisCast

[![GitHub build status](https://img.shields.io/github/actions/workflow/status/zbejas/orbiscast/master.yml?label=master%20build)](https://github.com/zbejas/orbiscast/actions/workflows/master.yml)
[![GitHub last commit](https://img.shields.io/github/last-commit/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/commits/master)
[![GitHub issues](https://img.shields.io/github/issues/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/pulls)
[![GitHub license](https://img.shields.io/github/license/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/blob/master/LICENSE.md)
[![Release](https://img.shields.io/github/v/release/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/releases)
[![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/zbejas/orbiscast?sort=date)](https://hub.docker.com/r/zbejas/orbiscast)
[![Docker Pulls](https://img.shields.io/docker/pulls/zbejas/orbiscast)](https://hub.docker.com/r/zbejas/orbiscast)

OrbisCast streams IPTV channels and on-demand Plex or Jellyfin media into Discord voice channels. A browser-based WebUI manages the bot, IPTV sources, channel visibility, the EPG, media sources, Discord permissions, streaming settings, and logs. Configuration lives in SQLite, not in environment variables.

Each media source adds a virtual on-demand channel. When selected in Discord it joins the voice channel and loops a branded placeholder. Playback starts only when someone picks a movie or episode in the WebUI. One queue can mix Plex and Jellyfin items, with play, pause, resume, stop, skip, reorder, shuffle, and clear. OrbisCast saves playback progress, so the Dashboard and Media page offer Continue watching with Resume from the last position. When an episode is finished, it recommends the next episode of that series.

> [!CAUTION]
> Self-bots violate Discord's Terms of Service and can get an account banned. Use a secondary account and accept the risk. Never commit real tokens. The WebUI encrypts Discord and media server tokens at rest, but the host and the `data/` volume still need protection.

> [!NOTE]
> This project streams content you are allowed to access. You are responsible for complying with copyright law and your IPTV or Plex provider's terms.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 22.12 or newer | Better Auth is ESM-only and needs `require(esm)` support. |
| FFmpeg on `PATH` | Must include `libzmq` for the `azmq` audio filter used by the streaming library. Debian's `ffmpeg` package includes it. Static builds bundled with `node-av` do not. |
| A Discord bot token and a Discord user token | The bot exposes slash commands. The user token performs the actual voice stream. |
| An IPTV M3U playlist | One or more sources. XMLTV is optional. |
| A Plex server and token, or a Jellyfin server and API key | Optional. Required only for on-demand playback from that source. |
| A recent glibc for Docker | `node-datachannel` needs GLIBC 2.38+. The provided image uses `node:22-trixie-slim`. |

## Quick start with Docker

```bash
git clone https://github.com/zbejas/orbiscast
cd orbiscast
docker compose up -d
```

Open `http://localhost:3000` or `http://<host-ip>:3000` and follow the setup checklist:

1. Save your Discord bot token and user token, then add the bot to your server from the Discord page. The bot creates a one-time invite and the streaming account joins automatically. The connection cards turn green when both clients log in.
2. Add an IPTV source. Paste the M3U URL and, optionally, an XMLTV URL.
3. Pick which channels are visible. New sources start with every channel hidden.
4. Add a Plex or Jellyfin source on the Media sources page if you want on-demand playback. Enter the server URL and token or API key, then enable the libraries you want to browse.
5. Optionally enable WebUI auth in Settings.

All data lives in `./data` on the host, mounted at `/app/data` in the container. The SQLite database, encryption keys, logs, cache, and generated placeholder clip live there.

### Upgrading from an env-based install

Older versions read `.env`. The new version imports that file once and then ignores it:

- Docker: place the old `.env` at `./data/.env` before the first start. Remove it after the import is logged.
- Manual: keep `.env` in the project root for the first start, then delete it.

The import maps `PLAYLIST`, `XMLTV`, `REFRESH_IPTV`, the Discord tokens, streaming settings, `DEBUG`, and `TZ`. `GUILD` is ignored because commands are registered in every guild the bot joins. `RAM_CACHE`, `CACHE_DIR`, and `OPENVPN_*` are ignored. The Discord and media server tokens are encrypted immediately.

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
| `/stream <channel>` | Stream a visible IPTV channel, or select a media on-demand channel to show its placeholder. |
| `/stop` | Stop the current stream. |
| `/channels [page]` | List visible channels and every media on-demand channel. |
| `/programme <channel>` | Show the programme guide for a channel. |
| `/refresh <type>` | Refresh every IPTV source. |

Media channels are not separate commands. Each appears in `/channels` and in the `/stream` autocomplete using the channel name saved on its source.

## IPTV sources and channels

- A source pairs one M3U playlist with an optional XMLTV guide and refreshes both together.
- New sources start with every channel hidden. Use the Channels page to search, filter by group, and select what should appear in Discord.
- Visibility survives source refreshes. A failed refresh keeps the last good channels and guide.
- The Guide tab on the IPTV page renders a scrollable timeline for visible channels. The timezone is configured in Settings.

## Media on demand

1. Open the Media sources page from the Media tab and add a source. Choose Plex or Jellyfin, enter the server URL, and paste a Plex token or Jellyfin API key.
2. OrbisCast validates the connection and lists libraries. Enable the movie and TV show libraries you want to browse.
3. Select the source's virtual channel in Discord. The streamer joins your voice channel and loops the placeholder.
4. In the WebUI Media page, browse or search, choose a movie or episode, set the quality and subtitle track, and add it to the queue.
5. Press Play and choose the guild and voice channel. The placeholder is replaced by the selected source's stream.

Behavior details:

- One self-bot means one stream. Starting a new real playback while IPTV or media is active is rejected. Stop the current stream first.
- The placeholder is an idle state, not a stream. Starting real playback replaces it.
- The placeholder leaves after the configured idle timeout (default 5 minutes), or after the configured grace period when the voice channel is empty (default 30 seconds).
- Plex and Jellyfin transcode on the server. Quality presets are 720p 4 Mbps, 1080p 8 Mbps (default), 1080p 12 Mbps, and 4K 20 Mbps. The quality is chosen per play in the WebUI.
- Subtitles are burned in. Auto picks the default track, then a forced track, then the first track the server can burn. You can switch the track from the queue panel while playback continues. Image subtitle tracks work when the server supports them.
- Pause shows Discord's paused state and suspends the encoder. Resume continues the same stream. Seek replaces the provider transcode at the chosen offset without recreating the Discord stream.
- Stopping removes the current item from the queue and saves its position. Stopping or skipping at 85 percent or later marks the item watched.
- The queue panel has Autoplay next episode, which continues a series when an episode ends, and Skip intros, which jumps past Plex intro markers.
- When the queue ends, OrbisCast stops playback and leaves the voice channel.
- Thumbnails are proxied through the WebUI so provider tokens never reach the browser.

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

`data/keys.json` is required to decrypt saved provider tokens. Back it up with the database. Losing it means re-entering the Discord and media server tokens. Treat the whole directory as secret.

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
| A media item fails with a 400 | The Plex or Jellyfin server rejected the transcode. Check that server transcoding is enabled, the file is readable, and the chosen subtitle track is burnable. Try another quality or turn subtitles off. |
| Metadata works but playback fails | Provider transcoding can fail on unsupported files or under load. Check the Plex or Jellyfin logs and try a lower quality. |
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
