# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite 8 SPA served by the existing Express 5 Node process. SQLite via Drizzle + better-sqlite3. Better Auth is optional. Streaming stays on discord-video-stream v7.

## Users

The primary user is a single self-hoster running OrbisCast for themselves and a small friend group. They operate from a desktop browser, sometimes a tablet or phone. Friends watch in Discord and may start or stop playback when granted a role. The operator is the only person who manages sources, channels, Plex, tokens, and settings.

## Product Purpose

OrbisCast streams IPTV channels and on-demand Plex media into Discord voice channels. The WebUI replaces hand-edited env files and JSON databases with one browser surface for setup, curation, playback, and diagnosis. Success means the operator never edits a file to run the bot, can curate a large playlist in minutes, and can start a Plex movie or episode in a few clicks.

## Positioning

One self-hosted control surface pairs a Discord self-bot streaming engine with IPTV curation and a Plex on-demand queue. The virtual Plex channel is both a Discord presence and a WebUI queue target: it shows a branded placeholder until someone starts playback from the WebUI.

## Operating Context

The app runs in Docker on a home server or LAN host. One bot token and one user token are configured. The bot serves commands in every guild it joins. The self-bot can only be in one voice channel, so playback is global. IPTV providers are large M3U playlists with optional XMLTV guides. Plex runs on the LAN or is reachable through a public URL. The operator tests locally before exposing anything publicly.

## Capabilities and Constraints

- Zero required env vars. SQLite owns all configuration. Optional `PORT` override only.
- Multiple paired IPTV sources, visibility filtering, EPG timeline, per-source refresh.
- Multi-guild Discord commands with a per-guild role allowlist. An empty allowlist means Manage Server only.
- One Plex server, Plex transcoding, WebUI-only Plex queue, pause and resume, no seek.
- The Plex virtual channel joins Discord, plays a generated placeholder, then leaves after configurable idle and empty-channel timers.
- Global single playback. New real playback is rejected while busy. The placeholder is idle and replaceable.
- Auth is off by default. Better Auth username and password with one admin can be enabled in Settings.
- Token values are encrypted at rest. IPTV source URLs are plaintext by decision.
- No backup UI, no multiple Plex servers, no multi-streamer accounts.

## Brand Commitments

Name: OrbisCast. Existing product voice: plain, direct, mildly technical. New wordmark and orbital glyph. Dark Discord-adjacent palette with Plex amber reserved for Plex states. No emoji in UI copy. No em dashes in UI copy.

## Evidence on Hand

Existing bot code and README describe the IPTV and Discord behavior. A Plex server is reachable at the operator's LAN and public endpoints. Real library metadata is private and must not be committed. No product screenshots, testimonials, or public brand assets exist yet.

## Product Principles

1. The browser is the control plane. If it needs a file edit, it is unfinished.
2. One streamer, one stream. Make the active state and the conflict obvious.
3. Curate first. Large playlists are filtered down to a deliberate channel list.
4. Keep the operator in the loop. Show what is running, what failed, and what will happen next.
5. Self-hosted by default. No external service is required to run or recover the app.

## Accessibility & Inclusion

Standard WCAG AA for the WebUI. Keyboard operable, visible focus, semantic tables and forms, reduced motion respected, responsive from 390px to 1440px.
