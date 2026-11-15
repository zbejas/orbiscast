# Plex

## Overview

OrbisCast treats Plex as an on-demand source. The Plex virtual channel appears in Discord next to IPTV channels, but selecting it only joins voice and plays a branded placeholder. Real content starts from the WebUI queue. Plex transcodes on the server, and FFmpeg reads the HLS stream through a loopback proxy that adds the Plex headers and token.

## Key files

| File | Purpose |
|---|---|
| `src/modules/plex/client.ts` | Plex Media Server HTTP client and response normalization |
| `src/modules/plex/types.ts` | Normalized Plex models |
| `src/modules/plex/transcode.ts` | Quality presets, subtitle choice, HLS URL construction |
| `src/modules/plex/proxy.ts` | Loopback proxy that injects Plex headers and rewrites manifests |
| `src/modules/plex/service.ts` | Libraries, browsing, queue, playback, pause and resume, placeholder |
| `src/modules/playback/engine.ts` | Global playback state and exclusivity |
| `src/modules/streaming/index.ts` | Voice connection and FFmpeg pipeline |
| `assets/plex-placeholder.png` | Source image for the placeholder clip |
| `test/plex/` | Client, transcode, subtitle, and redaction tests |

## How it works

### Connection and libraries

The operator saves a server URL and token in the WebUI. `PlexClient` sends `Accept: application/json` and an `X-Plex-Token` header. On success the service syncs `/library/sections` into `plex_libraries`. Libraries start disabled; the operator enables the ones to browse. Music and photo libraries are not browsable for playback.

### Browsing

| Operation | Plex endpoint |
|---|---|
| Library page | `/library/sections/{key}/all` with container start and size |
| Search | `/search?query=` then filter by enabled library key |
| Show seasons | `/library/metadata/{show}/children` |
| Season episodes | `/library/metadata/{season}/children` |
| All show episodes | `/library/metadata/{show}/allLeaves` |
| Item detail | `/library/metadata/{ratingKey}` including `Media`, `Part`, `Stream` |
| Thumbnail | `/photo/:/transcode?url=/library/metadata/{key}/thumb&width=&height=` |

Thumbnails are fetched by the server and returned through `/api/plex/thumb/:ratingKey`. The browser never receives a Plex URL containing the token.

### Queue

The queue is global, persisted in `plex_queue_items`, and managed only in the WebUI. Items carry a quality preset and a subtitle mode.

- Supported statuses: `queued`, `playing`, `played`, `failed`.
- Adding a movie or single episode appends one item. Adding a season or show expands to episodes.
- Reorder, shuffle, remove, and clear rewrite positions.
- A queue item that fails to start or play is marked `failed` with a redacted error.
- Stop returns the current item to `queued`. Skip marks it `played`.
- On boot, stale `playing` rows return to `queued`.

### Quality presets

| Value | Resolution | Bitrate |
|---|---|---|
| `720p-4` | 1280x720 | 4000 kbps |
| `1080p-8` | 1920x1080 | 8000 kbps (default) |
| `1080p-12` | 1920x1080 | 12000 kbps |
| `4k-20` | 3840x2160 | 20000 kbps |

The preset is chosen per item when adding to the queue. Settings store the default for new items.

### Subtitles

Plex expects the **stream index** in `subtitleStreamID`, not the global stream id.

- A stream is burnable when it is a subtitle and has an integer `index` of zero or more.
- Auto prefers the default burnable track, then a forced burnable track, then the first burnable track.
- Off omits `subtitles=burn`.
- An explicit WebUI choice is the stream index. The UI shows global stream ids as values and marks tracks without an index as unavailable.
- Plex can burn image subtitles such as PGS when the track has an index. Some external tracks have no index and cannot be used.

### Transcode and proxy

`buildTranscodeUrl` builds `/video/:/transcode/universal/start.m3u8` with:

```
path=/library/metadata/{ratingKey}
mediaIndex, partIndex
protocol=hls
directPlay=0, directStream=0
subtitles=burn, subtitleStreamID, subtitleSize (only with subtitles)
videoResolution, videoBitrate, maxVideoBitrate
offset, session
X-Plex-Client-Identifier
X-Plex-Token (production) or no token (through the proxy)
```

