// PaintController.ts (v5 — texture-layer painting)
// Each rig part gets its own paint canvas: a procedural texture assigned
// to the part's material. Painting raycasts the rig, converts the hit to
// the part's local space, maps it to UV (cylindrical: angle -> u,
// height -> v), and stamps pixels straight into the canvas. Overlapping
// strokes simply overwrite pixels — no stacked dab objects, no z-fighting.
// The eraser stamps the base body color back.
//
// The eyedropper is armed ONLY by the color picker panel's Pick button.

import {
  samplePixelColor,
  makeSolidWhiteTexture,
  whitenIcon,
} from "./PaletteSampler";

const CANVAS = 128; // px per part canvas (128² is plenty for a capsule)
const BASE_R = 235;
const BASE_G = 235;
const BASE_B = 240;
// Measured mesh geometry (Primitive Pack): capsule = radius 25, height
// 100 local units; sphere = radius 50.
const CAPSULE_RADIUS = 25;
const SPHERE_RADIUS = 50;

type PartCanvas = {
  provider: ProceduralTextureProvider;
  data: Uint8Array;
  radiusScale: number; // world->local conversion for this part
  meshRadius: number; // local mesh radius (u axis circumference basis)
};

type Splash = {
  obj: SceneObject;
  vel: vec3;
  life: number;
  age: number;
  baseScale: number;
};

@component
export class PaintController extends BaseScriptComponent {
  @input
  camera: Camera;

  @input
  characterRoot: SceneObject;

  @input
  dabMaterial: Material; // body material base (SimplePBRMaterial), cloned per part

  @input
  dabScale: number = 3.5; // brush size in world units (cm)

  @input
  maxDabs: number = 1500; // stamp-history bound for scoring

  @input
  eyedropExcludeZone: ScreenTransform;

  @input
  currentColorImage: Image; // palette button (opens the picker)

  @input
  cursorImage: Image; // touch cursor icon (brush / picker)

  @input
  brushCursorTexture: Texture;

  @input
  pickerCursorTexture: Texture;

  @input
  indicatorIconTexture: Texture; // palette icon shown on the color button

  @input
  splashMesh: RenderMesh; // tiny sphere for paint-splash droplets

  @input
  splashMaterial: Material; // flat "Image" material, cloned + tinted

