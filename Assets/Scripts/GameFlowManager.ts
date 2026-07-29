// GameFlowManager.ts
// Top-level state machine: Landing -> Round -> Score -> Landing.
// Owns the landing screen (title, Live/Picture mode buttons, 60/120/240s
// timer picker) and decides which UI root is visible.
//
// Score state (user decision 2026-07-25): there is NO separate result
// screen any more — the full-screen finish art, the glass panel and the
// three breakdown bars all hid the art the player just painted. The round
// stays on screen exactly as the player left it (stage background +
// painted character) and only the AI Score + verdict line is overlaid.
//
import { RoundManager } from "./RoundManager";
import { TapHintController } from "./TapHintController";
import { makeSolidWhiteTexture } from "./PaletteSampler";

export type GameMode = "live" | "picture";

type FlowState = "landing" | "round" | "score";

@component
export class GameFlowManager extends BaseScriptComponent {
  @input
  landingRoot: SceneObject;

  @input
  roundRoot: SceneObject;

  @input
  scoreRoot: SceneObject;

  @input
  liveButtonText: Text; // label under the Live icon

  @input
  pictureButtonText: Text; // label under the Picture icon

  @input
  liveIconImage: Image; // square icon tile above the Live label

  @input
  pictureIconImage: Image;

  @input
  liveIconTexture: Texture;

  @input
  pictureIconTexture: Texture;

  @input
  titleText: Text; // flat source title — replaced by the arched version

  @input
  sndLanding: AudioComponent; // glitter shimmer when the landing shows

  @input
  sndClick: AudioComponent; // UI tap click

  @input
  sndHappy: AudioComponent; // NOT FOUND result

  @input
  sndSad: AudioComponent; // SPOTTED result

  @input
  roundManager: RoundManager;

  @input
  scoreTitleText: Text; // big "AI Score: NN" overlaid on the finished art

  @input
  sharePromptText: Text; // verdict line + share nudge + play-again hint

  @input
  userCameraRoot: SceneObject; // circular face-cam UI — hidden during LIVE rounds

  @input
  @allowUndefined
  tapHints: TapHintController; // "tap here" hint art on the mode icons + stage

  private state: FlowState = "landing";
  private selectedMode: GameMode = "picture";
  // Fixed round length (user decision 2026-07-17: no timer picker).
  private selectedDurationSec: number = 60;

  // Score reveal: the number counts up 0 -> aiScore with a single pop.
  private static readonly SCORE_REVEAL = 1.0; // s
  private scoreTarget: number = 0;
  private scoreAnimT: number = -1; // <0 = idle

  // Title intro: a paint dot hops across the arched letters, popping each
  // one, then the whole title does a final scale pop.
  private titleChars: {
    st: ScreenTransform;
    x: number;
    y: number;
    txt: Text;
    color: vec4;
  }[] = [];
  private titleDotST: ScreenTransform | null = null;
  private titleAnimT: number = -1; // <0 = idle
  private static readonly TITLE_DOT_TRAVEL = 1.4; // s across all letters
  private static readonly TITLE_POP = 0.45; // s of the final pop
  private static readonly TITLE_PAUSE = 10; // s rest before the loop repeats
  private static readonly TITLE_COLORS = [
    new vec4(1, 0.42, 0.42, 1), // red
    new vec4(1, 0.66, 0.3, 1), // orange
    new vec4(1, 0.85, 0.24, 1), // yellow
    new vec4(0.49, 0.85, 0.34, 1), // green
    new vec4(0.31, 0.76, 0.97, 1), // blue
    new vec4(0.7, 0.62, 1, 1), // purple
    new vec4(1, 0.43, 0.78, 1), // pink
    new vec4(0.3, 0.85, 0.75, 1), // teal
  ];

