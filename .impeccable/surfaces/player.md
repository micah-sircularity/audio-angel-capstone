# Audio Angel scaffold
Mode: Operate. Scope: Expo PWA screens and shared architecture, demo data only.

## Direction contract
THESIS: The player is the main surface; profiles change what commands the timestamp planner schedules. Activity explains simulated actions.
OWN-WORLD: Preserve the user-approved T3 mobile-derived dark/light theme, DM Sans, Tabler outlines, grouped lists and quiet controls.
STORY: Pick a demo song, select a profile, preview a flagged span, then see the simulated action and reason.
FIRST VIEWPORT: Compact header, profile picker, centered 300×210 demo album art, title and artist, timeline, playback controls, filtering explanation. Bottom navigation on phone; sidebar on desktop. Other routes have a mini player.
FORM: User-assigned HTML mockup approved in this thread; no random direction seed. User explicitly requested HTML rather than generated raster mockups. Source reference: pingdotgg/t3code apps/mobile.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints
No Spotify or lyrics credentials required. No audio access. No background guarantees or verified protection counts. Demo categories that have no evaluator must say so. Preserve the approved mobile layout rather than inventing a new visual direction.

## Assets
Icon PNGs are original geometric shield/check marks generated with Pillow. Album cover geometry is semantic React Native layout from the approved HTML mockup. DM Sans from @expo-google-fonts/dm-sans; Tabler runtime SVG icons from @tabler/icons-react-native. Expo template asset leftovers are not used by app config.
