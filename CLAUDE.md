@AGENTS.md

# Hue & Seek — Project Context

Camouflage-painting Lens for Snapchat, built in Lens Studio. This file is
the single source of truth for any agent session working on this repo.
It supersedes the removed `CLAUDE-Context.md` and the old prototype README.

## Game overview

Player controls a capsule-rig character with an on-screen joystick,
positions it over the background, and paints it with palette colors to
blend in before the timer runs out. At the end of the round they get an
**AI Score**, see whether they'd have been "found," and are prompted to
share the Lens with friends to compare scores.

## Design spec (confirmed decisions — do not re-litigate)

### Landing screen
- Title heading + two game-mode buttons: **Live** and **Picture**.
- Under the mode buttons: **selectable round timer — 60, 120, or 240
  seconds** — chosen before the round starts.

### Live mode
- Device camera feed as the live background. **Both front and back
  cameras are supported** (painting yourself into your own selfie feed
  is an intended use).
- Character is a simple screen-space overlay on the feed — **no world
  tracking / AR anchoring**. Joystick moves it in 2D over the feed.

### Picture mode
- Static background image chosen **at random each round** from **11
  bundled pictures** (AI-generated placeholders for now: Forest, Desert,
  NeonArcade, Urban, Beach, Snow, Autumn, Underwater, Sunset, Meadow,
  Volcano — 768×1344, compressed for size budget).
- Post-MVP: fetch pictures at runtime via remote API for unlimited
  variety (requires Remote Service Module + Snap domain allowlist).

### Character
- Simple 3D player rig built **only from Lens Studio primitive capsules**
  (head, torso, limbs). No imported models — keeps asset size near zero.

### Painting
- Dab-stamping approach (small colored dabs at raycast hit points on the
  rig), evolved from the earlier prototype — not true pixel painting.
- **Color selection — NO predefined palette** (user decisions 2026-07-15):
  everything goes through the **color picker panel**
  (`ColorPickerController`), opened by tapping the current-color
  indicator: circular HSV wheel (hue = angle, saturation = radius, drawn
  at runtime into a procedural texture so taps map exactly) + R/G/B/A
  slider keys + a dedicated **Pick (eyedropper) button** that arms a
  one-shot background pick — the next tap samples the real pixel color
  via `getPixels` (stage picture in Picture mode, live camera feed in
  Live mode). Plain background taps do NOT pick color (removed by user
  request). Painting is suspended while the panel is open; sliders sync
  to the held color on open. A 0.3s grace period after round start stops
  the mode-button tap from leaking into painting.

### Scoring — "AI Score"
- The UI presents one combined **AI Score**, composed of three parts:
  1. **Blend Score** — color-distance match between painted colors and
     the background palette around the character's final position.
  2. **Creativity Score** — rewards color variety / effort (prevents
     monochrome-smear exploits).
  3. **Algorithm Score** — coverage / technique component (how much of
     the rig got painted, dab distribution).
- All three are computed by our own algorithms at MVP. True model-based
  scoring (vision model via Remote Service Module) is a post-MVP stretch
  that slots in behind the same "AI Score" label.

### Result & sharing
- Final shareable score screen: AI Score + Found/Spotted beat + prompt
  to share the Lens with friends (Snapchat's native Send/Share flow —
  platform-level, not built in-Lens).

### Hard budget
- **8 MB max Lens size.** The 11 pictures are 768×1344 PNGs, ~17.6 MB raw
  on disk — Lens export compression is expected to land ~5.5 MB but
  **must be verified at first export** (fallback: resize to 512 wide or
  drop to 8 pictures; see PLAN.md Phase 3). Scripts and the capsule rig
  are negligible.

## Verified technical findings

- **Spike A PASSED (2026-07-14, editor preview):**
  `ProceduralTextureProvider.createFromTexture()` + `getPixels()` works
  on both bundled picture textures and the **Device Camera Texture**.
  A 32×32 region read takes ~22–25 ms → fine as a once-per-scoring
  operation, never per frame. Sampled colors are correct (forest picture
  → dark-green dominant). On-device confirmation still pending.
  → Both modes use real background-pixel palette sampling for scoring.
- **Spike B PASSED (2026-07-14):** touch → `camera.screenSpaceToWorldSpace`
  ray → `Physics.createGlobalProbe().rayCast()` against a capsule
  `ColliderComponent` returns accurate hit position + surface normal.
  → Painting = dab decals anchored at raycast hits on the rig's capsule
  colliders. Tap-to-fill fallback not needed.
- **Editor automation:** ScriptComponent inputs can be set from
  `ExecuteEditorCode` by dynamic property access
  (`(comp as any)['inputName'] = assetOrComponent`) — `inputNames`
  lists them. Use `Editor.Shape.createCapsuleShape(scene)` for capsule
  colliders. Touch-event callbacks in Lens scripts are typed
  `TouchStartEvent`/`TouchMoveEvent` (NOT `TouchStartEventArgs`).
