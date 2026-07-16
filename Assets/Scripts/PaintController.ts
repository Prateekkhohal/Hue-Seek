// PaintController.ts (v4)
// Touch behaviors during a round:
//   - Touch that hits the character rig (physics raycast) → stamp a dab
//     of the current color; dragging keeps painting.
//   - Eyedropper is armed ONLY by the color picker panel's Pick button:
//     the next tap samples the actual pixel color at that point from the
//     stage picture / camera feed (background taps otherwise do nothing).
// A small HUD indicator shows the currently held color and opens the
// color picker panel when tapped.

import {
  samplePixelColor,
  makeSolidWhiteTexture,
  whitenIcon,
} from "./PaletteSampler";

@component
export class PaintController extends BaseScriptComponent {
  @input
  camera: Camera;

  @input
  characterRoot: SceneObject;

  @input
  dabMesh: RenderMesh; // small sphere from the Primitive Pack

  @input
  dabMaterial: Material; // base material, cloned + tinted per color

  @input
  dabScale: number = 3.5;

  @input
  maxDabs: number = 1500;

  @input
  eyedropExcludeZone: ScreenTransform; // joystick base — taps there never eyedrop

  @input
  currentColorImage: Image; // HUD indicator showing the held color

  @input
  cursorImage: Image; // touch cursor icon (brush / picker)

  @input
  brushCursorTexture: Texture;

  @input
  pickerCursorTexture: Texture;