  onAwake() {
    // The lens consumes every screen touch so Snapchat's default gestures
    // (swipes, double-tap flip, pinch) can't fire mid-game. Snapchat's own
    // chrome buttons render above the lens and stay usable. Plain taps are
    // allowed through: Snapchat's native tap collapses its UI into the
    // clean capture screen, and the tap still reaches the lens for gameplay.
    global.touchSystem.touchBlocking = true;
    global.touchSystem.enableTouchBlockingException("TouchTypeTap", true);
    this.createEvent("OnStartEvent").bind(() => {
      this.styleAllButtons();
      this.setupArchedTitle();
      this.setupScoreOverlay();
      if (this.roundManager) {
        this.roundManager.setOnRoundEnd(() => this.showScore());
      }
      this.showLanding();
    });
    this.createEvent("TouchStartEvent").bind((e) =>
      this.onTouch(e.getTouchPosition())
    );
    this.createEvent("UpdateEvent").bind(() => {
      this.animateScoreReveal();
      this.animateModeTiles();
      this.animateTitle();
    });
  }

  getSelectedMode(): GameMode {
    return this.selectedMode;
  }

  getSelectedDurationSec(): number {
    return this.selectedDurationSec;
  }

  // --- state transitions ---

  showLanding() {
    this.state = "landing";
    this.setRootsVisible(true, false, false);
    this.setUserCameraVisible(true);
    this.titleAnimT = 0; // replay the title intro each time we land
    this.playTitleAudio(); // shimmer runs with the animation cycle
    if (this.tapHints) {
      // The mode hints loop for as long as the landing screen is up, and come
      // back on every return to it.
      this.tapHints.hideStageHint();
      this.tapHints.showLandingHints();
    }
    if (this.roundManager) {
      this.roundManager.hideStage();
    }
  }

  startRound(mode: GameMode) {
    if (this.sndLanding && this.sndLanding.isPlaying()) {
      this.sndLanding.stop(true); // fade the landing shimmer out
    }
    if (this.sndClick) this.sndClick.play(1);
    this.selectedMode = mode;
    this.state = "round";
    this.setRootsVisible(false, true, false);
    // In Live mode the whole background IS the camera feed — the circular
    // face-cam cutout is redundant there. Picture mode keeps it.
    this.setUserCameraVisible(mode !== "live");
    if (this.tapHints) {
      this.tapHints.hideLandingHints();
      this.tapHints.showStageHint(); // "tap to paint", fades itself out
    }
    if (this.roundManager) {
      this.roundManager.beginRound(mode, this.selectedDurationSec);
    }
    print(
      "GameFlow: round started, mode=" +
        mode +
        ", duration=" +
        this.selectedDurationSec +
        "s"
    );
  }

  // Round over: the stage + painted character stay exactly as the player
  // left them. Only the round HUD (joystick, timer, submit, color picker)
  // is swapped out for the score overlay.
  showScore() {
    this.state = "score";
    this.setRootsVisible(false, false, true);
    this.setUserCameraVisible(true);
    if (this.tapHints) this.tapHints.hideAll();

    const s = this.roundManager ? this.roundManager.getLastScore() : null;
    if (!s) return;

    this.scoreTarget = s.aiScore;
    this.scoreAnimT = 0;
    if (this.scoreTitleText) {
      this.scoreTitleText.text = "AI Score: 0";
      this.scoreTitleText.textFill.color = s.hidden
        ? new vec4(0.49, 0.85, 0.34, 1) // hidden — green
        : new vec4(1, 0.43, 0.43, 1); // spotted — red
    }
    // No verdict text (user decision 2026-07-25) — the score itself and
    // its green/red tint carry the hidden/spotted beat.
    if (this.sharePromptText) {
      this.sharePromptText.text =
        "Share with friends - who hides best?\nTap to play again";
    }
    const resultSnd = s.hidden ? this.sndHappy : this.sndSad;
    if (resultSnd) resultSnd.play(1);
  }

  private setRootsVisible(landing: boolean, round: boolean, score: boolean) {
    if (this.landingRoot) this.landingRoot.enabled = landing;
    if (this.roundRoot) this.roundRoot.enabled = round;
    if (this.scoreRoot) this.scoreRoot.enabled = score;
  }

  private setUserCameraVisible(visible: boolean) {
    if (this.userCameraRoot) this.userCameraRoot.enabled = visible;
  }

