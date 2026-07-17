// GameFlowManager.ts
// Top-level state machine: Landing -> Round -> Score -> Landing.
// Owns the landing screen (title, Live/Picture mode buttons, 60/120/240s
// timer picker) and decides which UI root is visible.
//
import { RoundManager } from "./RoundManager";

export type GameMode = "live" | "picture";

type FlowState = "landing" | "round" | "score";

const BG_MODE = new vec4(0.2, 0.35, 0.75, 0.9);

@component
export class GameFlowManager extends BaseScriptComponent {
  @input
  landingRoot: SceneObject;

  @input
  roundRoot: SceneObject;

  @input
  scoreRoot: SceneObject;

  @input
  liveButtonText: Text;

  @input
  pictureButtonText: Text;

  @input
  roundManager: RoundManager;

  @input
  scoreTitleText: Text; // big "AI Score: NN"

  @input
  scoreVerdictText: Text; // "NOT FOUND!" / "SPOTTED!"

  @input
  scoreDetailText: Text; // component breakdown

  @input
  sharePromptText: Text; // share nudge + play-again hint

  @input
  userCameraRoot: SceneObject; // circular face-cam UI — hidden during LIVE rounds

  @input
  scoreBackgroundImage: Image; // full-screen Finish art behind the score texts

  @input
  finishHappyTexture: Texture; // NOT FOUND (hidden) result art

  @input
  finishSadTexture: Texture; // SPOTTED result art

  private state: FlowState = "landing";
  private selectedMode: GameMode = "picture";
  // Fixed round length (user decision 2026-07-17: no timer picker).
  private selectedDurationSec: number = 120;

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
      this.setupScoreBackground();
      if (this.roundManager) {
        this.roundManager.setOnRoundEnd(() => this.showScore());
      }
      this.showLanding();
    });
    this.createEvent("TouchStartEvent").bind((e) =>
      this.onTouch(e.getTouchPosition())
    );
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
    if (this.roundManager) {
      this.roundManager.hideStage();
    }
  }

  startRound(mode: GameMode) {
    this.selectedMode = mode;
    this.state = "round";
    this.setRootsVisible(false, true, false);
    // In Live mode the whole background IS the camera feed — the circular
    // face-cam cutout is redundant there. Picture mode keeps it.
    this.setUserCameraVisible(mode !== "live");
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

  showScore() {
    this.state = "score";
    this.setRootsVisible(false, false, true);
    this.setUserCameraVisible(true);

    const s = this.roundManager ? this.roundManager.getLastScore() : null;
    if (s) {
      if (this.scoreBackgroundImage) {
        const art = s.hidden ? this.finishHappyTexture : this.finishSadTexture;
        if (art) this.scoreBackgroundImage.mainPass.baseTex = art;
      }
      if (this.scoreTitleText) {
        this.scoreTitleText.text = "AI Score: " + s.aiScore;
      }
      if (this.scoreVerdictText) {
        this.scoreVerdictText.text = s.hidden ? "NOT FOUND!" : "SPOTTED!";
      }
      if (this.scoreDetailText) {
        this.scoreDetailText.text =
          "Blend " +
          s.blend +
          "   Creativity " +
          s.creativity +
          "   Technique " +
          s.algorithm;
      }
      if (this.sharePromptText) {
        this.sharePromptText.text =
          "Share with friends - who hides best?\nTap to play again";
      }
    }
  }

  private setRootsVisible(landing: boolean, round: boolean, score: boolean) {
    if (this.landingRoot) this.landingRoot.enabled = landing;
    if (this.roundRoot) this.roundRoot.enabled = round;
    if (this.scoreRoot) this.scoreRoot.enabled = score;
  }

  private setUserCameraVisible(visible: boolean) {
    if (this.userCameraRoot) this.userCameraRoot.enabled = visible;
  }

  private setupScoreBackground() {
    if (!this.scoreBackgroundImage) return;
    this.scoreBackgroundImage.mainMaterial =
      this.scoreBackgroundImage.mainMaterial.clone();
    if (this.finishHappyTexture) {
      this.scoreBackgroundImage.mainPass.baseTex = this.finishHappyTexture;
    }
    this.scoreBackgroundImage.mainPass.baseColor = new vec4(1, 1, 1, 1);
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
    if (this.hitTest(this.liveButtonText, pos)) {
      this.startRound("live");
    } else if (this.hitTest(this.pictureButtonText, pos)) {
      this.startRound("picture");
    }
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
    this.styleButton(this.liveButtonText, BG_MODE);
    this.styleButton(this.pictureButtonText, BG_MODE);
  }

  private styleButton(label: Text, bgColor: vec4) {
    if (!label) return;
    label.backgroundSettings.enabled = true;
    label.backgroundSettings.fill.color = bgColor;
  }
}
