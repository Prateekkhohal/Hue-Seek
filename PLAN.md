# Hue & Seek — Build Plan

Working checklist for the MVP build. Spec and design decisions live in
[CLAUDE.md](CLAUDE.md) — this file only tracks execution. Check items
off as they're completed and verified in Lens Studio, not just written.

## CURRENT STATE (resume point for any new session — updated 2026-07-16)

**MVP Phases 0–5 are COMPLETE and verified in Preview.** Project is saved.
The full loop works: Landing (title + LIVE/PICTURE + 60/120/240s picker) →
round (random stage picture or camera feed, capsule character, joystick,
painting) → AI Score screen → play again.

Scene structure (all built via editor scripting, all wired):
- `GameManager` (root) holds ALL logic script components: GameFlowManager,
  RoundManager, PaintController, JoystickController, ColorPickerController.
  Cross-references wired via editor dynamic property access.
- `UI Camera` (ortho, near=-500, order 10, own LayerSet) → `Landing`,
  `Round` (TimerText, JoystickBase+Knob, CurrentColorIndicator,
  ColorPickerPanel with wheel/RGBA sliders/Pick/Erase, SubmitButton,
  TouchCursor), `Score` (4 texts) roots.
- `Stage Camera` (ortho, order -10, own layer) → `StageBackground` Image
  (random of 11 Stage* textures per Picture round).
- `Camera Object` (perspective, order 0) renders `Character` (6 capsule
  parts w/ colliders) + runtime `Dab` objects.

Current feature set (each user-requested and verified):
- Color picker panel: HSV wheel + R/G/B/A sliders + Pick (one-shot
  eyedropper from real background pixels) + Erase toggle. NO palette,
  NO background-tap picking. Indicator button opens panel.
