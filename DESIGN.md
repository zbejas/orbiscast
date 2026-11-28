---
name: OrbisCast
description: A self-hosted control surface for IPTV and on-demand media streaming into Discord.
colors:
  primary: "#5865f2"
  primary-hover: "#4752c4"
  focus-ring: "#6d78ff"
  on-primary: "#ffffff"
  primary-container: "#2b2f63"
  on-primary-container: "#dfe1ff"
  secondary: "#cfc2e6"
  secondary-container: "#3b3452"
  tertiary: "#f2b544"
  tertiary-container: "#5b4210"
  error: "#ffb4ab"
  error-container: "#93000a"
  danger-strong: "#c7352d"
  live: "#4ade80"
  warning: "#ffd27a"
  background: "#0b0911"
  surface: "#241e31"
  surface-container-low: "#2a2438"
  surface-container: "#302942"
  surface-container-high: "#3a324d"
  surface-container-highest: "#453b59"
  on-surface: "#ebe4f5"
  on-surface-variant: "#b9b0c6"
  outline: "#7d7190"
  outline-variant: "#4a4159"
  inverse-surface: "#e8e1f0"
  inverse-on-surface: "#1c1820"
  scrim: "#040309"
  poster-ink: "#f4f1e8"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2rem, 1.4rem + 2.2vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.375rem, 1.2rem + 0.3vw, 1.5rem)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.018em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  body-small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "0em"
  title-small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.012em"
  meta:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.012em"
rounded:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "28px"
  2xl: "32px"
  3xl: "40px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger-strong}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  input-field:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "48px"
  assist-chip:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "32px"
  feature-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  dialog:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
    width: "min(34rem, calc(100vw - 24px))"
  media-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "0"
    width: "100%"
---

# Design System: OrbisCast

## Overview

**Creative North Star: "The Orbital Console"**

OrbisCast is a dark, tonal control room for one streamer. The interface treats IPTV curation, on-demand media, and Discord voice as one continuous orbit: a quiet console around a single live playback anchor. Material 3 Expressive supplies the tonal roles, shape scale, state layers, and motion grammar. The product supplies the restraint. This is not a dashboard of equal cards. It is a console with a clear center of gravity.

The surface is built for repeated operation at a desk, with a tablet nearby and a phone in hand. Density matters, but so does the ability to see what is live, what is queued, and what needs attention without reading every label. Blurple marks action and selection. Amber is reserved for on-demand media. Green means live IPTV. Red means failure. The rest is a plum-tinted neutral field.

**Key Characteristics:**
- Tonal plum surfaces instead of flat panels, with one clear step between page and card.
- One blurple signal for primary action, selection, and focus.
- Amber reserved for Plex and Jellyfin states, progress, and the Continue watching shelf.
- Full-round controls, 28px feature containers, 20px media tiles, and 16px fields.
- Dense tables and media grids inside calm, generously padded surfaces.
- Motion explains state and continuity. It never performs a page-load sequence.

## Colors

The palette is a dark Material 3 scheme translated into OrbisCast's orbital world. The frontmatter is the normative source for every value.

### Primary
- **Orbital Blurple**: the action and selection color. It fills primary buttons, focus rings, and the active navigation pill. Its container tone carries selected nav items and selected tabs.
- **Blurple Hover**: the pressed and hover companion. It stays dark enough for white labels to pass AA.

### Secondary
- **Muted Lavender**: a supporting tone for secondary containers and quiet emphasis. It never competes with the blurple signal.

### Tertiary
- **Signal Amber**: the on-demand media color. It marks Plex and Jellyfin channels, Continue watching progress, queue state, and media-specific controls. It is not a general accent.

### Neutral
- **Deep Orbit**: the page ground. It is nearly black with a plum bias, never pure black.
- **Console Plum**: the default card surface. It creates a visible tonal step above the page.
- **Graphite Lilac**: the raised and active surface for rows, table headers, and inset regions.
- **Starlight**: primary text on dark surfaces.
- **Muted Nebula**: secondary text, descriptions, and inactive labels.
- **Outline and Outline Variant**: field boundaries, dividers, and table rules. The outline is strong enough for a 3:1 control boundary.
- **Scrim**: the near-black overlay behind dialogs and sheets, used at 66 to 84 percent opacity.
- **Poster Ink**: the warm off-white title printed over poster art. It is a separate ink because posters are imagery, not chrome.

### Semantic
- **Live Green**: an active IPTV or healthy source.
- **Warning Amber**: a paused or transitional state.
- **Warning Rose**: errors, destructive confirmations, and invalid fields.
- **Inverse Surface**: the snackbar surface, using a light ground against the dark console.

### Named Rules
**The One Signal Rule.** Blurple is for action and selection. Amber is for on-demand media. Never use both on the same element.

**The Tonal Before Border Rule.** Separate surfaces with a tonal step first. Outlines belong to fields, tables, and focus, not to every card.

