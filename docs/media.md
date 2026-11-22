# Media sources

## Overview

OrbisCast treats Plex and Jellyfin as on-demand media sources. Each configured source owns a virtual Discord channel. Selecting that channel joins voice and plays the OrbisCast placeholder. Real content starts from the WebUI queue. The queue is global, but every entry points at the source that provided it.

Older databases stored one Plex server in the `settings` table. On first boot, `MediaService` copies the legacy Plex settings, libraries, and queue into a normal media source. New installs add sources on the Media sources page at `/media/sources`.

## Key files

| File | Purpose |
|---|---|
| `src/modules/media/service.ts` | Source registry, browsing, queue, playback, placeholder |
| `src/modules/media/types.ts` | Provider contract and normalized media models |
| `src/modules/media/providers/plex.ts` | Plex adapter |
| `src/modules/media/providers/jellyfin.ts` | Jellyfin adapter |
| `src/modules/media/auth-proxy.ts` | Loopback proxy that injects provider credentials |
| `src/modules/media/quality.ts` | Shared quality presets |
| `src/modules/media/resume.ts` | Resume thresholds and saved-position clamping |
| `src/modules/plex/client.ts` | Plex Media Server HTTP client |
| `src/modules/plex/transcode.ts` | Plex HLS URL and subtitle selection |
| `src/modules/jellyfin/client.ts` | Jellyfin HTTP client and response normalization |
| `src/modules/playback/engine.ts` | Global playback state and exclusivity |
| `src/modules/streaming/index.ts` | Voice connection and FFmpeg pipeline |
| `assets/plex-placeholder.png` | Source image for the placeholder clip |
| `test/media/` | Media source and provider tests |

## Sources

A media source row stores:

- `kind`, `plex` or `jellyfin`
- A display name and server URL
- An encrypted token and its last four characters
- A generated client identifier
- The Jellyfin user id and name chosen during validation
- The virtual Discord channel name
- Idle and empty-channel timers
- A default quality preset
- An enabled flag

Libraries start disabled. The operator enables the ones to browse. Deleting a source cascades its libraries, queue entries, and saved playback history.

The WebUI shows sources as tabs. The first tab is active by default. Dragging a tab, using the arrow buttons, or pressing Alt plus Left or Right Arrow on a focused tab saves the new order in `settings.ui.mediaSourceOrder`.

Each virtual channel appears in the Channels page, `/channels`, and `/stream` autocomplete. A channel is listed while its source is enabled and has a token stored.

## Plex

`PlexClient` sends `Accept: application/json` and an `X-Plex-Token` header. On success the service syncs `/library/sections` into `media_libraries`. Libraries start disabled; the operator enables the ones to browse. Music and photo libraries are not playable.

| Operation | Plex endpoint |
|---|---|
| Library page | `/library/sections/{key}/all` with container start and size |
| Search | `/search?query=` then filter by enabled library key |
| Show seasons | `/library/metadata/{show}/children` |
| Season episodes | `/library/metadata/{season}/children` |
| All show episodes | `/library/metadata/{show}/allLeaves` |
| Item detail | `/library/metadata/{ratingKey}` including `Media`, `Part`, `Stream` |
| Thumbnail | `/photo/:/transcode?url=/library/metadata/{key}/thumb&width=&height=` |

Thumbnails are fetched by the server and returned through `/api/media/thumb/:sourceId/:itemId`. The browser never receives a Plex URL containing the token.

## Jellyfin

`JellyfinClient` sends `Authorization: MediaBrowser Token="..."` and reads JSON. Validation calls `/System/Info` and `/Users`. The first administrator is used for user-scoped requests, and its id and name are saved on the source.

| Operation | Jellyfin endpoint |
|---|---|
| Libraries | `/Library/MediaFolders` |
| Library page | `/Items?parentId=&recursive=true&includeItemTypes=Movie,Series` |
| Search | `/Items?parentId=&searchTerm=` per enabled library |
| Seasons | `/Shows/{seriesId}/Seasons` |
| Season episodes | `/Items?parentId={seasonId}&includeItemTypes=Episode` |
| All show episodes | `/Shows/{seriesId}/Episodes` |
| Item detail | `/Users/{userId}/Items/{itemId}` with `MediaSources` and `MediaStreams` |
| Thumbnail | `/Items/{itemId}/Images/Primary?maxWidth=&maxHeight=` |

Jellyfin playback uses `/Videos/{itemId}/master.m3u8` with H.264 and AAC forced, a device id, a play session id, and the chosen quality. Seeking adds `StartTimeTicks`. The server returns a master manifest and a relative segment manifest.

Jellyfin rejects `StartTimeTicks` on segment requests. The proxy strips that parameter from every non-manifest request, so a seek starts at the requested offset and the segments still load.

Stopping playback calls `DELETE /Videos/ActiveEncodings?deviceId=&playSessionId=`.

## Queue

The queue is global, persisted in `media_queue_items`, and managed only in the WebUI. Items carry a source id, a quality preset, and a subtitle mode.

