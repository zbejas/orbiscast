# IPTV

## Overview

IPTV sources are paired M3U playlists and optional XMLTV guides. `IptvService` downloads each pair, parses the playlist, merges guide metadata, and syncs channels and programmes into SQLite. The WebUI decides which channels are visible; the visibility filter is the only gate between a playlist and Discord.

## Key files

| File | Purpose |
|---|---|
| `src/modules/iptv/service.ts` | Source refresh, playlist parsing, channel and programme sync, timers |
| `src/modules/iptv/downloaders.ts` | Retry, timeout, size cap, cache fallback |
| `src/modules/iptv/parsers/playlist-parser.ts` | M3U `#EXTINF` line parsing |
| `src/modules/iptv/parsers/xmltv-parser.ts` | XMLTV channel and programme parsing |
| `src/modules/iptv/utils.ts` | XMLTV date parsing |
| `src/modules/database/repo.ts` | `replaceSourceChannels`, `replaceSourceProgrammes`, visibility queries |
| `src/modules/setup/import-env.ts` | One-time legacy `PLAYLIST` and `XMLTV` import |

## How it works

### Refresh flow

```
refreshSource(sourceId)
  -> download playlist (3 attempts, 30s timeout, 50 MB cap)
  -> parse M3U entries that have a stream URL
  -> download XMLTV when configured
  -> merge XMLTV channel metadata by tvg-id, then by name
  -> upsert channels by (source_id, stable_key), preserving visible
  -> delete channels not seen in this successful refresh
  -> replace programmes for the source
  -> prune programmes older than seven days
```

- A failed playlist download aborts the refresh and leaves the last good channels and guide in place.
- A failed guide download updates channels but keeps the previous programmes.
- An empty playlist or a playlist with no playable entries is a failure.
- Concurrent refreshes for the same source are coalesced. The second caller gets `false` immediately.
- `lastRefreshedAt` and `lastError` are written after every attempt and surfaced in the WebUI.

### Channel identity

`stableKey` is the trimmed `tvg-id` when present, otherwise the lowercased trimmed name, otherwise `channel-<index>`. Duplicate keys within one playlist get an index suffix. A refresh updates the row with that key instead of inserting a second one.

Only playlist entries with a stream URL become rows. XMLTV-only channels are metadata sources, not playable channels.

### Visibility

- Every newly inserted channel starts `visible = false`.
- The upsert preserves an existing row's `visible` flag.
- Bulk visibility changes come from `PATCH /api/channels/visibility`.
- Deleting a source cascades to its channels and programmes.

### EPG

- Programmes are stored per source and XMLTV channel id.
- `start_timestamp` and `stop_timestamp` are epoch seconds for range queries; the original XMLTV strings are kept in `start` and `stop`.
- `GET /api/epg?start=&end=&channelIds=` returns rows that overlap the window.
- The WebUI timeline renders visible channels only.
- Rows older than seven days are pruned after a successful guide refresh.

### Scheduling

- Each enabled source has its own `setTimeout` based on `refreshMinutes` (default 1440).
- On boot, a source refreshes immediately when it has never refreshed, when the refresh interval has elapsed, or when it has zero channels.
- Timers are `unref()`ed so they do not keep the process alive.
- Deleting or editing a source clears and rebuilds its timer.

### Cache

Downloads are cached under `data/cache/source-<id>/playlist.m3u` and `xmltv.xml`. A download failure returns the last cached copy when one exists. The cache is not a second source of truth: a successful download always replaces it.

### Legacy import

When the database is pristine, the importer maps:

| Legacy variable | Destination |
|---|---|
| `PLAYLIST` | New source named `Imported IPTV` |
| `XMLTV` | The same source's guide URL |
| `REFRESH_IPTV` | Source `refreshMinutes` |
| `DISCORD_BOT_TOKEN`, `DISCORD_USER_TOKEN` | Encrypted Discord settings |
| `BITRATE_VIDEO`, `BITRATE_VIDEO_MAX`, `MINIMIZE_LATENCY`, `DISABLE_TRANSCODE`, `DEFAULT_STREAM_TIMEOUT` | Stream settings |
| `DEBUG`, `TZ` | UI log level and timezone |

`GUILD` is ignored because commands register in every guild. `RAM_CACHE`, `CACHE_DIR`, and `OPENVPN_*` are ignored.

## Gotchas and invariants

- **The playlist is the channel source of truth.** A successful refresh deletes rows that disappeared, even if they were visible.
- **Visibility must survive refresh.** Never add `visible` to the upsert update set.
- **Do not treat XMLTV-only channels as playable.** They have no stream URL and must not become channel rows.
- **A failed guide must not wipe programmes.** Only replace programmes after a successful parse with rows.
- **Downloads are capped.** Keep the 50 MB limit and the 30 second timeout unless a known provider needs more.
- **Source URLs are secret.** They can contain credentials. Log only a host label and never send them to the WebUI logs.
- **The cache can be stale.** A cached playlist is a fallback, not proof that the provider is healthy. Surface `lastError`.
- **Parsers are heuristics.** Playlist formats vary. Add fixtures to `test/` before changing `fromPlaylistLine`.

## Related docs

- [Database](database.md) - channel and programme tables
- [WebUI and API](webui.md) - channels, guide, and sources routes
- [Operations](operations.md) - data directory and cache