  // No panel behind the score any more — heavy outlines keep both texts
  // readable over whatever the player painted.
  private setupScoreOverlay() {
    this.outlineText(this.scoreTitleText, 0.45);
    this.outlineText(this.sharePromptText, 0.6);
  }

  private outlineText(txt: Text, size: number) {
    if (!txt) return;
    txt.backgroundSettings.enabled = false;
    txt.outlineSettings.enabled = true;
    txt.outlineSettings.fill.color = new vec4(0, 0, 0, 0.85);
    txt.outlineSettings.size = size;
    txt.dropshadowSettings.enabled = true;
    txt.dropshadowSettings.fill.color = new vec4(0, 0, 0, 0.5);
  }

  // The score counts up and the text pops once — replaces the old bars.
  private animateScoreReveal() {
    if (this.scoreAnimT < 0 || !this.scoreTitleText) return;
    this.scoreAnimT = Math.min(
      this.scoreAnimT + getDeltaTime() / GameFlowManager.SCORE_REVEAL,
      1
    );
    const p = 1 - Math.pow(1 - this.scoreAnimT, 3); // ease-out cubic
    this.scoreTitleText.text =
      "AI Score: " + Math.round(this.scoreTarget * p);
    const st = this.scoreTitleText
      .getSceneObject()
      .getComponent("Component.ScreenTransform") as ScreenTransform;
    if (st) {
      const s = 1 + 0.18 * Math.sin(p * Math.PI);
      st.scale = new vec3(s, s, 1);
    }
    if (this.scoreAnimT >= 1) this.scoreAnimT = -1;
  }

  // --- input ---

  private onTouch(pos: vec2) {
    if (this.state === "landing") {
      this.handleLandingTouch(pos);
    } else if (this.state === "score") {
      // Phase 4 will put a proper Play Again button here.
      this.showLanding();
    }
  }

  private handleLandingTouch(pos: vec2) {
    if (this.hitButton(this.liveIconImage, this.liveButtonText, pos)) {
      this.startRound("live");
    } else if (
      this.hitButton(this.pictureIconImage, this.pictureButtonText, pos)
    ) {
      this.startRound("picture");
    }
  }

  // A mode button = icon tile + label; a tap on either counts.
  private hitButton(icon: Image, label: Text, pos: vec2): boolean {
    if (icon) {
      const st = icon
        .getSceneObject()
        .getComponent("Component.ScreenTransform") as ScreenTransform;
      if (st && st.containsScreenPoint(pos)) return true;
    }
    return this.hitTest(label, pos);
  }

  private hitTest(label: Text, pos: vec2): boolean {
    if (!label) return false;
    const st = label
      .getSceneObject()
      .getComponent("Component.ScreenTransform") as ScreenTransform;
    return st ? st.containsScreenPoint(pos) : false;
  }

  // --- styling ---

  private styleAllButtons() {
    // Icon tiles show the user-authored art as-is; labels are plain text.
    this.styleIcon(this.liveIconImage, this.liveIconTexture);
    this.styleIcon(this.pictureIconImage, this.pictureIconTexture);
    if (this.liveButtonText) this.liveButtonText.backgroundSettings.enabled = false;
    if (this.pictureButtonText) this.pictureButtonText.backgroundSettings.enabled = false;
  }

  private styleIcon(img: Image, tex: Texture) {
    if (!img || !tex) return;
    img.mainMaterial = img.mainMaterial.clone();
    img.mainPass.baseTex = tex;
    img.mainPass.baseColor = new vec4(1, 1, 1, 1);
  }

  // Gentle idle "hover": the mode tiles breathe in counter-phase.
  private animateModeTiles() {
    if (this.state !== "landing") return;
    const t = getTime();
    this.bobTile(this.liveIconImage, t, 0);
    this.bobTile(this.pictureIconImage, t, Math.PI);
  }

  private bobTile(img: Image, t: number, phase: number) {
    if (!img) return;
    // Hierarchy: image -> rounded mask -> tile wrapper (icon + label).
    // Scaling the wrapper moves the label together with the icon.
    const st = img
      .getSceneObject()
      .getParent()
      .getParent()
      .getComponent("Component.ScreenTransform") as ScreenTransform;
    if (!st) return;
    const s = 1 + 0.045 * Math.sin(t * 2.2 + phase);
    st.scale = new vec3(s, s, 1);
  }

