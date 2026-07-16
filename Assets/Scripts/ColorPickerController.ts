// ColorPickerController.ts (v2 — wheel + RGBA sliders + eyedropper)
// Procreate-style picker panel opened from the current-color button:
//   - circular HSV color wheel (hue = angle, saturation = radius),
//     drawn at runtime into a procedural texture so taps map exactly
//   - R / G / B / A slider keys for fine tuning
//   - eyedropper button: closes the panel and arms a one-shot pick —
//     the next tap samples the real background color at that point
// Painting is suspended while the panel is open.

import { PaintController } from "./PaintController";
import { makeSolidWhiteTexture } from "./PaletteSampler";

const WHEEL_PX = 160;

@component
export class ColorPickerController extends BaseScriptComponent {
  @input
  paintController: PaintController;

  @input
  panelRoot: SceneObject;

  @input
  panelBg: Image;

  @input
  wheelImage: Image;

  @input
  toggleZone: ScreenTransform; // current-color indicator button

  @input
  closeZone: ScreenTransform; // X button

  @input
  eyedropZone: ScreenTransform; // eyedropper button

  @input
  eraserZone: ScreenTransform; // eraser toggle button

  @input
  trackR: ScreenTransform;

  @input
  trackG: ScreenTransform;

  @input
  trackB: ScreenTransform;

  @input
  trackA: ScreenTransform;

  @input
  knobR: ScreenTransform;

  @input
  knobG: ScreenTransform;

  @input
  knobB: ScreenTransform;

  @input
  knobA: ScreenTransform;

