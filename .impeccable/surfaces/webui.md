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
- Job: configure the bot, curate IPTV channels, start Plex playback, diagnose failures.
- Constraints: dark only, Discord blurple as primary, Plex amber only for Plex states, no emoji, no em dashes, desktop, tablet, and mobile.

## Direction contract

THESIS: A quiet operational console with a media shelf at its center. The category default is a generic admin dashboard of equal cards; this surface refuses that by making the live playback state the anchor and treating IPTV curation as a dense, fast filter table.

OWN-WORLD: Near-black slate fields, one raised surface per region, 1px graphite borders, Discord blurple controls, Plex amber reserved for Plex state, green for live, red for failure. System UI type, monospaced identifiers, poster art as the only saturated imagery, the orbital glyph as the single decorative mark.

STORY: The operator lands, sees whether anything is playing and whether the bot and Plex are healthy, then moves sideways into Channels, Guide, Plex, Sources, Discord, Logs, or Settings. The Plex row is always visible, idle or playing, so the on-demand channel has a place even when empty.

FIRST VIEWPORT: A 240px sidebar with the wordmark and eight destinations. The main column opens with a 52px toolbar holding the page title, a live status pill, and the primary action. Below it, a full-width live card with poster thumbnail, title, source or Plex badge, guild and voice channel, uptime, viewer count, and Stop or Skip. Beside it on wide screens, a compact queue card with the next three items. Below, a two-column strip of source health and recent log lines.

FORM: seed: none (pinned) "Dark Discord-adjacent with Plex-style media grids". Signature interaction: selecting the Plex channel or a Plex item slides the queue panel into view and asks for a voice channel, without leaving the page.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
