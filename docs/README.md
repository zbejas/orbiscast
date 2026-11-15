# OrbisCast Docs

Subsystem documentation for OrbisCast. The root [README](../README.md) is the user-facing front door. [AGENTS.md](../AGENTS.md) is the task routing map.

## Layout

| Folder | Covers |
|---|---|
| [webui.md](webui.md) | Express API, React WebUI, auth, SSE, and browser testing |
| [plex.md](plex.md) | Plex client, transcode proxy, subtitles, placeholder, and queue |
| [iptv.md](iptv.md) | Paired sources, channel sync, visibility, EPG, and refresh |
| [database.md](database.md) | SQLite schema, migrations, settings rows, and auth tables |
| [operations.md](operations.md) | Data directory, keys, admin CLI, Docker, logs, and recovery |

## Reading paths

| If you are | Read in order |
|---|---|
| New to the project | [README](../README.md) -> [AGENTS.md](../AGENTS.md) -> webui.md |
| Debugging playback | [plex.md](plex.md) -> [operations.md](operations.md) |
| Debugging IPTV or the guide | [iptv.md](iptv.md) -> [database.md](database.md) |
| Changing the schema | [database.md](database.md) -> [iptv.md](iptv.md) -> [plex.md](plex.md) |
| Deploying or recovering | [operations.md](operations.md) |

## Writing docs

- Follow the five-section shape: Overview, Key files, How it works, Gotchas and invariants, Related docs.
- The code is the source of truth. Verify every path, command, and default.
- Cross-cutting facts have one canonical doc. Link instead of repeating.
- Keep user behavior in the README and mechanism here.

## Related docs

- [`../README.md`](../README.md) - install and user behavior
- [`../AGENTS.md`](../AGENTS.md) - agent routing and conventions
