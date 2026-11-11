# Rehearsal: Audio Angel player and filters

Gold: `phone-touch`. Kept the kit Phone, measured Expand, touch cursor, retained expanded element and bottom bleed. Replaced the workout list/timer with fictional album art, player controls, a contextual preference sheet and a confirmation.

Beats: compact current track → full player → filter sheet → enable Drug references → hold Preference updated → return to the same listening position → minimize. Approximately 13 seconds including pointer travel. The preference reset happens only with the sheet offscreen.

Captured: a 560 × 620 wide stage in a desktop viewport; compact at viewport 390, finally 358 × 480; light look only; a complete sampled loop and next-start frames; marked states; desktop and phone reduced-motion posters. Chromium 1243, headless Linux. The standalone source typecheck and Vite production build passed.

Film:
- Early artwork-child clipping/padding warnings: replaced the decoration with clipped CSS pseudo-element album geometry, leaving the visible art unchanged.
- Phone gutter and sub-10px text: 24px gutters and larger compact metadata.
- Confirmation half-pixel glyph: 20px check in a 20px line box.
- Sheet 2px above the lower crop: moved its resting top to leave a full lower gutter in the wide composition.
- Density review: tightened compact height from 550 to 480; reviewer scored the finding resolved in crop-phone.png at 1.5s and 9.0s.
- Compact title inset: retained artwork/track text now shifts by the compact card inset while folding, preserving interior padding.
- Loop-wide, loop-phone and marked-state gates reported rehearsal passed after mechanical fixes. They also reported sampling gaps, so motion coverage is inconclusive rather than an exhaustive pass.
- Hidden toggle reset creates a jump candidate after minimize. The entire sheet is offscreen at that point; this is the deliberate unseen illustrative reset, not a preference changing in view.
- A near-tangent candidate for the pause control belongs to the closed Expand's hidden content, not the visible compact card.

Review: a fresh reviewer inspected gold.png, final-phone.png, poster-final.png and states.png; requested the density fix above. Follow-up inspected crop-phone.png and marked that fix resolved. The filter poster was judged readable and balanced; no observed clipped words or island overlap.

Assumptions: this is a faux UI walkthrough, not the operational app. The timeline stays at 1:18 to illustrate position preservation. No detection guarantees, sound or real preference storage.

Unresolved: no observed material static issue after the density correction. Sampling gaps remain a limit on motion evidence.

Not checked: physical touch devices, every 40–80ms transition frame, 4× glyph inspection, smoothness at real-device refresh rates, offscreen/resume transitions, mid-motion reduced-motion changes, production-app integration. The live app's Loading → Next playback bug is outside this illustration and remains unchanged.
