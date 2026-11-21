# Operations

## Overview

OrbisCast runs as one Node process that serves the WebUI, the API, the Discord clients, the IPTV schedulers, and Plex or Jellyfin playback. Docker is the supported deployment. All state lives in a single data directory, so backup and recovery are file operations plus a small admin CLI for auth lockout.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Boot, flags, service construction, graceful shutdown |
| `src/cli/admin.ts` | Auth status, disable, and password reset |
| `Dockerfile` | Two-stage build and runtime image |
| `compose.yml` | Port, volume, and restart policy |
| `data/` | Database, keys, logs, and cache (not committed) |
| `drizzle/` | Migrations applied on boot |

## How it works

### Boot flags

```bash
npm start                                   # tsx src/index.ts, data/ in the working directory
node dist/index.js --port 3000              # compiled server
node dist/index.js --data-dir /srv/orbiscast
node dist/index.js --test-mode              # no Discord, IPTV refresh, or media validation
```

- `PORT` is the only environment override. `--port` wins.
- `--data-dir` defaults to `./data`.
- `--test-mode` is for tests and UI work. It does not fake playback.

### Data directory

```
data/
  orbiscast.db        SQLite database, plus -wal and -shm while running
  keys.json           AES-256-GCM key and Better Auth secret, mode 0600
  logs/app.log        Winston log, rotated at 10 MB, five files kept
  cache/              IPTV downloads and the generated media placeholder clip
```

`keys.json` is created on first boot. Losing it makes stored Discord and media server tokens unrecoverable. Back up the whole directory, not just the database.

### Docker

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

```yaml
services:
  orbiscast:
    image: docker.io/zbejas/orbiscast:latest
    container_name: orbiscast
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
```

- No `env_file` is needed. Configure everything in the WebUI.
- Put a legacy `.env` at `./data/.env` before the first start to import it once. Delete it after the import is logged.
- The image uses `node:22-trixie-slim`, because `node-datachannel` needs GLIBC 2.38 or newer.
- FFmpeg comes from the Debian package so the `azmq` audio filter is present.
- The health check calls `/api/health`.

### Updating

1. Back up `data/`.
2. Pull the new image or code.
3. Restart. Migrations run on boot.

A failed migration leaves the old database intact because Drizzle wraps each migration. Restore the backup if the process does not start.

### Resource limits

- Only one real stream can run. One self-bot can join only one voice channel.
- Plex and Jellyfin transcoding use the media server's CPU or GPU, not the OrbisCast container.
- A large IPTV playlist can use noticeable memory while parsing and writing. The download cap is 50 MB.

### Logs

- `docker compose logs -f` shows console output.
- `data/logs/app.log` keeps the rotating file.
- The WebUI Logs page reads the in-memory ring buffer and streams new lines over SSE.
- Secrets are redacted. Do not add raw tokens or transcode URLs to new log lines.

### Auth recovery

Auth is off by default. When enabled and the password is lost:

```bash
docker compose exec orbiscast node dist/cli/admin.js auth status
docker compose exec orbiscast node dist/cli/admin.js auth disable
docker compose exec orbiscast node dist/cli/admin.js auth reset <username> <password>
```

For a manual install:

```bash
npm run admin -- auth status
npm run admin -- auth disable
npm run admin -- auth reset <username> <password>
npm run admin -- auth status --data-dir=/srv/orbiscast
```

`auth reset` deletes the user's sessions and account rows, recreates the user, and leaves auth enabled. `auth disable` reopens the WebUI without deleting the account.

### Reverse proxy

- Set the public URL in Settings before enabling auth behind a proxy.
- The session cookie is HttpOnly, SameSite=Lax, and Secure when served over HTTPS.
- The SSE endpoints need proxy buffering disabled. The API already sends `X-Accel-Buffering: no`.
- Do not expose the API without HTTPS if it is reachable from the internet.

### Shutdown

`SIGTERM` and `SIGINT` stop IPTV timers, stop playback, destroy the bot client, close the streamer with `destroy()` (never `logout()`), close the HTTP server, and close SQLite. Docker sends `SIGTERM` on `stop`.

## Gotchas and invariants

- **ZMQ port 42069 is process-wide.** `discord-video-stream` binds it for volume control. Only one OrbisCast stream can run per host. Do not expose the port. Run the app in its own container when another service uses 42069.
- **FFmpeg needs libzmq.** A static FFmpeg without it fails at `azmq` with `No such filter`.
- **Do not call `logout()` on the self-bot.** It revokes the user token. Use the shutdown path, which calls `destroy()`.
- **One token set at a time.** Editing Discord tokens reconnects both clients. Do not run a second instance with the same tokens.
- **The data volume is secret.** It contains encrypted provider tokens, the encryption key, source URLs, and session data.
- **WAL files belong to the database.** Copy the whole data directory or stop the app first.
- **The placeholder clip is generated.** The first media placeholder start runs FFmpeg and may take a few seconds.
- **Test mode is not a sandbox.** It skips external clients but still writes to the data directory you pass.

## Related docs

- [WebUI and API](webui.md) - routes, auth, and SSE
- [Database](database.md) - schema and migrations
- [Media sources](media.md) - provider transcode sessions and proxy
- [IPTV](iptv.md) - source refresh and cache
