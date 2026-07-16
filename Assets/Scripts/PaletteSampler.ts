// PaletteSampler.ts
// Pure helpers to extract a dominant color palette from a region of any
// texture (bundled stage picture OR the live Device Camera Texture).
// Uses ProceduralTextureProvider.createFromTexture + getPixels — verified
// in Spike A (~25ms for a small region; call once at scoring time only).

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A tiny solid-white texture — assign as baseTex to render flat color
 *  fills with the "Image" material (whose default texture is not flat). */
export function makeSolidWhiteTexture(): Texture {
  const tex = ProceduralTextureProvider.createWithFormat(
    4,
    4,
    TextureFormat.RGBA8Unorm
  );
  const provider = tex.control as ProceduralTextureProvider;
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < data.length; i++) data[i] = 255;
  provider.setPixels(0, 0, 4, 4, data);
  return tex;
}

/** Copy of an icon texture with RGB forced to white (alpha preserved) so
 *  black icon art can be tinted to ANY color via baseColor (multiplicative
 *  tinting cannot brighten black pixels). */
export function whitenIcon(tex: Texture): Texture {
  try {
    const w = tex.getWidth();
    const h = tex.getHeight();
    const procTex = ProceduralTextureProvider.createFromTexture(tex);
    const provider = procTex.control as ProceduralTextureProvider;
    const data = new Uint8Array(w * h * 4);
    provider.getPixels(0, 0, w, h, data);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
    }
    provider.setPixels(0, 0, w, h, data);
    return procTex;
  } catch (e) {
    print("PaletteSampler: whitenIcon failed - " + e);
    return tex;
  }
}

/** Soft-edged white disc texture (for joystick knob markers etc.). */
export function makeCircleTexture(size: number): Texture {
  const tex = ProceduralTextureProvider.createWithFormat(
    size,
    size,
    TextureFormat.RGBA8Unorm
  );
  const provider = tex.control as ProceduralTextureProvider;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half + 0.5) / half;
      const dy = (y - half + 0.5) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] =
        r <= 0.9 ? 255 : r <= 1 ? Math.round(255 * (1 - (r - 0.9) / 0.1)) : 0;
    }
  }
  provider.setPixels(0, 0, size, size, data);
  return tex;
}

type Bucket = { r: number; g: number; b: number; count: number };

function accumulateRegion(
  provider: ProceduralTextureProvider,
  x: number,
  y: number,
  region: number,
  buckets: Map<string, Bucket>
) {
  const data = new Uint8Array(region * region * 4);
  provider.getPixels(x, y, region, region, data);
  const pixelCount = region * region;
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const key =
      (r >> 6).toString() + (g >> 6).toString() + (b >> 6).toString();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { r: 0, g: 0, b: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
  }
}

function topColors(buckets: Map<string, Bucket>, maxColors: number): vec4[] {
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map(
      (bk) =>
        new vec4(
          bk.r / bk.count / 255,
          bk.g / bk.count / 255,
          bk.b / bk.count / 255,
          1
        )
    );
}

/**
 * Eyedropper: returns the average color of a small region around the
 * normalized point (u, v) of `tex`, or null if sampling fails. The small
 * region (rather than a single pixel) keeps finger taps stable.
 */
export function samplePixelColor(
  tex: Texture,
  u: number,
  v: number
): vec4 | null {
  try {
    const w = tex.getWidth();
    const h = tex.getHeight();
    const region = Math.min(6, w, h);
    const cx = Math.floor(clamp(u, 0, 1) * w);
    const cy = Math.floor(clamp(v, 0, 1) * h);
    const x = clamp(cx - Math.floor(region / 2), 0, w - region);
    const y = clamp(cy - Math.floor(region / 2), 0, h - region);

    const procTex = ProceduralTextureProvider.createFromTexture(tex);
    const provider = procTex.control as ProceduralTextureProvider;
    const data = new Uint8Array(region * region * 4);
    provider.getPixels(x, y, region, region, data);

    let r = 0,
      g = 0,
      b = 0;
    const pixelCount = region * region;
    for (let i = 0; i < pixelCount; i++) {
      r += data[i * 4];
      g += data[i * 4 + 1];
      b += data[i * 4 + 2];
    }
    return new vec4(
      r / pixelCount / 255,
      g / pixelCount / 255,
      b / pixelCount / 255,
      1
    );
  } catch (e) {
    print("PaletteSampler: eyedrop failed - " + e);
    return null;
  }
}

/**
 * Samples a square region of `tex` centered at normalized coords (u, v)
 * (u: 0..1 left→right, v: 0..1 bottom→top) and returns up to `maxColors`
 * dominant colors as vec4s.
 */
export function samplePaletteFromTexture(
  tex: Texture,
  u: number,
  v: number,
  regionPx: number,
  maxColors: number
): vec4[] {
  try {
    const w = tex.getWidth();
    const h = tex.getHeight();
    const region = Math.min(regionPx, w, h);
    const cx = Math.floor(clamp(u, 0, 1) * w);
    const cy = Math.floor(clamp(v, 0, 1) * h);
    const x = clamp(cx - Math.floor(region / 2), 0, w - region);
    const y = clamp(cy - Math.floor(region / 2), 0, h - region);

    const procTex = ProceduralTextureProvider.createFromTexture(tex);
    const provider = procTex.control as ProceduralTextureProvider;
    const buckets = new Map<string, Bucket>();
    accumulateRegion(provider, x, y, region, buckets);
    return topColors(buckets, maxColors);
  } catch (e) {
    print("PaletteSampler: sampling failed - " + e);
    return [];
  }
}
