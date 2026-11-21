# Database

## Overview

OrbisCast stores all runtime configuration, IPTV metadata, Discord permissions, media sources, media libraries, saved playback history, and the shared on-demand queue in one SQLite file, `data/orbiscast.db`. There are no environment-backed settings. Drizzle ORM provides typed queries and generated SQL migrations; `better-sqlite3` is the driver.

## Key files

| File | Purpose |
|---|---|
| `src/modules/database/schema.ts` | App tables and indexes |
| `src/modules/auth/schema.ts` | Better Auth tables |
| `src/modules/database/client.ts` | Open, pragmas, migrations, pristine check |
| `src/modules/database/repo.ts` | Typed queries and transactions |
| `drizzle/` | Generated SQL migrations and journal |
| `drizzle.config.ts` | Drizzle Kit schema paths and output folder |

## How it works

### Connection

`openDatabase(dataDir)` creates `data/orbiscast.db` and applies:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

`runMigrations(db)` applies every pending migration from `drizzle/` on boot. The database file and its `-wal` and `-shm` siblings are part of the data volume.

### Tables

| Table | Owns |
|---|---|
| `settings` | One JSON row per section: `stream`, `plex` (legacy), `discord`, `auth`, `ui`, `meta` |
| `iptv_sources` | Paired M3U and XMLTV source configuration and refresh state |
| `channels` | Playable IPTV channels with the operator visibility flag |
| `programmes` | EPG rows keyed by source and XMLTV channel id |
| `discord_guild_settings` | Per-guild role allowlist and enabled flag |
| `media_sources` | Plex and Jellyfin servers, encrypted tokens, timers, channel names |
| `media_libraries` | Discovered libraries per source and their enabled flag |
| `media_queue_items` | Persisted global queue, with a source id on every item |
| `media_history` | Saved playback position and last-played metadata per media item |
| `plex_libraries`, `plex_queue_items` | Legacy Plex rows read once by the migration |
| `user`, `session`, `account`, `verification` | Better Auth username and password tables |

### Settings rows

Settings are stored as JSON strings, not columns. `SettingsService` merges Zod defaults, validates each section, and rewrites only changed sections. A corrupt or unknown section logs an error and falls back to defaults.

- `media_sources.token_encrypted`, `discord.botTokenEncrypted`, and `discord.userTokenEncrypted` hold AES-256-GCM ciphertext.
- `media_sources.token_last4` and the Discord `*Last4` fields are display hints only.
- `media_sources.client_identifier` is a generated UUID used for Plex transcode sessions and Jellyfin device ids.
- The legacy `plex` settings section is read once and copied into a media source.
- `meta.envImported` records the one-time `.env` import.
- `ui.mediaSourceOrder` stores the media source ids in WebUI tab order. Unknown ids are ignored, and sources missing from the list follow in name order.

### Migrations

```bash
npm run db:generate   # generate a migration after a schema change
npm run db:check      # verify the migration folder and journal
```

Migrations run automatically at boot. Never edit an applied migration. Add a new one.

### Indexes and constraints

- `channels` is unique on `(source_id, stable_key)`, with indexes on `source_id` and `visible`.
- `programmes` has a composite index on `(source_id, channel_tvg_id, start_timestamp)` and an index on `start_timestamp`.
- `media_queue_items` has indexes on `position`, `status`, and `source_id`.
- `media_history` is unique on `(source_id, item_id)` and has indexes on `played_at` and `completed`.
- `media_libraries` is unique on `(source_id, library_key)` and has an index on `source_id`.
- `media_sources` has indexes on `kind` and `enabled`.
- Media history, libraries, and queue entries cascade from `media_sources`. Channel and programme rows cascade from `iptv_sources`. Auth sessions and accounts cascade from `user`.

### Startup checks

`isDatabasePristine(sqlite)` returns true when `iptv_sources` is empty and `settings` has no rows. The one-time `.env` importer only runs in that state. `resetPlayingMediaItems(db)` returns any stale `playing` row to `queued` after a restart.

## Gotchas and invariants

- **Back up `keys.json` with the database.** Encrypted tokens cannot be recovered without it.
- **Do not store plaintext secrets in `settings`.** Use `SettingsService.update` and the token fields.
- **IPTV source URLs are plaintext by decision.** Do not log them or copy them into docs and fixtures.
- **Timestamps are mixed.** Source, channel, queue, settings, and history rows use epoch milliseconds. Programme start and stop values are epoch seconds with the original XMLTV strings kept alongside.
- **History is one row per item.** `media_history` is keyed by `(source_id, item_id)`; position updates use `setMediaHistoryProgress` instead of append-only rows.
- **Queue positions are rewritten, not trusted.** Add, remove, reorder, and shuffle all run through `reorderMediaQueue`, which rewrites `position` from 1.
- **`settings` is a key/value table.** A schema change to a section does not need a migration unless you need to transform existing rows.
- **Test databases are temporary.** `test/api/app.test.ts` opens a fresh database per test and deletes the directory afterwards.
- **WAL files matter.** Copying only `orbiscast.db` while the app is running can lose recent writes. Stop the app or copy the whole directory.

## Related docs

- [WebUI and API](webui.md) - settings service and auth routes
- [IPTV](iptv.md) - how channel and programme rows are written
- [Media sources](media.md) - source, library, queue, and resume behavior
- [Operations](operations.md) - backup, restore, and admin CLI
