---
name: Audio Angel
description: A quiet, adult-operated music player with switchable listening profiles.
colors:
  dark-screen: "#0a0a0a"
  dark-card: "#111111"
  dark-grouped: "#1a1b1b"
  dark-text: "#f5f5f5"
  dark-muted: "#a3a3a3"
  dark-border: "#282929"
  dark-primary: "#4b7cf3"
  dark-button: "#f5f5f5"
  dark-button-text: "#0a0a0a"
  dark-danger: "#ff9ca4"
  light-screen: "#fcfcfc"
  light-card: "#ffffff"
  light-grouped: "#f4f4f5"
  light-text: "#27272a"
  light-muted: "#6f6f79"
  light-border: "#e4e4e7"
  light-primary: "#1b4ed8"
  light-button: "#27272a"
  light-button-text: "#fcfcfc"
  light-danger: "#b91c1c"
  toggle-off: "#666666"
  toggle-thumb: "#ffffff"
typography:
  title:
    fontFamily: "DM Sans"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.8px"
  body:
    fontFamily: "DM Sans"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "DM Sans"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  badge: "5px"
  artwork-small: "6px"
  artwork-large: "7px"
  control: "9px"
  group: "12px"
  icon-button: "30px"
spacing:
  row-gap: "12px"
  group-inset: "16px"
  mobile-page: "20px"
  desktop-page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.dark-button}"
    textColor: "{colors.dark-button-text}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary:
    backgroundColor: "{colors.dark-grouped}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  field:
    backgroundColor: "{colors.dark-grouped}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
    padding: "13px"
  chip:
    backgroundColor: "{colors.dark-grouped}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  group:
    backgroundColor: "{colors.dark-grouped}"
    rounded: "{rounded.group}"
    padding: "0 16px"
  icon-button:
    textColor: "{colors.dark-text}"
    rounded: "{rounded.icon-button}"
    size: "44px"
---

# Design System: Audio Angel

## Overview