**The Amber Reservation Rule.** Amber appears only when media is on demand, paused, queued, or resumable. Live IPTV uses green.

## Typography

**Display Font:** The system UI stack, with no decorative display face.
**Body Font:** The same system UI stack.
**Label/Mono Font:** System UI for labels; the system mono stack for logs, identifiers, and tabular data.

**Character:** A workhorse UI scale tightened for a dense console. Hierarchy comes from size, weight, and spacing rather than a second face. The system stack keeps the app native on every desktop and mobile platform.

### Hierarchy
- **Display** (600, clamp from 2rem to 2.75rem, 1.08 line height, -0.025em): the single anchor moment, such as the idle playback hero and the login statement.
- **Headline** (600, 1.5rem, 1.25 line height, -0.02em): section titles and dialog titles.
- **Title** (600, clamp from 1.375rem to 1.5rem, 1.3 line height, -0.018em): page titles in the app bar.
- **Title Small** (600, 1.0625rem, 1.3 line height, -0.01em): empty-state and confirmation headings that sit inside a panel.
- **Body** (400, 0.9375rem, 1.5 line height): descriptions, hints, and prose.
- **Body Small** (400, 0.875rem, 1.42 line height): table cells, log rows, and snackbar titles.
- **Label** (500, 0.75rem, 1.35 line height, 0.012em): controls, chips, navigation groups, and field labels.
- **Meta** (500, 0.6875rem, 1.4 line height, 0.012em): counts, timestamps, bitrates, and identifiers. Use tabular numerals.

### Named Rules
**The 11px Floor Rule.** Real metadata never goes below 11px. The poster title sits exactly on that floor; nothing in the chrome is smaller.

**The Tabular Data Rule.** Counts, timecodes, bitrates, and log lines use tabular numerals. Code and IDs use the mono stack.

**The No Display Face Rule.** An operating console does not need a display font. The system UI is the voice.

## Layout

The shell uses an 80px icon rail from 768px to 1023px, a 240px extended rail at 1024px and wider, and a drawer below 768px. A 64px top app bar carries the page title, contextual metadata, page actions, and the live status chip. Navigation is grouped into Watch and System. A persistent now-playing mini player sits at the bottom of the desktop sidebar and becomes a safe-area bottom bar on mobile.

Pages use a fluid 12-column field capped at 1600px for data-heavy screens. Gutters are 12px on mobile, 20px on tablet, and 24px on desktop. Section gaps are 16px to 20px. Cards use 20px to 24px internal padding. Tables use 48px rows. Settings uses a 240px Configuration rail beside the active panel at md and wider, then stacks below md.

The responsive grid moves from two media columns on phone, to three on small tablet, four on large tablet, five on desktop, and six on very wide screens. Tables keep their semantics and stack into labeled cards below a 600px container width. Focus rings, 44px minimum touch targets, and safe-area padding are part of the layout, not an afterthought.

### Named Rules
**The Single Anchor Rule.** Each page has one dominant object: live playback on Dashboard, the media shelf on Media, the curation table on Channels. Everything else supports that object.

**The No Nested Card Rule.** A card inside a card needs a real state boundary. Otherwise use a row, a divider, or a tonal inset.

## Elevation & Depth

Depth is tonal first. The page, card, raised surface, and highest surface form a five-step plum ramp. Shadows are reserved for overlays, sticky surfaces, and raised controls. The app bar is a solid tonal surface, not glass. Dialogs, sheets, and snackbars use the deepest shadow because they leave the page plane.

### Shadow Vocabulary
- **e1** (`0 1px 2px rgb(0 0 0 / 0.32), 0 1px 3px 1px rgb(0 0 0 / 0.16)`): primary buttons, table rows, and small raised controls.
- **e2** (`0 2px 6px 2px rgb(0 0 0 / 0.24), 0 1px 2px rgb(0 0 0 / 0.3)`): sticky surfaces and raised panels.
- **e3** (`0 8px 24px 4px rgb(0 0 0 / 0.34), 0 2px 6px rgb(0 0 0 / 0.28)`): the mobile mini player and floating action surfaces.
- **e4** (`0 18px 52px 6px rgb(0 0 0 / 0.42), 0 4px 14px rgb(0 0 0 / 0.3)`): dialogs, sheets, and snackbars.
- **poster-title** (`0 1px 6px rgb(0 0 0 / 0.6)`): a text shadow that keeps the 11px poster title readable over bright artwork. It is not an elevation.

### Named Rules
**The Flat Console Rule.** Cards are flat at rest. Shadows appear for overlays, sticky surfaces, and raised controls. No glass, no colored halos, no hard offset shadows.

## Shapes

The shape scale starts at 4px for checkboxes, then 8px, 12px, 16px, 20px, 28px, 32px, 40px, and full round. Feature containers use 28px. Inner media tiles and inset rows use 20px. Text fields and stacked table cards use 16px. Buttons, chips, navigation pills, switches, and the seek thumb are full round. Dialogs use 28px. Bottom sheets use 28px on the top corners only.