Plex rejects a start request without its `X-Plex-*` headers. The streaming library's header option does not produce a valid request, so `PlexProxy` listens on a random loopback port and adds:

```
X-Plex-Client-Identifier, X-Plex-Product, X-Plex-Version,
X-Plex-Platform, X-Plex-Platform-Version, X-Plex-Device,
X-Plex-Device-Name, X-Plex-Model, X-Plex-Language, X-Plex-Token
```

The URL handed to FFmpeg points at the proxy and carries no token. The proxy forwards segment requests, rewrites absolute Plex URLs in HLS manifests to the proxy origin, and drops the stale `content-length` after rewriting. It listens on loopback only; do not expose the port or run untrusted processes beside a host-run instance.

`buildStopSessionUrl` calls `/video/:/transcode/universal/stop?session=`. It is called on stop, skip, natural end, error, and app shutdown.

### Pause and resume

Pause freezes the live Discord stream without ending it. OrbisCast sends a `STREAM_SET_PAUSED` gateway opcode and suspends the FFmpeg process with `SIGSTOP`, so the voice connection and Plex transcode session stay open and viewers see a still image instead of the stream ending. Resume sends `SIGCONT` and unpauses the Discord stream. The same transcode and stream continue; nothing is restarted. Stop and skip still stop the transcode.

### Placeholder

`assets/plex-placeholder.png` is a 1280x720 branded slide. On first use the service generates a six-second H.264 and AAC clip at `data/cache/plex-placeholder.mp4`. FFmpeg loops it with `-stream_loop -1`.

- Selecting the Plex channel in Discord joins voice and starts the loop.
- The placeholder is an idle state. `isBusy()` is false and real playback replaces it.
- Idle timeout defaults to 5 minutes.
- Empty-channel grace defaults to 30 seconds and is checked every 10 seconds.
- The spectator monitor used for IPTV and Plex content does not apply to the placeholder.
- When the clip ends or fails unexpectedly, the placeholder stops and leaves voice.

### Playback lifecycle

```
idle -> placeholder -> plex -> idle
idle -> plex -> idle
```

- Only one real stream can run. IPTV and Plex share `PlaybackEngine`.
- Starting Plex while IPTV is active is rejected.
- Starting IPTV while Plex is active is rejected.
- A finished item advances to the next queued item.
- When no queued item remains, OrbisCast leaves the voice channel.
- Plex pause, resume, skip, and stop all update the playback state and SSE subscribers.

### Errors

`PlexError` carries a code (`UNAUTHORIZED`, `NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`, `HTTP_ERROR`, `MALFORMED_RESPONSE`, `INVALID_REQUEST`). The API maps it to `502`. Token values are redacted from logs and stored queue errors.

## Gotchas and invariants

- **Subtitle index, not stream id.** Passing the global id returns 400 from the transcode endpoint.
- **Headers are required.** Plex rejects a transcode start with only query parameters, even with a valid token.
- **FFmpeg cannot send the headers.** Keep the proxy. Do not move the token back into the FFmpeg URL.
- **The token must never reach the browser.** Use the thumbnail proxy and never return `thumbnailUrl()` directly.
- **Plex `start.m3u8` can return 400 for a specific file.** Test another item, quality, or subtitles off before changing URL construction. Some files are rejected by the server's transcoder.
- **Image subtitles are not universally burnable.** A missing stream index means the track cannot be burned.
- **Session cleanup is required.** Abandoned transcode sessions consume Plex CPU until they time out. Pause keeps the session alive on purpose; stop or skip to release it.
- **A paused stream is a stopped FFmpeg process.** `stopStreaming` sends `SIGCONT` before aborting. Do not kill a paused process without resuming it, or the stop path can hang.
- **The placeholder clip is cached.** Delete `data/cache/plex-placeholder.mp4` after changing the source image.
- **Proxy lifetime follows settings.** Changing the server URL or token rebuilds the client and stops the old proxy.

## Related docs

- [WebUI and API](webui.md) - Plex routes and auth
- [Database](database.md) - queue and library tables
- [Operations](operations.md) - Docker, FFmpeg, and the ZMQ port