  private paintingEnabled: boolean = false;
  private suspended: boolean = false; // true while the color picker is open
  private eyedropArmed: boolean = false; // one-shot pick from the panel button
  private acceptTouchesAfter: number = 0;
  private lastDabPos: vec3 | null = null; // spacing throttle, per stroke
  private eraserMode: boolean = false;
  private solidDabTex: Texture | null = null;
  private brushTex: Texture | null = null;
  private pickerTex: Texture | null = null;
  private cursorST: ScreenTransform | null = null;
  private currentColor: vec4 = new vec4(0.5, 0.5, 0.5, 1);
  private backgroundTexture: Texture | null = null;
  private indicatorReady: boolean = false;
  private dabs: { color: vec4; part: string }[] = [];
  private dabObjects: SceneObject[] = [];
  private materialCache: { [key: string]: Material } = {};

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      if (this.currentColorImage) {
        this.currentColorImage.mainMaterial =
          this.currentColorImage.mainMaterial.clone();
        this.currentColorImage.mainPass.baseTex = makeSolidWhiteTexture();
        this.currentColorImage.mainPass.baseColor = this.currentColor;
        this.indicatorReady = true;
      }
      if (this.cursorImage) {
        this.cursorImage.mainMaterial = this.cursorImage.mainMaterial.clone();
        if (this.brushCursorTexture) {
          this.brushTex = whitenIcon(this.brushCursorTexture);
        }
        if (this.pickerCursorTexture) {
          this.pickerTex = whitenIcon(this.pickerCursorTexture);
        }
        this.cursorST = this.cursorImage
          .getSceneObject()
          .getComponent("Component.ScreenTransform") as ScreenTransform;
        this.cursorImage.getSceneObject().enabled = false;
      }
    });
    this.createEvent("TouchStartEvent").bind((e) =>
      this.onTouchStart(e.getTouchPosition())
    );
    this.createEvent("TouchMoveEvent").bind((e) => {
      const pos = e.getTouchPosition();
      this.tryPaint(pos);
      this.updateCursor(pos, false);
    });
    this.createEvent("TouchEndEvent").bind(() => this.hideCursor());
  }

  setActive(active: boolean) {
    this.paintingEnabled = active;
    if (active) {
      // Grace period so the mode-button tap that started the round
      // doesn't immediately eyedrop the background.
      this.acceptTouchesAfter = getTime() + 0.3;
    }
  }

  isActive(): boolean {
    return this.paintingEnabled;
  }

  setSuspended(suspended: boolean) {
    this.suspended = suspended;
  }

  getCurrentColor(): vec4 {
    return this.currentColor;
  }

  // One-shot eyedropper (armed by the color picker's eyedrop button):
  // the very next tap samples the background even if it hits the rig.
  armEyedropOnce() {
    this.eyedropArmed = true;
  }

  // Which texture the eyedropper reads: the current stage picture in
  // Picture mode, the Device Camera Texture in Live mode.
  setBackgroundTexture(tex: Texture) {
    this.backgroundTexture = tex;
  }

  setCurrentColor(color: vec4) {
    this.currentColor = color;
    this.eraserMode = false; // choosing a color always returns to painting
    if (this.indicatorReady && this.currentColorImage) {
      this.currentColorImage.mainPass.baseColor = color;
    }
  }

  setEraserMode(on: boolean) {
    this.eraserMode = on;
    if (this.indicatorReady && this.currentColorImage) {
      // Ghost-white indicator signals "erasing"; color restores on pick.
      this.currentColorImage.mainPass.baseColor = on
        ? new vec4(1, 1, 1, 0.35)
        : this.currentColor;
    }
  }

  isEraserMode(): boolean {
    return this.eraserMode;
  }

  private onTouchStart(screenPos: vec2) {
    if (this.eyedropArmed && this.paintingEnabled && !this.suspended) {
      this.eyedropArmed = false;
      this.eyedrop(screenPos);
      return;
    }
    this.lastDabPos = null; // new stroke
    this.tryPaint(screenPos);
  }

  private tryPaint(screenPos: vec2) {
    if (!this.paintingEnabled || this.suspended) return;
    if (getTime() < this.acceptTouchesAfter) return;
    if (!this.camera || !this.characterRoot) return;
    if (!this.eraserMode && this.dabs.length >= this.maxDabs) return;
    const near = this.camera.screenSpaceToWorldSpace(screenPos, 1);
    const far = this.camera.screenSpaceToWorldSpace(screenPos, 1000);
    Physics.createGlobalProbe().rayCast(near, far, (hit) => {
      if (hit === null) return;
      const obj = hit.collider.getSceneObject();
      if (!this.isRigPart(obj)) return;
      if (this.eraserMode) {
        this.eraseAt(hit.position);
      } else if (this.dabs.length < this.maxDabs) {
        this.spawnDab(hit, obj);
      }
    });
  }

  private eyedrop(screenPos: vec2) {
    if (!this.backgroundTexture) return;
    if (
      this.eyedropExcludeZone &&
      this.eyedropExcludeZone.containsScreenPoint(screenPos)
    ) {
      return;
    }
    // The current-color indicator doubles as the picker toggle button.
    if (this.currentColorImage) {
      const st = this.currentColorImage
        .getSceneObject()
        .getComponent("Component.ScreenTransform") as ScreenTransform;
      if (st && st.containsScreenPoint(screenPos)) return;
    }
    // screen y is top-down; getPixels rows are bottom-up.
    const color = samplePixelColor(
      this.backgroundTexture,
      screenPos.x,
      1 - screenPos.y
    );
    if (color) {
      this.setCurrentColor(color);
    }
  }

  private isRigPart(obj: SceneObject): boolean {
    let cur: SceneObject | null = obj;
    while (cur !== null) {
      if (cur.isSame(this.characterRoot)) return true;
      cur = cur.hasParent() ? cur.getParent() : null;
    }
    return false;
  }

  private spawnDab(hit: RayCastHit, partObj: SceneObject) {
    try {
      // Spacing throttle: dragging fires every frame, which stacked dozens
      // of dabs on the same spot and burned the dab budget in seconds.
      // Skip stamps closer than half a dab to the previous one this stroke.
      if (
        this.lastDabPos !== null &&
        hit.position.distance(this.lastDabPos) < this.dabScale * 0.5
      ) {
        return;
      }
      this.lastDabPos = hit.position;

      // Repainting: lift each new dab a little further off the surface
      // than the dabs already at this spot, so new color covers old
      // instead of z-fighting inside it.
      let nearby = 0;
      for (const existing of this.dabObjects) {
        if (
          existing.getTransform().getWorldPosition().distance(hit.position) <=
          this.dabScale
        ) {
          nearby++;
        }
      }
      const lift = 0.35 + Math.min(nearby, 6) * 0.3;

      const color = this.currentColor;
      const dab = global.scene.createSceneObject("Dab");
      dab.setParent(partObj);
      dab.layer = partObj.layer; // runtime-created objects default elsewhere
      const rmv = dab.createComponent(
        "Component.RenderMeshVisual"
      ) as RenderMeshVisual;
      rmv.mesh = this.dabMesh;
      rmv.clearMaterials();
      rmv.addMaterial(this.materialFor(color));
      const t = dab.getTransform();
      t.setWorldPosition(hit.position.add(hit.normal.uniformScale(lift)));
      // Flatten the sphere into a paint-like disc hugging the surface:
      // orient local Z along the surface normal, thin on that axis.
      // (Primitive Pack meshes are 100 units across at scale 1.)
      const up = Math.abs(hit.normal.y) > 0.95 ? vec3.forward() : vec3.up();
      t.setWorldRotation(quat.lookAt(hit.normal, up));
      const s = this.dabScale / 100;
      t.setWorldScale(new vec3(s, s, s * 0.35));

      this.dabs.push({ color: color, part: partObj.name });
      this.dabObjects.push(dab);
    } catch (e) {
      print("Paint: spawnDab failed - " + e);
    }
  }

  private eraseAt(pos: vec3) {
    const radius = this.dabScale * 1.1;
    for (let i = this.dabObjects.length - 1; i >= 0; i--) {
      const obj = this.dabObjects[i];
      if (obj.getTransform().getWorldPosition().distance(pos) <= radius) {
        obj.destroy();
        this.dabObjects.splice(i, 1);
        this.dabs.splice(i, 1);
      }
    }
  }

  private materialFor(color: vec4): Material {
    const key =
      color.r.toFixed(2) + "_" + color.g.toFixed(2) + "_" + color.b.toFixed(2);
    if (!this.materialCache[key]) {
      if (!this.solidDabTex) {
        this.solidDabTex = makeSolidWhiteTexture();
      }
      const mat = this.dabMaterial.clone();
      // Flat unlit paint: solid texture + tint, no lighting/specular.
      mat.mainPass.baseTex = this.solidDabTex;
      mat.mainPass.baseColor = color;
      this.materialCache[key] = mat;
    }
    return this.materialCache[key];
  }

  // --- used by RoundManager / ScoreUtils at scoring time ---

  getColorCounts(): { color: vec4; count: number }[] {
    const map = new Map<string, { color: vec4; count: number }>();
    for (const dab of this.dabs) {
      const key =
        dab.color.r.toFixed(2) +
        "_" +
        dab.color.g.toFixed(2) +
        "_" +
        dab.color.b.toFixed(2);
      if (!map.has(key)) {
        map.set(key, { color: dab.color, count: 0 });
      }
      map.get(key)!.count += 1;
    }
    return Array.from(map.values());
  }

  getCoverageRatio(): number {
    // Rough proxy until real surface-area coverage lands. With spacing
    // throttling, ~350 dabs is a fully painted rig.
    return Math.min(this.dabs.length / 350, 1);
  }

  getDabCount(): number {
    return this.dabs.length;
  }

  // Number of distinct body parts that received at least one dab.
  getPartsPainted(): number {
    const parts = new Set<string>();
    for (const dab of this.dabs) {
      parts.add(dab.part);
    }
    return parts.size;
  }

  reset() {
    for (const obj of this.dabObjects) {
      obj.destroy();
    }
    this.dabObjects = [];
    this.dabs = [];
  }
}