Outlines are 1px and use the outline variant. Cards rely on tonal separation and use an outline only where the edge needs definition. Focus is a 2px ring with a 2px offset. The ring is always visible against the surrounding surface.

### Named Rules
**The Soft Container Rule.** Large surfaces use 28px corners. Only controls and dense table rows use smaller radii. Never place a 28px card inside another 28px card.

## Components

### Buttons
- **Shape:** full round (999px).
- **Primary:** Orbital Blurple fill, white label, 40px default height, 48px large, 32px small. A soft e1 shadow at rest.
- **Hover / Focus:** hover darkens to Blurple Hover. Focus uses a 2px Blurple Bright ring with a 2px offset. Active is one step darker. Disabled is 40% opacity with no shadow.
- **Secondary:** transparent fill with a 1px outline and Starlight label. Hover adds a subtle blurple state layer.
- **Danger:** Warning Rose container with white label. Reserved for confirmed destructive actions.

### Chips
- **Style:** 32px tall, full round, one of the tonal surface steps, 12px horizontal padding, Label typography.
- **State:** status chips always carry a text label plus a dot. Color is reinforcement, never the only signal. Selected tabs use the primary container with an on-primary-container label.

### Cards / Containers
- **Corner Style:** 28px for feature cards, 20px for media tiles and inset rows.
- **Background:** Console Plum above Deep Orbit. Raised rows use Graphite Lilac.
- **Shadow Strategy:** flat at rest. Overlays use e4. Sticky surfaces use e2.
- **Border:** none by default. A 60% outline variant where the edge needs definition.
- **Internal Padding:** 20px to 24px.

### Inputs / Fields
- **Style:** 44px tall, 16px radius, Console Plum fill, 1px outline boundary with at least 3:1 contrast against the fill.
- **Focus:** 2px blurple border plus a soft 3px blurple focus ring.
- **Error / Disabled:** error text and border use Warning Rose. Disabled is 50% opacity and keeps the outline.

### Navigation
- **Desktop:** 80px icon rail, 240px extended rail. Watch and System groups. Active item is a 48px primary-container pill with an on-primary-container icon and label. No trailing dot.
- **Mobile:** a native modal drawer with a 28px right edge, a visible close control, focus containment, Escape dismissal, and focus return to the menu button.

### Media Cards
- **Poster:** 2:3 aspect ratio, 20px radius, lazy image loading, a 20px series chip in the top-left. The title is outside the poster, never duplicated inside it.
- **Interaction:** hover and focus add a state layer and an "Open" pill. Cards use content-visibility and a reserved intrinsic size so a large library stays responsive.

### Queue Surface
- **Desktop:** a sticky 28px column beside the library at 1280px and wider.
- **Compact:** a native right sheet below 1280px, with focus containment, Escape dismissal, and focus return to the Queue button.
- **Content:** queue rows, reorder controls, Play queue, Shuffle, Clear, the autoplay and skip-intro switches, and the subtitle picker. The switches stay visible even when the queue is empty.

### Dialog and Sheet
- **Surface:** 28px radius, surface-container-high, e4 shadow, 28px top corners on the sheet.
- **Motion:** 360ms emphasized entry, 160ms exit, opacity plus translate and a small scale. Reduced motion removes the spatial movement and keeps the fade.
- **Behavior:** native `<dialog>`, no manual focus trap, safe Cancel autofocus, Escape support, and focus return.

### Mini Player
- **Desktop:** a 20px card above the streamer status, with a small poster, state label, viewer count, title, and a link to Dashboard. The 80px rail overlays the same count on the poster.
- **Mobile:** a safe-area bottom bar with a 24px radius and e3 shadow. The state line carries the viewer count. The bar reserves scroll padding so it never covers the last control.

### Tables
- **Structure:** semantic `<table>` with a sticky tonal header, 48px rows, tabular numerals, and a rounded 16px container.
- **State:** hover adds a subtle text state layer. Selected rows use the primary container plus a 3px inset blurple bar. Below 600px the table stacks into labeled 16px cards.

## Do's and Don'ts

### Do:
- **Do** keep the page ground and card surface on separate tonal steps.
- **Do** use the primary container for the active navigation pill and selected tabs.
- **Do** reserve amber for on-demand media, progress, and the media queue.
- **Do** keep real metadata at 11px or larger and use tabular numerals for counts.
- **Do** use the shared button, field, chip, dialog, sheet, and table components.

### Don't:
- **Don't** add glass, backdrop blur, gradient text, or colored halos.
- **Don't** nest a 28px card inside another 28px card without a state boundary.
- **Don't** use amber for live IPTV or general actions.
- **Don't** rely on color alone for status. Keep the text label.
- **Don't** add page-load choreography or animate layout properties.