  // "Hue & Seek" arched across the top: one Text per character placed on a
  // parabolic arc with a matching tangent tilt, cloned from the flat title.
  private setupArchedTitle() {
    if (!this.titleText) return;
    const src = this.titleText;
    const parentObj = src.getSceneObject().getParent();
    src.getSceneObject().enabled = false;
    const label = "Hue & Seek";
    const n = label.length;
    const arcWidth = 1.5; // total x span in parent anchor units
    const arcHeight = 0.14; // extra lift at the arc's center
    const baseY = 0.36;
    for (let i = 0; i < n; i++) {
      const ch = label.charAt(i);
      if (ch === " ") continue;
      const u = i / (n - 1) - 0.5; // -0.5 .. 0.5 across the word
      const obj = global.scene.createSceneObject("TitleChar" + i);
      obj.setParent(parentObj);
      // Copy the render layer from the source title (the SafeArea parent
      // sits on the default layer, which the UI camera does not render).
      obj.layer = src.getSceneObject().layer;
      const st = obj.createComponent(
        "Component.ScreenTransform"
      ) as ScreenTransform;
      const x = u * arcWidth;
      const y = baseY + arcHeight * (1 - 4 * u * u);
      st.anchors.left = x;
      st.anchors.right = x;
      st.anchors.bottom = y;
      st.anchors.top = y;
      st.rotation = quat.fromEulerAngles(0, 0, -u * 0.85);
      const txt = obj.createComponent("Component.Text") as Text;
      txt.font = src.font;
      txt.size = 60;
      txt.text = ch;
      // Letters start white; the dot "paints" each one its color on landing.
      txt.textFill.color = new vec4(1, 1, 1, 1);
      txt.horizontalOverflow = HorizontalOverflow.Overflow;
      txt.verticalOverflow = VerticalOverflow.Overflow;
      this.titleChars.push({
        st: st,
        x: x,
        y: y,
        txt: txt,
        color:
          GameFlowManager.TITLE_COLORS[
            this.titleChars.length % GameFlowManager.TITLE_COLORS.length
          ],
      });
    }
    this.createTitleDot(parentObj, src.getSceneObject().layer);
  }

  // Small round paint dot that hops across the title letters.
  private createTitleDot(parentObj: SceneObject, layer: LayerSet) {
    const dotObj = global.scene.createSceneObject("TitleDot");
    dotObj.setParent(parentObj);
    dotObj.layer = layer;
    const st = dotObj.createComponent(
      "Component.ScreenTransform"
    ) as ScreenTransform;
    st.offsets.left = -0.3;
    st.offsets.right = 0.3;
    st.offsets.bottom = -0.3;
    st.offsets.top = 0.3;
    const mask = dotObj.createComponent(
      "Component.MaskingComponent"
    ) as MaskingComponent;
    mask.cornerRadius = 0.3; // half of 0.6 units = circle
    const fillObj = global.scene.createSceneObject("TitleDotFill");
    fillObj.setParent(dotObj);
    fillObj.layer = layer;
    const fst = fillObj.createComponent(
      "Component.ScreenTransform"
    ) as ScreenTransform;
    fst.anchors.left = -1;
    fst.anchors.right = 1;
    fst.anchors.bottom = -1;
    fst.anchors.top = 1;
    const img = fillObj.createComponent("Component.Image") as Image;
    // Borrow the flat "Image" material from a landing tile — new Images
    // come up material-less and the score panel that used to supply it is
    // gone with the result screen.
    if (this.liveIconImage) {
      img.mainMaterial = this.liveIconImage.mainMaterial.clone();
      img.mainPass.baseTex = makeSolidWhiteTexture();
      img.mainPass.baseColor = new vec4(1, 0.55, 0.25, 1); // warm paint orange
    }
    this.titleDotST = st;
    dotObj.enabled = false;
  }

