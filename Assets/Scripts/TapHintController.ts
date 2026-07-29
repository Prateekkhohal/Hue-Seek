// TapHintController.ts
// Owns the "tap here" hint animations (the Hint - Tap package art).
//
// Why this exists instead of the package's own VisualDemonstration script:
// all three hint instances are copies of the same prefab and therefore share
// ONE material asset (SpriteGraphPreset.mat) and one animated texture.
// VisualDemonstration writes alpha straight onto `mainPass.baseColor` without
// cloning, so the instances fight over a single alpha value — the first one to
// fade out blanks all of them, and a later instance's `initializeComponent()`
// (which ends in setAlpha(0)) wipes any hint already on screen. It also drives
// the shared AnimatedTextureFileProvider with per-instance loop counts and
// `pauseAtFrame(0)`, so a finite-loop instance stops the animation for
// everyone. On top of that it only ever triggers off CameraFront/CameraBack
// events, which fire once at lens start and never again.
//
// This controller clones the material per hint (independent alpha), starts the
// shared texture animation once on an infinite loop, and ties visibility to
// game state instead of camera events. The VisualDemonstration components on
// the hint objects are disabled in the scene.

const FADE_SEC = 0.25;

type Hint = {
  img: Image;
  alpha: number;
  target: number;
  rgb: vec3;
  // >=0 while a timed hold is counting down (stage hint); <0 = no auto-hide.
  holdLeft: number;
};

@component
export class TapHintController extends BaseScriptComponent {
  @input
  @allowUndefined
  liveHintImage: Image; // tap hint over the Live mode icon

  @input
  @allowUndefined
  pictureHintImage: Image; // tap hint over the Picture mode icon

  @input
  @allowUndefined
  stageHintImage: Image; // "tap to paint" hint shown at round start

  @input
  stageHintHoldSec: number = 3.0; // how long the stage hint stays up

  private hints: Hint[] = [];
  private live: Hint | null = null;
  private picture: Hint | null = null;
  private stage: Hint | null = null;
  private texturePlaying: boolean = false;

  onAwake() {
    // Adopt in onAwake, not OnStart: GameFlowManager sits above this component
    // on GameManager, so its OnStart (which calls showLandingHints) runs first.
    // Every onAwake runs before any OnStart, so this is the only safe slot.
    // The hints' own VisualDemonstration components are disabled in the scene,
    // so nothing else is writing to the shared material by now.
    this.live = this.adopt(this.liveHintImage);
    this.picture = this.adopt(this.pictureHintImage);
    this.stage = this.adopt(this.stageHintImage);
    this.startTextureAnimation();
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  // --- public API (called by GameFlowManager) ---

  // Landing screen is up: both mode hints pulse for as long as it is shown.
  showLandingHints() {
    this.setTarget(this.live, 1, -1);
    this.setTarget(this.picture, 1, -1);
  }

  hideLandingHints() {
    this.setTarget(this.live, 0, -1);
    this.setTarget(this.picture, 0, -1);
  }

  // Round started: the paint hint appears, holds, then fades on its own.
  showStageHint() {
    this.setTarget(this.stage, 1, this.stageHintHoldSec);
  }

  hideStageHint() {
    this.setTarget(this.stage, 0, -1);
  }

  hideAll() {
    this.hideLandingHints();
    this.hideStageHint();
  }

  // --- setup ---

  // Gives one hint Image a private copy of the shared material so its alpha is
  // its own, and starts it fully transparent.
  private adopt(img: Image): Hint | null {
    if (isNull(img)) return null;
    try {
      img.mainMaterial = img.mainMaterial.clone();
    } catch (e) {
      print("TapHintController: could not clone hint material - " + e);
      return null;
    }
    // The authored baseColor is opaque white, but VisualDemonstration may have
    // already knocked the shared alpha to 0 before we cloned — so take the rgb
    // and treat full opacity as 1 rather than trusting the current alpha.
    const c = img.mainPass.baseColor;
    const hint: Hint = {
      img: img,
      alpha: 0,
      target: 0,
      rgb: new vec3(c.r, c.g, c.b),
      holdLeft: -1,
    };
    this.applyAlpha(hint);
    img.enabled = false;
    this.hints.push(hint);
    return hint;
  }

  // All hints share one animated texture. Play it once, unbounded, and never
  // pause it — per-instance play/pause calls are what froze the animation.
  private startTextureAnimation() {
    if (this.texturePlaying) return;
    for (const h of this.hints) {
      const tex = h.img.mainPass.baseTex;
      if (!tex || !tex.control) continue;
      const provider = tex.control as AnimatedTextureFileProvider;
      if (!provider.isOfType("Provider.AnimatedTextureFileProvider")) continue;
      provider.play(-1, 0); // -1 = loop forever
      this.texturePlaying = true;
      return; // one call covers every instance sharing the texture
    }
  }

  // --- animation ---

  private setTarget(hint: Hint | null, target: number, holdSec: number) {
    if (!hint) return;
    hint.target = target;
    hint.holdLeft = target > 0 ? holdSec : -1;
    if (target > 0) hint.img.enabled = true;
  }

  private onUpdate() {
    const dt = getDeltaTime();
    for (const h of this.hints) {
      // A hint with a hold timer auto-fades once it expires.
      if (h.holdLeft >= 0 && h.alpha >= 1) {
        h.holdLeft -= dt;
        if (h.holdLeft <= 0) {
          h.target = 0;
          h.holdLeft = -1;
        }
      }
      if (h.alpha === h.target) continue;
      const step = dt / FADE_SEC;
      h.alpha =
        h.target > h.alpha
          ? Math.min(h.alpha + step, h.target)
          : Math.max(h.alpha - step, h.target);
      this.applyAlpha(h);
      // Derived from alpha every tick, never latched: a frame with dt == 0
      // leaves alpha at 0 right after a show, and a one-way disable here
      // would switch the Image off with nothing to switch it back on.
      h.img.enabled = h.alpha > 0;
    }
  }

  private applyAlpha(h: Hint) {
    h.img.mainPass.baseColor = new vec4(h.rgb.x, h.rgb.y, h.rgb.z, h.alpha);
  }
}
