// SpikeA_PixelSampling.ts
// Phase 1 Spike A: verify ProceduralTextureProvider.createFromTexture +
// getPixels works on (a) a bundled picture texture and (b) the Device
// Camera Texture, and measure cost. Temporary — delete after verdict is
// recorded in CLAUDE.md.

@component
export class SpikeA_PixelSampling extends BaseScriptComponent {
  @input
  pictureTexture: Texture;

  @input
  cameraTexture: Texture;

  private sampled: boolean = false;
  private elapsed: number = 0;

  onAwake() {
    print("SPIKE A: awake, waiting 1.5s for camera feed to start...");
    this.createEvent("UpdateEvent").bind(() => {
      this.elapsed += getDeltaTime();
      if (!this.sampled && this.elapsed > 1.5) {
        this.sampled = true;
        this.sampleTexture("PICTURE", this.pictureTexture);
        this.sampleTexture("CAMERA", this.cameraTexture);
        print("SPIKE A: done");
      }
    });
  }

  private sampleTexture(label: string, tex: Texture) {
    if (!tex) {
      print(label + ": no texture wired in");
      return;
    }
    try {
      const w = tex.getWidth();
      const h = tex.getHeight();
      const region = 32;
      const x = Math.max(0, Math.floor(w / 2 - region / 2));
      const y = Math.max(0, Math.floor(h / 2 - region / 2));

      const t0 = Date.now();
      const procTex = ProceduralTextureProvider.createFromTexture(tex);
      const provider = procTex.control as ProceduralTextureProvider;
      const data = new Uint8Array(region * region * 4);
      provider.getPixels(x, y, region, region, data);
      const t1 = Date.now();

      // Quantize to 4 levels per channel, count buckets, report top 3.
      const buckets = new Map<string, number>();
      let rSum = 0,
        gSum = 0,
        bSum = 0;
      const pixelCount = region * region;
      for (let i = 0; i < pixelCount; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        rSum += r;
        gSum += g;
        bSum += b;
        const key =
          (r >> 6).toString() + (g >> 6).toString() + (b >> 6).toString();
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      const top = Array.from(buckets.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((e) => e[0] + "x" + e[1])
        .join(", ");
      const avg =
        Math.round(rSum / pixelCount) +
        "," +
        Math.round(gSum / pixelCount) +
        "," +
        Math.round(bSum / pixelCount);

      print(
        label +
          ": OK " +
          w +
          "x" +
          h +
          " region@" +
          x +
          "," +
          y +
          " getPixels took " +
          (t1 - t0) +
          "ms, avgRGB=(" +
          avg +
          "), topBuckets=[" +
          top +
          "]"
      );
    } catch (e) {
      print(label + ": FAILED - " + e);
    }
  }
}