Mode: Operate. Visual authority is the user-approved interactive HTML mobile mockup from this project thread, adapted from [T3 Code mobile](https://github.com/pingdotgg/t3code/tree/main/apps/mobile) (MIT). This merges the provisional scaffold documentation into an implementation-derived reference; it does not introduce a new visual direction or a newly named creative metaphor.

The approved world is quiet and mobile-derived: DM Sans, Tabler outline icons, grouped lists, restrained borders, and direct playback controls. The landing player is the primary demo surface; activity explains simulated commands. Library uses real account content; catalog search and the separate Spotify playback pilot use live Spotify metadata and playback. Keep each surface’s source and filtering status visible and avoid simulated protection claims.

Key characteristics: dark/light tonal surfaces, compact readable labels, generous control targets, and geometric fictional album artwork.

## Colors

The frontmatter preserves the exact theme values from `apps/app/src/ui/theme.ts`. The `dark-*` and `light-*` families are paired semantic roles; component frontmatter shows the dark examples and switches to the corresponding light role with the theme.

### Primary

Blue `primary` marks selected mobile tabs, selected chip borders/text, enabled switches and shield icons. Main filled buttons use the neutral `button`/`button-text` pair rather than blue. `danger` is the theme's warning/error foreground role.

### Neutral

`screen` is the page canvas, `card` the navigation/mini-player surface, and `grouped` the list, field, chip and notice fill. `text`, `muted`, and `border` carry the information hierarchy. Dark muted foreground was raised from upstream #838383 to the recorded dark-muted token for readable small text. Toggle off and thumb colors are explicit fixed component values.

## Typography

DM Sans is loaded through `@expo-google-fonts/dm-sans`, using `DMSans_400Regular`, `DMSans_500Medium` and `DMSans_700Bold`. Shared Label defaults to 14px regular with line-height exactly 1.45 times its size; bold labels use 700. Titles use 28px bold, -0.8px tracking and 18px bottom margin. Caption labels commonly use 11–12px; mobile navigation uses 10px. Do not round the implementation's line heights to the provisional 14/20 or 28/40 shorthand.

Georgia at 43px/44px with -1px tracking belongs only to the fictional large album artwork. Its DM Sans artist label is 10px with 3px tracking, and its demo label is 9px with 2px tracking. This is artwork typography, not a second UI font.

## Layout

At widths below 760px use bottom tabs and 20px page padding. At 760px and above use a 215px sidebar and 32px page padding. The shell caps at 1400px; content caps at 680px on Now Playing and 780px on other routes. The header is 64px tall. Safe-area insets protect the top and bottom edges.

Groups have 16px horizontal inset and 16px vertical margins. Shared rows use a 12px gap; list rows have 74px minimum height and 13px vertical padding. Control targets have a 44px minimum; navigation targets have 50px minimum height. Now Playing centers artwork up to 300×210px. Demo routes retain a mini player with 44px artwork. Library omits the fictional mini player; an active Spotify track instead appears in the shared live-player strip. On the live player, track identity, timeline, transport and the line-skipping toggle precede cover artwork and secondary navigation so the essential controls remain early in the mobile flow.

## Elevation & Depth

The implemented system is flat: no shared shadows or animated elevation. Tonal surface changes and thin dividers provide structure. Web keyboard focus uses a 2px solid #4b7cf3 outline with a 3px offset in `apps/app/global.css`, including in light mode. Pressed opacity provides immediate feedback; no transition duration or easing token is defined.

## Shapes

Groups and notices use 12px corners. Buttons, fields, chips and navigation items use 9px corners. Artwork uses 7px large and 6px small corners with clipped geometry. Icon buttons use a 30px radius with 44px or 56px square targets. The demo badge uses 5px corners. List dividers use React Native hairlines; shell and field borders use 1px strokes.

## Components

### Buttons

Primary buttons use inverted neutral theme colors; secondary buttons use grouped fill and text foreground. Both have 11px vertical/16px horizontal padding and 44px minimum height. Pressed opacity is 0.65; disabled opacity is 0.4. Icon buttons are transparent at rest, or neutral-filled at 56px when prominent; pressed opacity is 0.6 and disabled opacity is 0.4. Tabler icons typically use 1.7 stroke width.

### Chips

Grouped fill, 1px border and 12px labels distinguish profile/filter choices. Selected chips use the primary color for both border and text. Padding is 10px vertical/13px horizontal with 44px minimum height; pressed opacity is 0.65.

### Cards / Containers

Group containers use grouped fill, 12px corners and 16px horizontal inset. Notices use 16px all-around padding. List rows separate with hairlines except for the last row. These are tonal containers, without shadows.

### Inputs / Fields

Fields use grouped fill, border stroke, muted placeholder, 9px corners and 13px padding, with a 46px minimum height. Text uses 14px DM Sans regular. Shared fields cap input at 120 characters. Web focus follows the shared outline treatment.

### Navigation

Five destinations remain available: Now Playing, Library, Profiles, Activity and Settings. Selected phone tabs use primary-colored icon/text. Selected desktop items use grouped fill and normal text; other items use muted foreground. Pressed opacity is 0.6. The shell identifies the current route and displays a bordered status badge: DEMO on scaffold routes, SPOTIFY on Library and catalog search, and UNFILTERED, LINE SKIP or STOPPED on the Spotify playback pilot according to opt-in filtering and fault state. LINE SKIP identifies the experimental mode, not verified protection.

### Playback and artwork

The player combines fictional geometric album art, title/artist, timeline, controls, profile selection and a filtering explanation. Demo artwork is semantic React Native geometry. Library uses Spotify-provided cover imagery and the existing grouped-list, chip, field and button vocabulary; this adds no general theme tokens. Catalog search reuses the shared field, buttons, notices, rows and theme roles, with paginated results and an original-album Creep by Radiohead pilot entry. Live filter controls reuse profile chips, a switch and explanatory notices; planned skips use the existing danger role in the timeline. These are extensions of the incumbent system, without new theme tokens. Album palettes remain local to Artwork and are not general UI theme colors. The web seek control supports keyboard adjustment and exposes its value to assistive technology; consult player source for exact behavior.

## Do's and Don'ts

- Do preserve semantic dark/light role pairs and the approved grouped-list character.
- Do use named accessibility labels, selected/checked states and visible web focus.
- Do keep demo status and simulated-action explanations clear.
- Do preserve provenance: runtime icons come from `@tabler/icons-react-native`, DM Sans from the Expo Google Fonts package, and original shield/check PNGs were generated with Pillow. Expo template leftovers are not used by app config.
- Don't apply the album's Georgia lettering or cover palettes to general UI controls.
- Don't add decorative shadows or animation as if they were established tokens.
- Don't present demo playback as live, or imply verified protection or validated background filtering. The user reports Spotify account Library access working. Opt-in foreground line skipping uses independently sourced timed lyrics and playback state; limited vocabulary, approximate whole-line seeks and pause-on-fault behavior must remain explicit. Only metadata goes to the lyric provider; Spotify audio is never captured or analyzed. Real LRCLIB data and simulated SDK tests establish the current test boundary; audible timing and real-device background behavior remain unverified.