  private animateTitle() {
    if (this.titleAnimT < 0 || this.titleChars.length === 0) return;
    if (this.state !== "landing") {
      // Mode selected — stop the loop and settle the letters.
      this.titleAnimT = -1;
      if (this.titleDotST) this.titleDotST.getSceneObject().enabled = false;
      for (const c of this.titleChars) {
        c.st.scale = new vec3(1, 1, 1);
        c.txt.outlineSettings.enabled = false;
      }
      return;
    }
    this.titleAnimT += getDeltaTime();
    const n = this.titleChars.length;
    const travel = GameFlowManager.TITLE_DOT_TRAVEL;
    const pop = GameFlowManager.TITLE_POP;
    if (this.titleAnimT <= travel) {
      // Dot hops from the first letter to the last, bumping each one.
      const fi = (this.titleAnimT / travel) * (n - 1);
      const i0 = Math.min(Math.floor(fi), n - 2);
      const frac = fi - i0;
      const a = this.titleChars[i0];
      const b = this.titleChars[i0 + 1];
      const bounce = Math.abs(Math.sin(fi * Math.PI)); // one hop per letter
      const x = a.x + (b.x - a.x) * frac;
      const y = a.y + (b.y - a.y) * frac + 0.14 + 0.05 * bounce;
      if (this.titleDotST) {
        this.titleDotST.getSceneObject().enabled = true;
        this.titleDotST.anchors.left = x;
        this.titleDotST.anchors.right = x;
        this.titleDotST.anchors.bottom = y;
        this.titleDotST.anchors.top = y;
      }
      for (let i = 0; i < n; i++) {
        const d = Math.abs(fi - i);
        const s = 1 + 0.4 * Math.max(0, 1 - d * 1.5);
        this.titleChars[i].st.scale = new vec3(s, s, 1);
        // The dot paints each letter as it lands on it.
        if (fi >= i - 0.15) {
          this.titleChars[i].txt.textFill.color = this.titleChars[i].color;
        }
      }
    } else if (this.titleAnimT <= travel + pop) {
      // Finale: the whole title swells and sparkles with a golden glow.
      if (this.titleDotST) this.titleDotST.getSceneObject().enabled = false;
      const f = (this.titleAnimT - travel) / pop;
      const s = 1 + 0.25 * Math.sin(f * Math.PI);
      const now = getTime();
      for (let i = 0; i < this.titleChars.length; i++) {
        const c = this.titleChars[i];
        const shimmer = 1 + 0.05 * Math.sin(now * 22 + i * 1.7);
        c.st.scale = new vec3(s * shimmer, s * shimmer, 1);
        c.txt.outlineSettings.enabled = true;
        c.txt.outlineSettings.fill.color = new vec4(1, 1, 0.85, 1);
        c.txt.outlineSettings.size =
          0.4 * Math.sin(f * Math.PI) * (0.7 + 0.3 * Math.sin(now * 25 + i * 2.3));
      }
    } else if (
      this.titleAnimT <=
      travel + pop + GameFlowManager.TITLE_PAUSE
    ) {
      // Brief rest between loops: colored, calm, no glow — audio fades out
      // with the end of the animation.
      if (this.sndLanding && this.sndLanding.isPlaying()) {
        this.sndLanding.stop(true);
      }
      for (const c of this.titleChars) {
        c.st.scale = new vec3(1, 1, 1);
        c.txt.outlineSettings.enabled = false;
      }
    } else {
      // Restart the loop: letters go back to white ink.
      for (const c of this.titleChars) {
        c.txt.textFill.color = new vec4(1, 1, 1, 1);
        c.txt.outlineSettings.enabled = false;
        c.st.scale = new vec3(1, 1, 1);
      }
      this.titleAnimT = 0; // loop until a mode is selected
      this.playTitleAudio(); // next cycle, next shimmer
    }
  }

  // The landing shimmer is tied to the title animation: it starts with the
  // dot's first hop and fades out when the sparkle pop settles.
  private playTitleAudio() {
    if (!this.sndLanding) return;
    this.sndLanding.fadeInTime = 0.15;
    this.sndLanding.fadeOutTime = 0.3;
    this.sndLanding.play(1);
  }
}