  private paintingEnabled: boolean = false;
  private suspended: boolean = false;
  private eyedropArmed: boolean = false;
  private acceptTouchesAfter: number = 0;
  private eraserMode: boolean = false;
  private currentColor: vec4 = new vec4(0.5, 0.5, 0.5, 1);
  private backgroundTexture: Texture | null = null;
  private indicatorReady: boolean = false;
  private brushTex: Texture | null = null;
  private pickerTex: Texture | null = null;
  private cursorST: ScreenTransform | null = null;
  private canvases: { [part: string]: PartCanvas } = {};
  private stamps: { color: vec4; part: string; u: number; v: number }[] = [];
  private lastStampUV: { part: string; u: number; v: number } | null = null;
  private lastTouchPos: vec2 | null = null; // for stroke interpolation
  private splashes: Splash[] = [];
  private splashMats: { [key: string]: Material } = {};

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.setupIndicator();
      this.setupCursor();
      this.setupPartCanvases();
    });
    this.createEvent("TouchStartEvent").bind((e) =>
      this.onTouchStart(e.getTouchPosition())
    );
    this.createEvent("TouchMoveEvent").bind((e) => {
      const pos = e.getTouchPosition();
      // Interpolate between successive move events so fast strokes don't
      // leave gaps ("misses") between raycasts.
      if (this.lastTouchPos !== null) {
        const dx = pos.x - this.lastTouchPos.x;
        const dy = pos.y - this.lastTouchPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.min(6, Math.floor(dist / 0.012));
        for (let i = 1; i <= steps; i++) {
          const f = i / (steps + 1);
          this.tryPaint(
            new vec2(this.lastTouchPos.x + dx * f, this.lastTouchPos.y + dy * f)
          );
        }
      }
      this.lastTouchPos = pos;
      this.tryPaint(pos);
      this.updateCursor(pos, false);
    });
    this.createEvent("TouchEndEvent").bind(() => {
      this.lastTouchPos = null;
      this.hideCursor();
    });
    this.createEvent("UpdateEvent").bind(() => this.updateSplashes());
  }

  // --- setup ---

  private setupIndicator() {
    if (!this.currentColorImage) return;
    this.currentColorImage.mainMaterial =
      this.currentColorImage.mainMaterial.clone();
    this.currentColorImage.mainPass.baseTex = this.indicatorIconTexture
      ? whitenIcon(this.indicatorIconTexture)
      : makeSolidWhiteTexture();
    // The palette button keeps its own look — never tinted with the color.
    this.currentColorImage.mainPass.baseColor = new vec4(1, 1, 1, 1);
    this.indicatorReady = true;
  }

  private setupCursor() {
    if (!this.cursorImage) return;
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

  // One paint canvas per rig part, assigned via a cloned body material.
  private setupPartCanvases() {
    if (!this.characterRoot || !this.dabMaterial) return;
    for (let i = 0; i < this.characterRoot.getChildrenCount(); i++) {
      const part = this.characterRoot.getChild(i);
      const rmv = part.getComponent(
        "Component.RenderMeshVisual"
      ) as RenderMeshVisual;
      if (!rmv) continue;
      try {
        const tex = ProceduralTextureProvider.createWithFormat(
          CANVAS,
          CANVAS,
          TextureFormat.RGBA8Unorm
        );
        const provider = tex.control as ProceduralTextureProvider;
        const data = new Uint8Array(CANVAS * CANVAS * 4);
        this.fillBase(data);
        provider.setPixels(0, 0, CANVAS, CANVAS, data);

        const mat = this.dabMaterial.clone();
        mat.mainPass.baseTex = tex;
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1);
        rmv.clearMaterials();
        rmv.addMaterial(mat);

        const ws = part.getTransform().getWorldScale();
        this.canvases[part.name] = {
          provider: provider,
          data: data,
          // world units -> part-local units
          radiusScale: 1 / Math.max(ws.x, 0.0001),
          meshRadius: part.name === "Head" ? SPHERE_RADIUS : CAPSULE_RADIUS,
        };
      } catch (e) {
        print("Paint: canvas setup failed for " + part.name + " - " + e);
      }
    }
  }

  private fillBase(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = BASE_R;
      data[i + 1] = BASE_G;
      data[i + 2] = BASE_B;
      data[i + 3] = 255;
    }
  }

  // --- public API (used by picker / round manager) ---

  setActive(active: boolean) {
    this.paintingEnabled = active;
    if (active) {
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

  armEyedropOnce() {
    this.eyedropArmed = true;
  }

  setBackgroundTexture(tex: Texture) {
    this.backgroundTexture = tex;
  }

  setCurrentColor(color: vec4) {
    this.currentColor = color;
    this.eraserMode = false; // choosing a color always returns to painting
  }

  setEraserMode(on: boolean) {
    this.eraserMode = on;
    if (this.indicatorReady && this.currentColorImage) {
      // Dim the palette button while erasing; full opacity otherwise.
      this.currentColorImage.mainPass.baseColor = on
        ? new vec4(1, 1, 1, 0.35)
        : new vec4(1, 1, 1, 1);
    }
  }

  isEraserMode(): boolean {
    return this.eraserMode;
  }

  // --- painting ---

  private onTouchStart(screenPos: vec2) {
    if (this.eyedropArmed && this.paintingEnabled && !this.suspended) {
      this.eyedropArmed = false;
      this.updateCursor(screenPos, true);
      this.eyedrop(screenPos);
      return;
    }
    this.lastStampUV = null; // new stroke
    this.tryPaint(screenPos);
    this.updateCursor(screenPos, false);
  }

  private tryPaint(screenPos: vec2) {
    if (!this.paintingEnabled || this.suspended) return;
    if (getTime() < this.acceptTouchesAfter) return;
    if (!this.camera || !this.characterRoot) return;
    const near = this.camera.screenSpaceToWorldSpace(screenPos, 1);
    const far = this.camera.screenSpaceToWorldSpace(screenPos, 1000);
    Physics.createGlobalProbe().rayCast(near, far, (hit) => {
      if (hit === null) return;
      const obj = hit.collider.getSceneObject();
      if (!this.isRigPart(obj)) return;
      this.stampAt(hit, obj);
    });
  }

  private isRigPart(obj: SceneObject): boolean {
    let cur: SceneObject | null = obj;
    while (cur !== null) {
      if (cur.isSame(this.characterRoot)) return true;
      cur = cur.hasParent() ? cur.getParent() : null;
    }
    return false;
  }

  private stampAt(hit: RayCastHit, partObj: SceneObject) {
    const canvas = this.canvases[partObj.name];
    if (!canvas) return;
    try {
      // Hit position -> part-local space -> cylindrical UV.
      const inv = partObj.getTransform().getInvertedWorldTransform();
      const lp = inv.multiplyPoint(hit.position);
      let u = Math.atan2(lp.z, lp.x) / (2 * Math.PI) + 0.5;
      let v = (lp.y + 50) / 100;
      u = u - Math.floor(u);
      v = Math.max(0, Math.min(1, v));

      // Spacing throttle within a stroke (UV space).
      if (
        this.lastStampUV !== null &&
        this.lastStampUV.part === partObj.name
      ) {
        const du = Math.abs(u - this.lastStampUV.u);
        const dv = Math.abs(v - this.lastStampUV.v);
        if (Math.min(du, 1 - du) < 0.02 && dv < 0.02) return;
      }
      this.lastStampUV = { part: partObj.name, u: u, v: v };

      // Brush radius in pixels (anisotropic: u axis spans the part's
      // circumference 2π·meshRadius local units, v axis spans 100).
      const localR = this.dabScale * canvas.radiusScale;
      const eraser = this.eraserMode;
      const scaleUp = eraser ? 1.5 : 1;
      const ru = Math.max(
        2,
        Math.min(
          Math.round(
            ((localR * scaleUp) / (2 * Math.PI * canvas.meshRadius)) * CANVAS
          ),
          Math.floor(CANVAS / 3)
        )
      );
      const rv = Math.max(
        2,
        Math.min(
          Math.round(((localR * scaleUp) / 100) * CANVAS),
          Math.floor(CANVAS / 3)
        )
      );

      const c = this.currentColor;
      const cr = eraser ? BASE_R : Math.round(c.r * 255);
      const cg = eraser ? BASE_G : Math.round(c.g * 255);
      const cb = eraser ? BASE_B : Math.round(c.b * 255);
      const cx = Math.floor(u * CANVAS);
      const cy = Math.floor(v * CANVAS);

      for (let dy = -rv; dy <= rv; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= CANVAS) continue;
        for (let dx = -ru; dx <= ru; dx++) {
          const fx = dx / ru;
          const fy = dy / rv;
          if (fx * fx + fy * fy > 1) continue;
          const x = (((cx + dx) % CANVAS) + CANVAS) % CANVAS; // u wraps
          const i = (y * CANVAS + x) * 4;
          canvas.data[i] = cr;
          canvas.data[i + 1] = cg;
          canvas.data[i + 2] = cb;
          canvas.data[i + 3] = 255;
        }
      }
      canvas.provider.setPixels(0, 0, CANVAS, CANVAS, canvas.data);

      // Stamp history for scoring.
      if (eraser) {
        for (let i = this.stamps.length - 1; i >= 0; i--) {
          const s = this.stamps[i];
          if (s.part !== partObj.name) continue;
          const du = Math.abs(s.u - u);
          if (Math.min(du, 1 - du) < 0.06 && Math.abs(s.v - v) < 0.06) {
            this.stamps.splice(i, 1);
          }
        }
      } else if (this.stamps.length < this.maxDabs) {
        this.stamps.push({ color: c, part: partObj.name, u: u, v: v });
      }

      if (!eraser) {
        this.spawnSplash(hit, this.currentColor);
      }
    } catch (e) {
      print("Paint: stamp failed - " + e);
    }
  }

  // --- paint splash droplets ---

  private spawnSplash(hit: RayCastHit, color: vec4) {
    if (!this.splashMesh || !this.splashMaterial) return;
    if (this.splashes.length > 20) return; // particle budget
    try {
      const n = hit.normal;
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const obj = global.scene.createSceneObject("Splash");
        obj.layer = this.characterRoot.layer;
        const rmv = obj.createComponent(
          "Component.RenderMeshVisual"
        ) as RenderMeshVisual;
        rmv.mesh = this.splashMesh;
        rmv.clearMaterials();
        rmv.addMaterial(this.splashMaterialFor(color));
        const t = obj.getTransform();
        t.setWorldPosition(hit.position.add(n.uniformScale(0.6)));
        const s = (0.6 + Math.random() * 0.8) / 100; // ~1 unit droplets
        t.setWorldScale(new vec3(s, s, s));
        // Fly outward along the surface normal with random spray.
        const vel = new vec3(
          n.x * 18 + (Math.random() - 0.5) * 22,
          n.y * 18 + Math.random() * 14 + 4,
          n.z * 18 + (Math.random() - 0.5) * 22
        );
        this.splashes.push({
          obj: obj,
          vel: vel,
          life: 0.3 + Math.random() * 0.2,
          age: 0,
          baseScale: s,
        });
      }
    } catch (e) {
      print("Paint: splash failed - " + e);
    }
  }

  private splashMaterialFor(color: vec4): Material {
    const key =
      color.r.toFixed(2) + "_" + color.g.toFixed(2) + "_" + color.b.toFixed(2);
    if (!this.splashMats[key]) {
      const mat = this.splashMaterial.clone();
      mat.mainPass.baseTex = makeSolidWhiteTexture();
      mat.mainPass.baseColor = color;
      this.splashMats[key] = mat;
    }
    return this.splashMats[key];
  }

  private updateSplashes() {
    if (this.splashes.length === 0) return;
    const dt = getDeltaTime();
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const sp = this.splashes[i];
      sp.age += dt;
      if (sp.age >= sp.life) {
        sp.obj.destroy();
        this.splashes.splice(i, 1);
        continue;
      }
      sp.vel.y -= 90 * dt; // gravity
      const t = sp.obj.getTransform();
      t.setWorldPosition(t.getWorldPosition().add(sp.vel.uniformScale(dt)));
      const shrink = sp.baseScale * (1 - sp.age / sp.life);
      t.setWorldScale(new vec3(shrink, shrink, shrink));
    }
  }

  private eyedrop(screenPos: vec2) {
    if (!this.backgroundTexture) return;
    if (
      this.eyedropExcludeZone &&
      this.eyedropExcludeZone.containsScreenPoint(screenPos)
    ) {
      return;
    }
    if (this.currentColorImage) {
      const st = this.currentColorImage
        .getSceneObject()
        .getComponent("Component.ScreenTransform") as ScreenTransform;
      if (st && st.containsScreenPoint(screenPos)) return;
    }
    const color = samplePixelColor(
      this.backgroundTexture,
      screenPos.x,
      1 - screenPos.y
    );
    if (color) {
      this.setCurrentColor(color);
    }
  }

  // --- touch cursor ---

  private updateCursor(pos: vec2, pickerMode: boolean) {
    if (!this.cursorImage || !this.cursorST) return;
    if (!this.paintingEnabled || this.suspended) {
      this.hideCursor();
      return;
    }
    const tex = pickerMode ? this.pickerTex : this.brushTex;
    if (!tex) return;
    this.cursorImage.getSceneObject().enabled = true;
    this.cursorImage.mainPass.baseTex = tex;
    this.cursorImage.mainPass.baseColor = pickerMode
      ? new vec4(1, 1, 1, 0.95)
      : this.eraserMode
        ? new vec4(1, 1, 1, 0.45)
        : new vec4(
            this.currentColor.r,
            this.currentColor.g,
            this.currentColor.b,
            0.95
          );
    this.cursorST.anchors.setCenter(
      new vec2(pos.x * 2 - 1, (1 - pos.y) * 2 - 1)
    );
  }

  private hideCursor() {
    if (this.cursorImage) {
      this.cursorImage.getSceneObject().enabled = false;
    }
  }

  // --- scoring API ---

  getColorCounts(): { color: vec4; count: number }[] {
    const map = new Map<string, { color: vec4; count: number }>();
    for (const s of this.stamps) {
      const key =
        s.color.r.toFixed(2) +
        "_" +
        s.color.g.toFixed(2) +
        "_" +
        s.color.b.toFixed(2);
      if (!map.has(key)) {
        map.set(key, { color: s.color, count: 0 });
      }
      map.get(key)!.count += 1;
    }
    return Array.from(map.values());
  }

  getCoverageRatio(): number {
    return Math.min(this.stamps.length / 350, 1);
  }

  getDabCount(): number {
    return this.stamps.length;
  }

  getPartsPainted(): number {
    const parts = new Set<string>();
    for (const s of this.stamps) {
      parts.add(s.part);
    }
    return parts.size;
  }

  reset() {
    this.stamps = [];
    for (const name in this.canvases) {
      const canvas = this.canvases[name];
      this.fillBase(canvas.data);
      canvas.provider.setPixels(0, 0, CANVAS, CANVAS, canvas.data);
    }
  }
}
