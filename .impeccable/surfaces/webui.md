---
version: 1
slug: "webui"
primary_target: "webui"
related_targets: []
---

# WebUI

- Scope: the whole WebUI, from Dashboard through Settings.
- Mode: Operate.
- Audience: the self-hoster operator. Friends only see the Discord side.
- Job: configure the bot, curate IPTV channels, start Plex or Jellyfin playback, diagnose failures.
- Constraints: dark only, Discord blurple as primary, Plex amber only for on-demand media states, no emoji, no em dashes, desktop, tablet, and mobile.

## Direction contract

THESIS: A quiet operational console with a media shelf at its center. The category default is a generic admin dashboard of equal cards; this surface refuses that by making the live playback state the anchor and treating IPTV curation as a dense, fast filter table.

OWN-WORLD: Near-black slate fields, one raised surface per region, 1px graphite borders, Discord blurple controls, Plex amber reserved for media state, green for live, red for failure. System UI type, monospaced identifiers, poster art as the only saturated imagery, the orbital glyph as the single decorative mark.

STORY: The operator lands, sees whether anything is playing and whether the bot and media sources are healthy, then moves sideways into Channels, IPTV, Media, Discord, Logs, or Settings. Each media channel is always visible, idle or playing, so every on-demand source has a place even when empty. Saved playback progress gives the operator a direct way back into unfinished media.

FIRST VIEWPORT: A 240px sidebar with the wordmark and eight destinations. The main column opens with a 52px toolbar holding the page title, a live status pill, and the primary action. Below it, a full-width live card with poster thumbnail, title, source badge, guild and voice channel, uptime, viewer count, and Stop or Skip. Beside it on wide screens, a compact queue card with the next three items. A Continue watching card sits below the pair when saved progress exists, with poster, title, progress bar, and a Resume link per row. Below, a two-column strip of source health and recent log lines.

FORM: seed: none (pinned) "Dark Discord-adjacent with Plex-style media grids". Signature interaction: selecting a media channel or a media item slides the queue panel into view and asks for a voice channel, without leaving the page. Media sources are tabs, ordered by drag or Alt plus arrow keys, with the first tab active by default. Source and library management live on `/media/sources` as inline page sections, not dialogs.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
