// JoystickController.ts
// Drag-anchored virtual joystick. A touch that starts inside the joystick
// base zone deflects the knob and moves the character in the camera-facing
// X/Y plane. Other touches are ignored (painting/palette handle their own).

import { whitenIcon, makeCircleTexture } from "./PaletteSampler";

@component
export class JoystickController extends BaseScriptComponent {
  @input
  characterRoot: SceneObject;

  @input
  joystickBase: ScreenTransform;

  @input
  joystickKnob: ScreenTransform;

  @input
  baseIconTexture: Texture; // joystick/controller icon for the base

  @input
  moveSpeed: number = 50; // world units/sec at full deflection

  @input
  clampX: number = 40; // legacy fallback clamps (used when no moveAreaST)

  @input
  clampYTop: number = 25;

  @input
  clampYBottom: number = 45;

  @input
  camera: Camera; // main perspective camera, for screen->world at char depth

  @input
  moveAreaST: ScreenTransform; // screen region the character must stay inside

  @input
  bodyHalfX: number = 6; // world-unit body extents kept inside the area

  @input
  bodyHalfUp: number = 10;

  @input
  bodyHalfDown: number = 12;

  @input
  sndMove: AudioComponent; // soft blub loop while the joystick is held

  private roundActive: boolean = false;
  private worldMin: vec2 | null = null;
  private worldMax: vec2 | null = null;
  private dragging: boolean = false;
  private touchId: number = -1;
  private anchorPos: vec2 = vec2.zero(); // where the touch started
  private dir: vec2 = vec2.zero(); // normalized deflection, screen space
  private maxDeflection: number = 0.09; // in normalized screen units

  onAwake() {
    this.createEvent("TouchStartEvent").bind((e) => this.onTouchStart(e));
    this.createEvent("TouchMoveEvent").bind((e) => this.onTouchMove(e));
    this.createEvent("TouchEndEvent").bind((e) => this.onTouchEnd(e));
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    this.createEvent("OnStartEvent").bind(() => this.styleVisuals());
  }

  private styleVisuals() {
    // Base: the controller icon (whitened so it tints), semi-transparent.
    this.styleZone(
      this.joystickBase,
      this.baseIconTexture ? whitenIcon(this.baseIconTexture) : null,
      new vec4(1, 1, 1, 0.8)
    );
    // Knob: a clean soft-edged circle marker.
    this.styleZone(
      this.joystickKnob,
      makeCircleTexture(64),
      new vec4(1, 1, 1, 0.9)
    );
  }

  private styleZone(st: ScreenTransform, tex: Texture | null, color: vec4) {
    if (!st) return;
    const img = st.getSceneObject().getComponent("Component.Image") as Image;
    if (img) {
      img.mainMaterial = img.mainMaterial.clone();
      if (tex) img.mainPass.baseTex = tex;
      img.mainPass.baseColor = color;
    }
  }

  setActive(active: boolean) {
    this.roundActive = active;
    if (active) {
      this.computeMoveArea();
    } else {
      this.dragging = false;
      this.dir = vec2.zero();
      this.resetKnob();
      if (this.sndMove && this.sndMove.isPlaying()) this.sndMove.stop(true);
    }
  }

  // Project the screen region's corners into world space at the character's
  // depth so the movement bounds always match the visible/safe area.
  private computeMoveArea() {
    this.worldMin = null;
    this.worldMax = null;
    if (!this.camera || !this.moveAreaST || !this.characterRoot) return;
    const camPos = this.camera.getTransform().getWorldPosition();
    const charPos = this.characterRoot.getTransform().getWorldPosition();
    const dist = charPos.distance(camPos);
    const minScreen = this.moveAreaST.localPointToScreenPoint(new vec2(-1, -1));
    const maxScreen = this.moveAreaST.localPointToScreenPoint(new vec2(1, 1));
    if (!minScreen || !maxScreen) return;
    const a = this.camera.screenSpaceToWorldSpace(minScreen, dist);
    const b = this.camera.screenSpaceToWorldSpace(maxScreen, dist);
    this.worldMin = new vec2(
      Math.min(a.x, b.x) + this.bodyHalfX,
      Math.min(a.y, b.y) + this.bodyHalfDown
    );
    this.worldMax = new vec2(
      Math.max(a.x, b.x) - this.bodyHalfX,
      Math.max(a.y, b.y) - this.bodyHalfUp
    );
  }

  private onTouchStart(e: TouchStartEvent) {
    if (!this.roundActive || this.dragging) return;
    const pos = e.getTouchPosition();
    if (this.joystickBase && this.joystickBase.containsScreenPoint(pos)) {
      this.dragging = true;
      this.touchId = e.getTouchId();
      this.anchorPos = pos;
      if (this.sndMove && !this.sndMove.isPlaying()) {
        this.sndMove.fadeInTime = 0.1;
        this.sndMove.fadeOutTime = 0.2;
        this.sndMove.play(-1); // loop until the drag ends
      }
    }
  }

  private onTouchMove(e: TouchMoveEvent) {
    if (!this.dragging || e.getTouchId() !== this.touchId) return;
    const pos = e.getTouchPosition();
    let delta = new vec2(pos.x - this.anchorPos.x, pos.y - this.anchorPos.y);
    const len = delta.length;
    if (len > this.maxDeflection) {
      delta = delta.uniformScale(this.maxDeflection / len);
    }
    this.dir = delta.uniformScale(1 / this.maxDeflection);
    this.updateKnob(delta);
  }

  private onTouchEnd(e: TouchEndEvent) {
    if (!this.dragging || e.getTouchId() !== this.touchId) return;
    this.dragging = false;
    this.dir = vec2.zero();
    this.resetKnob();
    if (this.sndMove) this.sndMove.stop(true);
  }

  private onUpdate() {
    if (!this.roundActive || !this.characterRoot) return;
    if (this.dir.length < 0.01) return;
    const dt = getDeltaTime();
    const t = this.characterRoot.getTransform();
    const p = t.getWorldPosition();
    // Screen y grows downward; world y grows upward.
    p.x += this.dir.x * this.moveSpeed * dt;
    p.y += -this.dir.y * this.moveSpeed * dt;
    if (this.worldMin && this.worldMax) {
      // Bounds derived from the screen region at round start.
      p.x = Math.max(this.worldMin.x, Math.min(this.worldMax.x, p.x));
      p.y = Math.max(this.worldMin.y, Math.min(this.worldMax.y, p.y));
    } else {
      p.x = Math.max(-this.clampX, Math.min(this.clampX, p.x));
      p.y = Math.max(-this.clampYBottom, Math.min(this.clampYTop, p.y));
    }
    t.setWorldPosition(p);
  }

  private updateKnob(delta: vec2) {
    if (!this.joystickKnob) return;
    // Knob anchors live in the base's -1..1 space; scale screen delta up.
    const kx = (delta.x / this.maxDeflection) * 0.6;
    const ky = (-delta.y / this.maxDeflection) * 0.6;
    this.joystickKnob.anchors.setCenter(new vec2(kx, ky));
  }

  private resetKnob() {
    if (!this.joystickKnob) return;
    this.joystickKnob.anchors.setCenter(vec2.zero());
  }
}