  private wheelST: ScreenTransform;
  private solidTex: Texture;
  private open: boolean = false;
  private rgba: number[] = [0.5, 0.5, 0.5, 1];
  private draggingSlider: number = -1; // 0..3 = R,G,B,A

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.setup());
    this.createEvent("TouchStartEvent").bind((e) =>
      this.onTouchStart(e.getTouchPosition())
    );
    this.createEvent("TouchMoveEvent").bind((e) =>
      this.onTouchMove(e.getTouchPosition())
    );
    this.createEvent("TouchEndEvent").bind(() => (this.draggingSlider = -1));
    // If the round ends while the panel is open, close it.
    this.createEvent("UpdateEvent").bind(() => {
      if (
        this.open &&
        this.paintController &&
        !this.paintController.isActive()
      ) {
        this.setOpen(false);
      }
    });
  }

  private setup() {
    this.solidTex = makeSolidWhiteTexture();
    if (this.panelBg) {
      this.panelBg.mainMaterial = this.panelBg.mainMaterial.clone();
      this.panelBg.mainPass.baseTex = this.solidTex;
      this.panelBg.mainPass.baseColor = new vec4(0.07, 0.07, 0.09, 0.95);
    }
    if (this.wheelImage) {
      this.wheelImage.mainMaterial = this.wheelImage.mainMaterial.clone();
      this.wheelImage.mainPass.baseTex = this.buildWheelTexture();
      this.wheelImage.mainPass.baseColor = new vec4(1, 1, 1, 1);
      this.wheelST = this.wheelImage
        .getSceneObject()
        .getComponent("Component.ScreenTransform") as ScreenTransform;
    }
    this.styleSliderVisuals();
    // Tool buttons: eyedropper (blue) and eraser (red).
    this.styleToolButton(this.eyedropZone, new vec4(0.2, 0.45, 0.9, 0.95));
    this.styleToolButton(this.eraserZone, new vec4(0.85, 0.3, 0.3, 0.95));
    if (this.panelRoot) this.panelRoot.enabled = false;
  }

  private styleToolButton(zone: ScreenTransform, bg: vec4) {
    if (!zone) return;
    const txt = zone
      .getSceneObject()
      .getComponent("Component.Text") as Text;
    if (txt) {
      txt.backgroundSettings.enabled = true;
      txt.backgroundSettings.fill.color = bg;
    }
  }

  private styleSliderVisuals() {
    const channelColors = [
      new vec4(0.95, 0.3, 0.3, 1),
      new vec4(0.3, 0.9, 0.35, 1),
      new vec4(0.35, 0.55, 0.95, 1),
      new vec4(0.9, 0.9, 0.9, 1),
    ];
    const tracks = [this.trackR, this.trackG, this.trackB, this.trackA];
    const knobs = [this.knobR, this.knobG, this.knobB, this.knobA];
    for (let i = 0; i < 4; i++) {
      this.tintImageOn(tracks[i], new vec4(0.22, 0.22, 0.26, 1));
      this.tintImageOn(knobs[i], channelColors[i]);
    }
  }

  private tintImageOn(st: ScreenTransform, color: vec4) {
    if (!st) return;
    const img = st.getSceneObject().getComponent("Component.Image") as Image;
    if (img) {
      img.mainMaterial = img.mainMaterial.clone();
      img.mainPass.baseTex = this.solidTex; // flat fill, no default texture
      img.mainPass.baseColor = color;
    }
  }


  // --- input routing ---

  private onTouchStart(pos: vec2) {
    if (this.toggleZone && this.toggleZone.containsScreenPoint(pos)) {
      if (
        this.open ||
        (this.paintController && this.paintController.isActive())
      ) {
        this.setOpen(!this.open);
      }
      return;
    }
    if (!this.open) return;
    if (this.closeZone && this.closeZone.containsScreenPoint(pos)) {
      this.setOpen(false);
      return;
    }
    if (this.eyedropZone && this.eyedropZone.containsScreenPoint(pos)) {
      this.setOpen(false);
      if (this.paintController) this.paintController.armEyedropOnce();
      return;
    }
    if (this.eraserZone && this.eraserZone.containsScreenPoint(pos)) {
      this.setOpen(false);
      if (this.paintController) {
        this.paintController.setEraserMode(
          !this.paintController.isEraserMode()
        );
      }
      return;
    }
    if (this.tryWheelPick(pos)) return;
    this.trySliderPick(pos, true);
  }

  private onTouchMove(pos: vec2) {
    if (!this.open) return;
    if (this.draggingSlider >= 0) {
      this.trySliderPick(pos, false);
    } else {
      this.tryWheelPick(pos);
    }
  }

  private tryWheelPick(pos: vec2): boolean {
    if (!this.wheelST || !this.wheelST.containsScreenPoint(pos)) return false;
    const local = this.wheelST.screenPointToLocalPoint(pos);
    if (!local) return false;
    const rad = Math.sqrt(local.x * local.x + local.y * local.y);
    if (rad > 1) return false;
    let hue = (Math.atan2(local.y, local.x) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    const c = this.hsvToRgb(hue, Math.min(rad, 1), 1);
    this.rgba[0] = c.r;
    this.rgba[1] = c.g;
    this.rgba[2] = c.b;
    this.applyColor();
    return true;
  }

  private trySliderPick(pos: vec2, isStart: boolean) {
    const tracks = [this.trackR, this.trackG, this.trackB, this.trackA];
    if (isStart) {
      this.draggingSlider = -1;
      for (let i = 0; i < 4; i++) {
        if (tracks[i] && tracks[i].containsScreenPoint(pos)) {
          this.draggingSlider = i;
          break;
        }
      }
    }
    if (this.draggingSlider < 0) return;
    const st = tracks[this.draggingSlider];
    const local = st.screenPointToLocalPoint(pos);
    if (!local) return;
    const v = Math.max(0, Math.min(1, (local.x + 1) / 2));
    this.rgba[this.draggingSlider] = v;
    this.applyColor();
  }

  private applyColor() {
    const c = new vec4(this.rgba[0], this.rgba[1], this.rgba[2], this.rgba[3]);
    if (this.paintController) this.paintController.setCurrentColor(c);
    this.updateKnobs();
  }

  private updateKnobs() {
    const knobs = [this.knobR, this.knobG, this.knobB, this.knobA];
    for (let i = 0; i < 4; i++) {
      if (knobs[i]) {
        knobs[i].anchors.setCenter(new vec2(this.rgba[i] * 2 - 1, 0));
      }
    }
  }

  private setOpen(v: boolean) {
    this.open = v;
    this.draggingSlider = -1;
    if (this.panelRoot) this.panelRoot.enabled = v;
    if (this.paintController) {
      this.paintController.setSuspended(v);
      if (v) {
        // Sync sliders to whatever color is currently held.
        const cur = this.paintController.getCurrentColor();
        this.rgba = [cur.r, cur.g, cur.b, cur.a];
        this.updateKnobs();
      }
    }
  }

  // --- wheel drawing ---

  private buildWheelTexture(): Texture {
    const size = WHEEL_PX;
    const tex = ProceduralTextureProvider.createWithFormat(
      size,
      size,
      TextureFormat.RGBA8Unorm
    );
    const provider = tex.control as ProceduralTextureProvider;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;
    const bg = { r: 0.07, g: 0.07, b: 0.09 };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const rad = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (rad > 1) {
          data[i] = Math.round(bg.r * 255);
          data[i + 1] = Math.round(bg.g * 255);
          data[i + 2] = Math.round(bg.b * 255);
          data[i + 3] = 255;
        } else {
          let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (hue < 0) hue += 360;
          const c = this.hsvToRgb(hue, rad, 1);
          data[i] = Math.round(c.r * 255);
          data[i + 1] = Math.round(c.g * 255);
          data[i + 2] = Math.round(c.b * 255);
          data[i + 3] = 255;
        }
      }
    }
    provider.setPixels(0, 0, size, size, data);
    return tex;
  }

  private hsvToRgb(h: number, s: number, v: number): vec4 {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0,
      g = 0,
      b = 0;
    if (hp < 1) {
      r = c; g = x;
    } else if (hp < 2) {
      r = x; g = c;
    } else if (hp < 3) {
      g = c; b = x;
    } else if (hp < 4) {
      g = x; b = c;
    } else if (hp < 5) {
      r = x; b = c;
    } else {
      r = c; b = x;
    }
    const m = v - c;
    return new vec4(r + m, g + m, b + m, 1);
  }
}