- Supported statuses: `queued`, `playing`, `played`, `failed`. Current code no longer writes `played`; rows with it are legacy and hidden by the queue panel.
- Adding a movie or single episode appends one item. Adding a season or show expands to episodes.
- Reorder, shuffle, remove, and clear rewrite positions.
- A queue item that fails to start or play is marked `failed` with a redacted error.
- Stop removes the current item from the queue and saves its position. Stopping at or after 85 percent of the duration marks the history row completed instead of resumable.
- Skip removes the current item and saves its position. A skip at or after 85 percent also completes it.
- Natural end removes the item and marks the history row completed.
- Clear removes queued, played, and failed rows but keeps the active playback row, so the queue panel and playback state stay aligned.
- On boot, stale `playing` rows return to `queued`.

## Quality presets

| Value | Resolution | Bitrate |
|---|---|---|
| `720p-4` | 1280x720 | 4000 kbps |
| `1080p-8` | 1920x1080 | 8000 kbps (default) |
| `1080p-12` | 1920x1080 | 12000 kbps |
| `4k-20` | 3840x2160 | 20000 kbps |

Each source stores a default for new items. The quality can be changed per queued item in the WebUI.

## Subtitles

Plex expects the **global stream id** (`Stream.id`) in `subtitleStreamID`, not the per-part stream index. The WebUI and queue store a stream id; `MediaService` resolves it to a burnable stream, and `PlexProvider` maps that stream index back to its global id before building the transcode URL.

Plex also persists the choice on the media part. `PlexProvider.preparePlayback` calls `PUT /library/parts/{partId}?subtitleStreamID={id}` before starting the transcode, because the transcode URL alone does not override a part whose saved selection points at a different track. Subtitles off persists `0` and requests `subtitles=none` with `subtitleStreamID=0`.

- A stream is burnable when it is a subtitle and has an integer `index` of zero or more.
- Auto prefers the default burnable track, then a forced burnable track, then the first burnable track.
- Off omits the subtitle parameters.
- An explicit WebUI choice is the stream id. The service resolves it to the stream index for the provider contract; Plex maps the index to the global id, Jellyfin uses the index directly.

Jellyfin uses `SubtitleStreamIndex` plus `SubtitleMethod=Encode`. Image subtitles work when the server can burn them. The same normalized stream list drives both providers.

`MediaService.setSubtitleMode` switches tracks while playback is active. It resolves the mode to a stream index, builds a new provider transcode at the current position, swaps it into the existing Discord stream with `replaceMediaStreamingSource`, and updates the queue row and history row. A paused item stays paused after the swap.

- `GET /api/media/playback/item` returns the active item with its streams.
- `POST /api/media/playback/subtitle` accepts `{ "mode": "auto" | "off" | <stream id> }`.
- Only one source swap runs at a time. A concurrent seek or subtitle change is rejected with a conflict result.

## Autoplay and intro skip

Both behaviors live in `settings.playback` and are toggled from the queue panel.

- `autoplayNextEpisode` is off by default. When an episode ends naturally and no queued item remains, `MediaService` loads the show's episodes with `getAllEpisodes(showItemId)`, finds the next episode, queues it, and starts it. Stop and skip do not autoplay. The last episode of a show ends playback.
- `autoSkipIntro` is off by default. Plex item metadata is requested with `includeMarkers=1`; an intro marker becomes `MediaItemDetail.intro`. If resume lands inside the marker, playback starts at its end. While playing, a two-second timer calls `seek(intro.endMs)` once per item. Jellyfin items have no intro marker.
- The active item stores `introSkipped`, so a manual seek back into an intro does not trigger another skip.

## Transcode and proxy

Plex needs its `X-Plex-*` headers and Jellyfin needs its `Authorization` header. FFmpeg does not receive either token. `AuthProxy` listens on a random loopback port, forwards the path and query to the source, and injects the provider headers.

- Plex transcode URLs point at the proxy with no token.
- Jellyfin HLS URLs point at the proxy with no token.
- The proxy rewrites absolute manifest URLs to its own origin and drops the stale `content-length`.
- Jellyfin segment requests drop `StartTimeTicks` because the server rejects it there.
- Only one proxy per source is running at a time. Changing the source URL or token rebuilds it.
- The Discord re-encode is capped at 1080p. A 4K queue preset still asks the provider for 4K, but the output is scaled to 1080p; without the cap the software encoder cannot keep up and viewers get a frozen or black frame.
- Jellyfin can take 15 to 20 seconds to produce the first HLS segment for a 4K source. The Discord stream shows black until that first frame arrives.

Plex builds `/video/:/transcode/universal/start.m3u8` with `path`, `mediaIndex`, `partIndex`, `protocol=hls`, `directPlay=0`, `directStream=0`, `subtitles=burn`, `videoResolution`, `videoBitrate`, `maxVideoBitrate`, `offset`, and `session`. Jellyfin builds `/Videos/{itemId}/master.m3u8` with the quality, subtitle, seek, and session parameters.

## Pause and resume

Pause sends Discord's `STREAM_SET_PAUSED` opcode so viewers see Discord's paused screen, then suspends FFmpeg with `SIGSTOP`. The stream stays live, the provider transcode session stays open, and the voice connection is untouched. Resume sends `SIGCONT` and `STREAM_SET_PAUSED` with `paused: false`; the same transcode and stream continue. Both packet pacers rebase their wall-clock origin on resume, so paused audio does not catch up in a burst.