- **Screen UI built via editor scripting (Phase 2 lessons):**
  - The orthographic UI camera MUST have a **negative near plane**
    (near=-500, far=500 works) — the ScreenTransform layout system
    places all UI at the camera's own z-plane (z=0), which a
    perspective-style near=1 clips entirely. This was the cause of
    hours of invisible-UI debugging.
  - Hierarchy: ortho Camera → state roots with ScreenTransform as
    direct children (no Canvas — a Canvas doesn't auto-fit the camera
    and mis-scales anchors).
  - Responsive layout (2026-07-17): HUD lives under per-root "SafeArea"
    objects carrying BOTH a full-anchor ScreenTransform AND a
    ScreenRegionComponent (SafeRender) — the region component alone
    collapses children into a centered blob. Square controls use
    fixed-size constraints (point anchor + unit offsets +
    fixedWidth/fixedHeight; screen height = 20 units) so they never
    distort across aspects. Backgrounds and the TouchCursor stay
    full-frame (cursor math uses full-screen touch coords).
  - Camera renderOrder: LOWER renders earlier; the UI camera gets a
    higher renderOrder than the main camera and shares its Render
    Target.
  - Keep the UI camera's renderLayer and every UI object's
    `layers` on the same LayerSet, distinct from the main camera's.
  - Buttons: Text components with `backgroundSettings` fills +
    `ScreenTransform.containsScreenPoint(touchPos)` hit tests — no
    materials or InteractionComponents needed. BUT `backgroundSettings`
    only draws behind glyphs — for solid color rectangles (swatches,
    joystick) use an **Image component with the "Image" material**
    (clone at runtime, tint via `mainPass.baseColor`).
- **Materials (Phase 3 lessons):** the project's "Image" material is the
  real flat textured one (`baseTex` + `baseColor` params); the similarly
  named "ImageMaterial" is a passless stub whose runtime `clone()`
  crashes (`!passList->empty()`). `primitive_sample_material` (Primitive
  Pack) is a graph material with obfuscated port names — `baseTex`
  assignment is a silent no-op; `SimplePBRMaterial` has real
  `baseColor/baseTex/metallic/roughness`. Always clone shared materials
  before mutating passes.
- **Runtime object creation:** `global.scene.createSceneObject` objects
  need `obj.layer = parent.layer` (default layer differs) and fresh
  `RenderMeshVisual`s need `clearMaterials()` + `addMaterial(...)`.
  **Primitive Pack meshes are 100 units across at scale 1** — a "3.5cm"
  dab needs world scale 0.035, not 3.5 (a 350-unit sphere swallows the
  camera and backface-culls itself invisible).
- **Multi-camera compositing:** all cameras share the one Render Target;
  order: Stage Camera (ortho, order -10, picture bg) → Camera Object
  (perspective, 0, 3D rig) → UI Camera (ortho, 10, HUD). Lower
  renderOrder renders earlier. Stage/UI cameras use distinct LayerSets.
- **No turnkey runtime AI** for mobile Lenses: `MLComponent` needs a
  bring-your-own trained model; `RemoteServiceModule` needs Snap's
  domain-allowlist review. Hence custom scoring at MVP.
- `LeaderboardModule` / `Leaderboard` exist (global + friends,
  TTL resets) — planned post-MVP. Handle the failure callback; scores
  need user opt-in.

## Build plan

The phased checklist with per-task checkboxes lives in
[PLAN.md](PLAN.md) — keep it updated as tasks complete. Phase summary:
0 Housekeeping (migrate prototype scripts) → 1 Technical spikes (pixel
sampling, rig painting) → 2 Game flow shell → 3 Picture mode core loop →
4 Scoring + share screen → 5 Live mode → 6 Post-MVP (leaderboards,
remote pictures, model scoring). Spike verdicts from Phase 1 gate the
scoring and painting designs downstream.

## Commit rules

- **Never add AI co-author or attribution lines** to commits — no
  `Co-Authored-By: Claude ...` (or any AI model) trailers, no
  "Generated with ..." lines, in commit messages, PR descriptions, or
  anywhere in git history.

## Versioning

- Semver lives in the repo-root `VERSION` file, mirrored into
  `Assets/Scripts/Version.ts` (`LENS_VERSION`) for in-lens display.
- `.githooks/pre-commit` auto-bumps on every commit. Default bump is
  **patch** (bug fixes); set an env var for bigger bumps:
  `BUMP=minor git commit ...` (feature added), `BUMP=major` (major
  revamp), `BUMP=none` (skip). Staging `VERSION` by hand also skips the
  auto-bump. Commits from GitHub Desktop always take the patch default
  (no way to pass the env var there).
- One-time setup per clone: `git config core.hooksPath .githooks`.
- Snapchat has no local build step — publishing from Lens Studio
  versions submissions on Snap's backend automatically. This file is
  the local source of truth; tag `vX.Y.Z` when publishing.

## Agent orchestration

Three-tier model for sessions on this repo:

| Tier | Model | Role |
|---|---|---|
| **Queen** | Fable (main session) | Owns full context and this plan. Talks to the user, makes design calls, decomposes work, integrates and ships results. Does small/critical tasks directly. |
| **Supervisor** | Opus (`model: "opus"` subagent) | Reviews Worker output before integration: correctness, Lens Studio API usage, adherence to this spec. Verification and architectural checks. |
| **Worker** | Sonnet (`model: "sonnet"` subagent) | Executes well-scoped, self-contained implementation tasks handed down by the Queen (single script, single UI screen, asset generation batch). |

Rules:
- The Queen orchestrates; it does not blindly forward user messages —
  it turns them into scoped task briefs with acceptance criteria.
- Workers get narrow briefs (files to touch, spec section, done
  criteria) and must not expand scope.
- Supervisor review happens before Worker output is integrated into the
  scene/project — Queen applies fixes or bounces the task back.
- Trivial edits and anything touching live Lens Studio editor state
  (MCP tools) stay with the Queen — subagents should not race each
  other on editor mutations.

## Open decisions (flag to the user, don't assume)

- Final game name/branding ("Hue & Seek" is the working title — avoid
  resemblance to existing "Meccha Chameleon" branding).
- Leaderboard reset cadence and per-mode vs combined boards (post-MVP).
