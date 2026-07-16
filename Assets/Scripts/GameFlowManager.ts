// GameFlowManager.ts
// Top-level state machine: Landing -> Round -> Score -> Landing.
// Owns the landing screen (title, Live/Picture mode buttons, 60/120/240s
// timer picker) and decides which UI root is visible.
//
import { RoundManager } from "./RoundManager";

export type GameMode = "live" | "picture";

type FlowState = "landing" | "round" | "score";

const BG_IDLE = new vec4(0.13, 0.13, 0.18, 0.85);
const BG_SELECTED = new vec4(0.95, 0.55, 0.1, 0.95);
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
  timer60Text: Text;

  @input
  timer120Text: Text;

  @input
  timer240Text: Text;

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

  private state: FlowState = "landing";
  private selectedMode: GameMode = "picture";
  private selectedDurationSec: number = 60;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.styleAllButtons();
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
    if (this.roundManager) {
      this.roundManager.hideStage();
    }
  }

  startRound(mode: GameMode) {
    this.selectedMode = mode;
    this.state = "round";
    this.setRootsVisible(false, true, false);
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

    const s = this.roundManager ? this.roundManager.getLastScore() : null;
    if (s) {
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
    if (this.hitTest(this.timer60Text, pos)) {
      this.selectDuration(60);
    } else if (this.hitTest(this.timer120Text, pos)) {
      this.selectDuration(120);
    } else if (this.hitTest(this.timer240Text, pos)) {
      this.selectDuration(240);
    } else if (this.hitTest(this.liveButtonText, pos)) {
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

  private selectDuration(seconds: number) {
    this.selectedDurationSec = seconds;
    this.updateTimerHighlights();
    print("GameFlow: round duration set to " + seconds + "s");
  }

  // --- styling ---

  private styleAllButtons() {
    this.styleButton(this.liveButtonText, BG_MODE);
    this.styleButton(this.pictureButtonText, BG_MODE);
    this.updateTimerHighlights();
  }

  private updateTimerHighlights() {
    this.styleButton(
      this.timer60Text,
      this.selectedDurationSec === 60 ? BG_SELECTED : BG_IDLE
    );
    this.styleButton(
      this.timer120Text,
      this.selectedDurationSec === 120 ? BG_SELECTED : BG_IDLE
    );
    this.styleButton(
      this.timer240Text,
      this.selectedDurationSec === 240 ? BG_SELECTED : BG_IDLE
    );
  }

  private styleButton(label: Text, bgColor: vec4) {
    if (!label) return;
    label.backgroundSettings.enabled = true;
    label.backgroundSettings.fill.color = bgColor;
  }
}