Stop and skip still stop the provider session. A seek while paused replaces the source and clears the Discord pause state.

## Seek

The WebUI progress bar is also a seek control. A seek stops the current FFmpeg process and provider session, builds a new transcode at the requested offset, and swaps it into the existing Discord stream connection. The stream is not deleted or recreated, so viewers keep the last frame during the short rebuffer.

## History and resume

`media_history` stores one row per `(source_id, item_id)`: item metadata, position in milliseconds, quality, subtitle mode, completion state, and the last activity timestamp. `MediaService` writes progress every 15 seconds while media plays and on pause, seek, stop, skip, natural end, and shutdown.

- `resolveResumePosition` ignores history shorter than 30 seconds, completed items, and positions inside the end guard (the last 60 seconds, or the last 2 percent for short items).
- A resumed item is clamped to one second before its known duration.
- Starting an item resets its completed flag and saves the offset actually used. Natural end marks it completed. Stop or skip at or after 85 percent also marks it completed, so a near-finished item does not return to Continue watching.
- Resume uses the quality and subtitle mode saved with the history row. `POST /api/media/play` accepts `startOver: true` to ignore it.
- The dashboard and Media page read `GET /api/media/history`. `MediaService.getHistory` reports the live position for the active item. The API route uses `getHistoryWithNext`, which appends synthetic next-episode recommendations for the most recently completed episode of each series.
- A recommendation has a negative id, a zero position, and `recommended: true`. `getNextEpisodeRecommendations` walks `getAllEpisodes(showItemId)` forward, skips episodes already completed, and stops when the next episode already has resumable progress. The WebUI shows it as Up next and does not offer Remove for it.
- Deleting a source cascades its history rows.

## Placeholder

`assets/plex-placeholder.png` is a 1280x720 branded slide. On first use the service generates a six-second H.264 and AAC clip at `data/cache/media-placeholder.mp4`. FFmpeg loops it with `-stream_loop -1`.

- Selecting a media channel in Discord joins voice and starts the loop.
- The placeholder is an idle state. `isBusy()` is false and real playback replaces it.
- Idle timeout defaults to 5 minutes per source.
- Empty-channel grace defaults to 30 seconds and is checked every 10 seconds.
- The spectator monitor does not apply to the placeholder.
- When the clip ends or fails unexpectedly, the placeholder stops and leaves voice.

## Playback lifecycle

```
idle -> placeholder -> media -> idle
idle -> media -> idle
```

- Only one real stream can run. IPTV and every media source share `PlaybackEngine`.
- Starting media while IPTV is active is rejected.
- Starting IPTV while media is active is rejected.
- A finished item advances to the next queued item, even when it belongs to another source.
- When the queue is empty and `settings.playback.autoplayNextEpisode` is on, a finished episode queues and starts the next episode of the same show.
- When no queued or autoplay item remains, OrbisCast leaves the voice channel.
- Pause, resume, skip, stop, seek, and subtitle changes update the playback state and SSE subscribers.
- Stop, skip, natural end, and shutdown save the current position in `media_history`. Stop and skip also remove the queue row.

## Errors

`PlexError` and `JellyfinError` carry a code (`UNAUTHORIZED`, `NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`, `HTTP_ERROR`, `MALFORMED_RESPONSE`, `INVALID_REQUEST`). The API maps them to `502`. Token values are redacted from logs and stored queue errors.

## Gotchas and invariants

- **Legacy Plex migration runs once.** It creates the first media source only when no media source exists and a legacy Plex token is stored.
- **Tokens never reach the browser.** Use the thumbnail proxy and never return a provider URL with a token.
- **Jellyfin seek needs the segment strip.** Removing `StartTimeTicks` from segment requests is required on Jellyfin 12.
- **Plex subtitle index.** Passing the global id returns 400 from the transcode endpoint.
- **Headers are required.** Both providers reject HLS requests without their auth header, so keep the proxy.
- **Session cleanup is required.** Abandoned transcode sessions consume CPU until they time out. Pause keeps the session alive on purpose; stop or skip to release it.
- **Pause uses Discord's paused state.** Send `STREAM_SET_PAUSED` before `SIGSTOP`; removing the opcode changes the viewer experience to a frozen last frame.
- **A paused stream is a stopped FFmpeg process.** `stopStreaming` sends `SIGCONT` before aborting.
- **The placeholder clip is cached.** Delete `data/cache/media-placeholder.mp4` after changing the source image.
- **Source deletion is permanent for queue entries.** The queue rows cascade with the source.
- **History is per item, not per queue entry.** Re-adding or re-queueing the same item resumes the saved position unless the request sets `startOver`.
- **Completed items do not resume.** Natural end sets `completed`, and `resolveResumePosition` returns zero until the item starts again.

## Related docs

- [WebUI and API](webui.md) - media routes and auth
- [Database](database.md) - media source, library, queue, and history tables
- [Operations](operations.md) - Docker, FFmpeg, and the ZMQ port
