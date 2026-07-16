// RoundManager.ts (v2)
// Runs a single round: sets up the stage background (Picture mode picks a
// random bundled texture; Live mode shows the camera feed), enables the
// character + painting + joystick, counts down the selected duration, and
// reports back to GameFlowManager when time is up.

import { PaintController } from "./PaintController";
import { JoystickController } from "./JoystickController";
import { samplePaletteFromTexture, whitenIcon } from "./PaletteSampler";
import { computeScores, ScoreBreakdown } from "./ScoreUtils";

@component
export class RoundManager extends BaseScriptComponent {
  @input
  paintController: PaintController;

  @input
  joystick: JoystickController;

  @input
  timerText: Text;

  @input
  stageBackgroundRoot: SceneObject; // BG camera object (Picture mode only)

  @input
  stageImage: Image; // full-screen image under the BG camera

  @input
  stageTextures: Texture[]; // bundled stage pictures

  @input
  characterRoot: SceneObject;

  @input
  submitZone: ScreenTransform; // check/tick button — ends the round early

  @input
  submitImage: Image;

  @input
  submitIconTexture: Texture;

  @input
  mainCamera: Camera; // used to project the character to screen space

  @input
  cameraTexture: Texture; // Device Camera Texture (Live mode scoring)

  @input
  hiddenThreshold: number = 65; // AI Score at/above this = "not found"

  private running: boolean = false;
  private timeRemaining: number = 0;
  private currentMode: string = "picture";
  private onRoundEnd: (() => void) | null = null;
  private stageMaterialCloned: boolean = false;
  private currentStageTexture: Texture | null = null;
  private lastScore: ScoreBreakdown | null = null;
  private static readonly TOTAL_RIG_PARTS = 6;

  onAwake() {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    this.createEvent("OnStartEvent").bind(() => {
      if (this.submitImage) {
        this.submitImage.mainMaterial = this.submitImage.mainMaterial.clone();
        if (this.submitIconTexture) {
          this.submitImage.mainPass.baseTex = whitenIcon(
            this.submitIconTexture
          );
        }
        this.submitImage.mainPass.baseColor = new vec4(0.25, 0.9, 0.35, 1);
      }
    });
    this.createEvent("TouchStartEvent").bind((e) => {
      const pos = e.getTouchPosition();
      if (
        this.running &&
        this.submitZone &&
        this.submitZone.containsScreenPoint(pos)
      ) {
        this.endRound();
      }
    });
  }

  setOnRoundEnd(cb: () => void) {
    this.onRoundEnd = cb;
  }

  getCurrentMode(): string {
    return this.currentMode;
  }

  beginRound(mode: string, durationSec: number) {
    this.currentMode = mode;
    this.running = true;
    this.timeRemaining = durationSec;

    if (this.characterRoot) {
      this.characterRoot.enabled = true;
      // Start each round centered.
      this.characterRoot.getTransform().setWorldPosition(new vec3(0, -10, -60));
    }
    if (this.paintController) {
      this.paintController.reset();
      this.paintController.setActive(true);
    }
    if (this.joystick) {
      this.joystick.setActive(true);
    }
    this.updateTimerLabel();

    const isPicture = mode === "picture";
    if (this.stageBackgroundRoot) {
      this.stageBackgroundRoot.enabled = isPicture;
    }
    if (isPicture && this.stageImage && this.stageTextures.length > 0) {
      try {
        if (!this.stageMaterialCloned) {
          // Clone so we never mutate the shared material asset.
          this.stageImage.mainMaterial = this.stageImage.mainMaterial.clone();
          this.stageMaterialCloned = true;
        }
        const tex =
          this.stageTextures[
            Math.floor(Math.random() * this.stageTextures.length)
          ];
        this.stageImage.mainPass.baseTex = tex;
        this.currentStageTexture = tex;
      } catch (e) {
        print("RoundManager: stage texture setup failed - " + e);
      }
    }

    // Eyedropper reads from whatever the player is blending into.
    if (this.paintController) {
      this.paintController.setBackgroundTexture(
        isPicture ? this.currentStageTexture : this.cameraTexture
      );
    }
  }

  // Hide stage + character (used when returning to the landing screen).
  hideStage() {
    if (this.stageBackgroundRoot) this.stageBackgroundRoot.enabled = false;
    if (this.characterRoot) this.characterRoot.enabled = false;
    if (this.paintController) this.paintController.reset();
  }

  private onUpdate() {
    if (!this.running) return;
    this.timeRemaining -= getDeltaTime();
    this.updateTimerLabel();
    if (this.timeRemaining <= 0) {
      this.endRound();
    }
  }

  private endRound() {
    this.running = false;
    if (this.paintController) this.paintController.setActive(false);
    if (this.joystick) this.joystick.setActive(false);
    this.lastScore = this.computeRoundScore();
    if (this.onRoundEnd) this.onRoundEnd();
  }

  getLastScore(): ScoreBreakdown | null {
    return this.lastScore;
  }

  private computeRoundScore(): ScoreBreakdown {
    // Which background is the player blending into?
    const tex =
      this.currentMode === "picture"
        ? this.currentStageTexture
        : this.cameraTexture;

    // Sample the background palette around the character's final position.
    let palette: vec4[] = [];
    if (tex && this.mainCamera && this.characterRoot) {
      const screenPos = this.mainCamera.worldSpaceToScreenSpace(
        this.characterRoot.getTransform().getWorldPosition()
      );
      // screen y is top-down; getPixels expects bottom-up rows.
      palette = samplePaletteFromTexture(
        tex,
        screenPos.x,
        1 - screenPos.y,
        48,
        4
      );
    }

    return computeScores(
      this.paintController ? this.paintController.getColorCounts() : [],
      palette,
      this.paintController ? this.paintController.getCoverageRatio() : 0,
      this.paintController ? this.paintController.getPartsPainted() : 0,
      RoundManager.TOTAL_RIG_PARTS,
      this.hiddenThreshold
    );
  }

  private updateTimerLabel() {
    if (!this.timerText) return;
    const s = Math.max(0, Math.ceil(this.timeRemaining));
    this.timerText.text = s + "s";
  }
}
