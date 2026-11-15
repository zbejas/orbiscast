# Database

## Overview

OrbisCast stores all runtime configuration, IPTV metadata, Discord permissions, Plex libraries, and the Plex queue in one SQLite file, `data/orbiscast.db`. There are no environment-backed settings. Drizzle ORM provides typed queries and generated SQL migrations; `better-sqlite3` is the driver.

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
| `settings` | One JSON row per section: `stream`, `plex`, `discord`, `auth`, `ui`, `meta` |
| `iptv_sources` | Paired M3U and XMLTV source configuration and refresh state |
| `channels` | Playable IPTV channels with the operator visibility flag |
| `programmes` | EPG rows keyed by source and XMLTV channel id |
| `discord_guild_settings` | Per-guild role allowlist and enabled flag |
| `plex_libraries` | Discovered Plex libraries and their enabled flag |
| `plex_queue_items` | Persisted global Plex queue |
| `user`, `session`, `account`, `verification` | Better Auth username and password tables |

### Settings rows

Settings are stored as JSON strings, not columns. `SettingsService` merges Zod defaults, validates each section, and rewrites only changed sections. A corrupt or unknown section logs an error and falls back to defaults.

- `plex.tokenEncrypted`, `discord.botTokenEncrypted`, and `discord.userTokenEncrypted` hold AES-256-GCM ciphertext.
- `plex.tokenLast4` and the Discord `*Last4` fields are display hints only.
- `plex.clientIdentifier` is a generated UUID used for Plex transcode sessions.
- `meta.envImported` records the one-time `.env` import.

### Migrations

```bash
npm run db:generate   # generate a migration after a schema change
npm run db:check      # verify the migration folder and journal
```

Migrations run automatically at boot. Never edit an applied migration. Add a new one.

### Indexes and constraints

- `channels` is unique on `(source_id, stable_key)`, with indexes on `source_id` and `visible`.
- `programmes` has a composite index on `(source_id, channel_tvg_id, start_timestamp)` and an index on `start_timestamp`.
- `plex_queue_items` has indexes on `position` and `status`.
- `plex_libraries.library_key` is unique.
- Channel and programme rows cascade from `iptv_sources`. Auth sessions and accounts cascade from `user`.

### Startup checks

`isDatabasePristine(sqlite)` returns true when `iptv_sources` is empty and `settings` has no rows. The one-time `.env` importer only runs in that state. `resetPlayingQueueItems(db)` returns any stale `playing` row to `queued` after a restart.

## Gotchas and invariants

- **Back up `keys.json` with the database.** Encrypted tokens cannot be recovered without it.
- **Do not store plaintext secrets in `settings`.** Use `SettingsService.update` and the token fields.
- **IPTV source URLs are plaintext by decision.** Do not log them or copy them into docs and fixtures.
- **Timestamps are mixed.** Source, channel, queue, and settings rows use epoch milliseconds. Programme start and stop values are epoch seconds with the original XMLTV strings kept alongside.
- **Queue positions are rewritten, not trusted.** Add, remove, reorder, and shuffle all run through `reorderQueue`, which rewrites `position` from 1.
- **`settings` is a key/value table.** A schema change to a section does not need a migration unless you need to transform existing rows.
- **Test databases are temporary.** `test/api/app.test.ts` opens a fresh database per test and deletes the directory afterwards.
- **WAL files matter.** Copying only `orbiscast.db` while the app is running can lose recent writes. Stop the app or copy the whole directory.

## Related docs

- [WebUI and API](webui.md) - settings service and auth routes
- [IPTV](iptv.md) - how channel and programme rows are written
- [Plex](plex.md) - queue tables and playback state
- [Operations](operations.md) - backup, restore, and admin CLI