- Painting (v5 — TEXTURE-LAYER): each rig part has a 128² procedural
  canvas texture (SimplePBRMaterial clone, CPU buffer + setPixels).
  Stamps map hit → part-local → cylindrical UV (u=atan2(z,x) wrap,
  v=(y+50)/100, anisotropic elliptical brush). Overpaint = pixel
  overwrite (NO dab objects, NO z-fighting); eraser stamps base color
  (235,235,240). Stamp history (UV) kept for scoring; UV-space spacing
  throttle; 0.3s round-start grace. Touch cursor: brush icon in live
  paint color / picker icon when eyedrop armed, exactly at touch point.
  Submit (green tick, top-right) ends round early. Palette button is
  NEVER color-tinted (user decision); dims 35% in eraser mode.
  Precision: strokes interpolate between touch-move events (no gaps on
  fast drags); per-part mesh geometry measured (capsule r=25 h=100,
  sphere r=50) so brush is round and correctly sized. Paint-splash
  droplets (4-6 tiny spheres, normal-biased spray, gravity, shrink,
  0.3-0.5s life, 40-particle budget) spawn per stamp.
  2026-07-17 additions: REALTIME eyedropper (Pick arms a cached
  PixelSampler snapshot; touch-drag live-previews the color on the
  picker cursor, release confirms); public Inspector offsets
  brushCursorOffset/pickerCursorOffset on PaintController (default
  0.045,0.075 = icon tip at touch); eraser icon (user asset) on the
  Erase button + eraser-mode cursor; TIMER PICKER REMOVED — fixed 120s
  (user decision), Timer60/120/240 objects deleted and inputs removed
  from GameFlowManager (LS errors on null-wired declared @inputs — remove
  the @input, don't null it). User added: landing art ("Landing" texture
  on Screen Image under Landing root), "User-Camera" circular camera
  cutout under UI Camera, Finish/Round-Circle-Background/Mask/
  ScreenTexture textures, eraser icon.
  2026-07-17 later batch (all verified in Preview):
  - "User-Camera" face cutout HIDDEN during LIVE rounds (redundant over
    the live feed; user decision), visible on landing/picture/score —
    GameFlowManager `userCameraRoot` input + setUserCameraVisible().
  - Score screen: full-screen Finish.jpg background ("FinishBackground"
    Image under Score, root "Image" material cloned at runtime with
    `finishTexture` input, stretch FillAndCut, renderOrder -1 so texts
    stay on top). Score texts repositioned into the art's sky band
    (title +0.42..+0.62, verdict +0.24..+0.40) and grass band (detail
    -0.66..-0.54, share -0.92..-0.72).
  - Palette button shows palette.png EXACTLY as authored — original
    colors, whitenIcon() removed from setupIndicator (user decision:
    never recolor the palette image; eraser-mode 35% dim kept).
  - RESPONSIVE UI via built-in Screen Regions + constraints (user
    decision — a custom ResponsiveUI.ts script was tried first and
    deleted): each state root got a child SafeArea object
    (ScreenTransform full-anchor + ScreenRegionComponent SafeRender —
    BOTH components required, region alone collapses children) holding
    the HUD: Landing/SafeArea (title+mode buttons), Round/SafeArea-Round
    (timer, joystick, indicator, picker panel, submit),
    Score/SafeArea-Score (4 texts), UI Camera/SafeArea-Top (User-Camera).
    Backgrounds (Landing art, FinishBackground) + TouchCursor stay
    full-frame outside the regions (cursor uses full-screen touch
    coords). Square controls converted to fixed-size constraints
    (point anchor + unit offsets + fixedWidth/fixedHeight, screen
    height = 20 units): JoystickBase 2.3x2.75 @(-0.67,-0.61),
    CurrentColorIndicator 1.4x1.4 @(0.76,-0.865), SubmitButton 1.5x1.5
    @(0.815,0.45) (moved below Snap's right icon column), TouchCursor
    1x1, ColorPickerPanel 6.5x8.6 @(0,-0.05). TimerText moved BELOW the
    face circle (y +0.42..+0.56) + renderOrder -2 so the open picker
    panel (bg renderOrder -1) covers it; TitleText y +0.28..+0.52.
    Character rig scaled to 0.8. Verified with Snap UI overlay sim ON
    (Galaxy S20): full loop, no chrome collisions, wheel circular,
    painting works on scaled rig.
  - DUAL TIMER (user request — live timer floated mid-face once the
    circle hid): TimerTextTop duplicate at safe y +0.78..+0.92;
    RoundManager `timerTextTop` input, beginRound enables top slot in
    LIVE / below-circle slot (TimerText) in PICTURE, updateTimerLabel
    writes both.
  - Joystick + palette button mirrored per user request: both fixed
    2.3x2.3 at (-0.7,-0.7) / (+0.7,-0.7).
  - Second scale-down pass (user request): joystick/palette 2.0x2.0,
    submit 1.3x1.3, cursor 0.85, picker panel 5.8x7.7, face circle 2.6,
    timer font 46, character rig 0.65.
  - Side-edge anchoring (user request — controls clipped on wide sims):
    joystick/palette/submit anchor to the screen EDGE (anchor x = ±1)
    with fixed 1.15-unit inward margins via unit offsets — margin is
    constant on every device width. (Preview note: feeding a 9:16 video
    into a taller device sim crops ~1.1 units per side off the render;
    1.15 clears it. On-device the render matches the screen.)
  - CAPTURE-MODE support (user request): the Round HUD region
    ("CaptureArea-Round", ex SafeArea-Round) switched to
    ScreenRegionType.Capture so the whole game stays inside the area
    recorded in a snap — playable while capturing. Landing, Score, and
    the face-cam circle stay SafeRender. Runtime enum is `Capture`
    (docs may say CaptureRender — wrong).
  - TOUCH BLOCKING: `global.touchSystem.touchBlocking = true` in
    GameFlowManager.onAwake — the lens consumes ALL screen touches so
    Snapchat gestures (carousel taps, swipes, double-tap camera flip)
    can't fire mid-game. Snapchat's chrome buttons render above the
    lens and stay usable (incl. the top-right camera-flip button, so
    Live mode can still switch cameras). Re-allow a gesture later with
    `global.touchSystem.enableTouchBlockingException("TouchTypeDoubleTap", true)`.
    EXCEPTION added (user request): "TouchTypeTap" passes through — a
    plain tap triggers Snapchat's native collapse of its UI into the
    clean capture screen AND still reaches the lens for gameplay. Only
    taps pass; pan/swipe/pinch/double-tap remain blocked. Related APIs
    for later: SnapRecordStartEvent/SnapRecordStopEvent/
    SnapImageCaptureEvent + scene.getRecordingState()
    (Preview/Photo/Video) to react to recording — e.g. auto-hide hints
    or pause the timer during capture. On-device verification needed
    (preview doesn't simulate the tap-collapse).
  - Score art now verdict-based (user assets): Finish-Happy.jpg when
    hidden (NOT FOUND), Finish-Sad.jpg when SPOTTED —
    `finishHappyTexture`/`finishSadTexture` inputs replace the single
    finishTexture; texture swapped in showScore(). Sad branch verified
    in Preview (score 0 → SPOTTED → sad art).
- Joystick: user-positioned, controller icon base + circle knob marker.
- DynaPuff-SemiBold font applied to all 19 Texts.
- Icons (user-added, black → whitened at runtime for tinting):
  controller, paint-brush, color-picker, check, cross, palette.
- Scoring: PaletteSampler (getPixels) around final position → Blend 50% +
  Creativity 20% + Technique 30% = AI Score, hidden threshold 65.

**Immediate next steps:** on-device test via Pairing (validates getPixels
+ full loop on hardware); export size check (raw stage PNGs 17.6MB →
expect ~5.5MB compressed, budget 8MB, fallback resize to 512/drop to 8);
hand playtest for score-weight tuning. Then Phase 6 (leaderboards, remote
pictures) only after the MVP is fun.

**Gotchas for future sessions** (full list in CLAUDE.md "Verified
technical findings" — READ IT FIRST): ortho cameras need negative near;
Text backgroundSettings hugs glyphs (use Image+"Image" material for
rects); "ImageMaterial" asset is a broken stub, "Image" is the real one;
primitive meshes are 100 units at scale 1; runtime-created objects need
layer copied from parent; black icons need whitenIcon() before tinting;
scene-serialized @input values override script defaults after edits.

## Phase 0 — Housekeeping ✅

- [x] Create `Assets/Scripts/` folder
- [x] Migrate `PaintController.ts` from `Prototpe-files/` (evolve for capsule rig later; keep dab logic)
- [x] Migrate `ScoreUtils.ts` (base for the three-component AI Score)
- [x] Migrate `PaletteSwatch.ts`
- [x] Migrate `RoundManager.ts` (will be split into `GameFlowManager` + round logic in Phase 2)
- [x] Fix imports/paths, confirm TypeScript compiles clean in Lens Studio (touch-event types corrected)
- [x] Delete `Assets/Prototpe-files/` (scripts + `.meta` files)

## Phase 1 — Technical spikes ✅ (both passed — see CLAUDE.md findings)

- [x] **Spike A — pixel sampling:** works on bundled picture (768×1344, 32×32 region in 22 ms, correct colors)
- [x] Spike A on the Device Camera Texture — works in Preview (25 ms); **on-device check still pending** (needs paired phone)
- [x] Measure Spike A cost — ~22–25 ms once per scoring: acceptable
- [x] Record Spike A verdict in CLAUDE.md → real pixel sampling for BOTH modes
- [x] **Spike B — painting on the rig:** raycast vs capsule collider returns correct hit position + normal; miss detection works
- [x] ~~Tap-to-fill fallback~~ — not needed, Spike B passed
- [x] Record Spike B verdict in CLAUDE.md → dab decals at raycast hits
- [ ] Cleanup: delete `SpikeA_PixelSampling.ts` / `SpikeB_RaycastPaint.ts` + spike scene objects once PaintController v2 exists (keep Spike A script until the on-device test is done)

## Phase 2 — Game flow shell ✅ (verified in Preview via injected taps)

- [x] `GameFlowManager.ts` state machine: Landing → Round → Score → Landing
- [x] Landing screen UI: title heading
- [x] Mode buttons: **Live** and **Picture**
- [x] Timer picker under mode buttons: **60 / 120 / 240 s** (selectable, persists into the round)
- [x] Wire buttons → mode + duration passed to round start (log confirms `mode=picture, duration=120s`)

## Phase 3 — Picture mode core loop ✅ (verified in Preview via injected gestures)

- [x] Generate 11 placeholder pictures (Forest, Desert, NeonArcade, Urban, Beach, Snow, Autumn, Underwater, Sunset, Meadow, Volcano), 768×1344
- [ ] Verify total picture size fits the 8 MB budget — **raw PNGs are 17.6 MB; LS export compression should land ~5.5 MB but MUST be verified at first export** (fallback: `ResizeRasterTexture` to 512 wide or drop to 8 pictures)
- [x] Random picture per round (in `RoundManager.beginRound`; separate PictureProvider not needed)
- [x] Capsule-only character rig (Primitive Pack meshes + capsule/sphere colliders, 6 parts under `Character`)
- [x] `JoystickController.ts`: drag-anchored joystick → clamped 2D movement — verified, character moves + clamps
- [x] Painting on the rig: raycast dab spheres parented to hit body part — verified with green + pink dabs
- [x] ~~Palette swatch row~~ → **color picker panel** (user decision): current-color button opens circular
  HSV wheel + R/G/B/A sliders + dedicated **Pick (eyedropper) button** — verified: wheel red → red dabs +
  red indicator, B slider tap moved blue 0.11→0.51, sliders sync to held color on open, Pick→tap sampled
  brick color from the urban stage, round-start tap leak fixed with 0.3s grace period
- [x] Plain background taps do NOT select color (removed by user request; eyedropper only via Pick button)
- [x] **Eraser tool** (user request): red Erase button in the picker toggles erase mode — drags over the rig
  remove dabs (verified 4→0); indicator goes ghost-white while erasing; picking any color returns to paint
- [x] Dab budget fix (user-reported): stroke spacing throttle (skip stamps <½ dab apart) + cap 500→1500;
  coverage rescaled to ~350 dabs = full rig
- [x] Picker text visibility fix: panel background Image renderOrder=-1 (Texts were rendering behind it)
- [x] Dab look fix (user-reported): dabs are now flat unlit paint discs (Image material + solid texture,
  flattened 0.35 on the normal axis, oriented via quat.lookAt to the surface) — no PBR lighting rims
- [x] Repainting fix (user-reported): new dabs z-fought inside old ones; each repaint now lifts
  0.3/layer (capped at 6) along the normal — verified red → cyan overpaint
- [ ] Scoring note: painted-over dabs still count in color totals (hidden layers inflate Creativity
  slightly); revisit if playtesting shows it matters — eraser gives players a workaround
- [ ] Picker polish: brighten Pick/Colors/X labels, ~~wheel size is tuned for 9:16 (recompute for other
  aspects)~~ → fixed 2026-07-17 (panel is a fixed-size element inside the safe region now), consider a
  brightness slider for the wheel (wheel is fixed at V=1; use RGB sliders to darken)
- [x] Round timer using the selected duration, countdown UI top-center
- [x] Full loop playable in Preview: land → Picture → move → paint → timer ends → score placeholder → landing
- [ ] Polish (defer): clear default texture tint on swatches/joystick, rig proportions, dab size tuning, Landing button styling

## Phase 4 — Scoring + share screen ✅ (verified: off-palette paint on Neon Arcade → AI Score 48, SPOTTED!)

- [x] `PaletteSampler.ts`: dominant-palette extraction (48px region, top-4 colors) around the character's final position
- [x] Blend Score: color-distance match vs sampled palette (`ScoreUtils.computeBlendScore`)
- [x] Creativity Score: color variety (70%) + evenness (30%)
- [x] Algorithm Score: coverage (60%) + body parts painted (40%)
- [x] Combined **AI Score** = blend 50% + creativity 20% + technique 30%; `hiddenThreshold` (65) tunable in Inspector
- [x] Score screen: AI Score + NOT FOUND/SPOTTED verdict + breakdown + share-with-friends prompt, painted character stays visible
- [x] Play Again → tap returns to Landing, stage/character hidden, paint reset
- [ ] Tune: more playtesting of weights/threshold once painting by hand (not injected gestures) is possible
- [ ] Verify Live-mode scoring path on device (camera texture sampling at score time)

## Phase 5 — Live mode ✅ (verified in Preview: full LIVE round → AI Score 49, SPOTTED!)

- [x] Mode branch: `beginRound("live", …)` disables the Stage Camera so the camera feed
  (Render Target input) shows through; all round systems (joystick, painting, timer) are mode-agnostic
- [x] Scoring path: `computeRoundScore()` samples the **Device Camera Texture** (wired as
  `cameraTexture` input on RoundManager) instead of the stage picture when mode = "live"
- [x] Verified in Preview: LIVE round → feed background + character + HUD → paint → timer end →
  score screen with camera-sampled Blend (83) and correctly-low Creativity/Technique for one-color paint
- [x] Camera flip: by design a non-issue — the character is a world-space overlay independent of
  which camera feeds the Render Target (confirm visually during the on-device pass)
- [ ] On-device test: full Live round on a real phone via Pairing (also confirms Spike A on device)

## Phase 6 — Post-MVP (do not start until MVP is fun)

- [ ] Leaderboard integration (`LeaderboardModule`): submit AI Score, handle failure callback
- [ ] Decide leaderboard reset cadence + per-mode vs combined boards (user decision)
- [ ] Remote picture API via `RemoteServiceModule` (needs Snap domain allowlist — budget review time)
- [ ] Model-based scoring layer behind the same "AI Score" label (fallback to tier 1 on failure/timeout)

## Release checklist

- [ ] Total Lens size under 8 MB
- [ ] Final name/branding decided (avoid "Meccha Chameleon" resemblance)
- [ ] Lens icon (`GenerateLensIcon`)
- [ ] Test on low-end device for dab-count performance ceiling
