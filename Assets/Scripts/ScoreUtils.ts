// ScoreUtils.ts (v2)
// Pure scoring math for the combined "AI Score" shown to the player:
//   - Blend score:      how well painted colors match the sampled
//                        background palette (color-distance)
//   - Creativity score: color variety + how evenly colors were used
//   - Algorithm score:  coverage + how many body parts got painted
// No scene dependencies — unit-testable outside Lens Studio.

export type ScoreBreakdown = {
  aiScore: number; // 0-100 combined, shown big in UI
  blend: number;
  creativity: number;
  algorithm: number;
  hidden: boolean; // true = blended well enough to not be "found"
};

export function colorDistance(a: vec4, b: vec4): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Max possible distance in the RGB unit cube.
const MAX_DIST = Math.sqrt(3);

export function computeBlendScore(
  paintedColorCounts: { color: vec4; count: number }[],
  targetPalette: vec4[]
): number {
  if (paintedColorCounts.length === 0 || targetPalette.length === 0) return 0;
  const totalDabs = paintedColorCounts.reduce((sum, c) => sum + c.count, 0);
  if (totalDabs === 0) return 0;

  let weightedDistance = 0;
  for (const entry of paintedColorCounts) {
    let closest = Number.MAX_VALUE;
    for (const target of targetPalette) {
      const d = colorDistance(entry.color, target);
      if (d < closest) closest = d;
    }
    weightedDistance += closest * (entry.count / totalDabs);
  }
  return Math.round((1 - Math.min(weightedDistance / MAX_DIST, 1)) * 100);
}

export function computeCreativityScore(
  paintedColorCounts: { color: vec4; count: number }[]
): number {
  if (paintedColorCounts.length === 0) return 0;
  const totalDabs = paintedColorCounts.reduce((sum, c) => sum + c.count, 0);
  if (totalDabs === 0) return 0;

  // Variety: reward using several distinct colors (caps at 5).
  const variety = Math.min(paintedColorCounts.length / 5, 1);
  // Evenness: punish one color dominating everything.
  let maxCount = 0;
  for (const c of paintedColorCounts) {
    if (c.count > maxCount) maxCount = c.count;
  }
  const evenness = 1 - maxCount / totalDabs;
  return Math.round((variety * 0.7 + evenness * 0.3) * 100);
}

export function computeAlgorithmScore(
  coverageRatio: number,
  partsPainted: number,
  totalParts: number
): number {
  const partRatio = totalParts > 0 ? partsPainted / totalParts : 0;
  return Math.round((coverageRatio * 0.6 + partRatio * 0.4) * 100);
}

export function computeScores(
  paintedColorCounts: { color: vec4; count: number }[],
  targetPalette: vec4[],
  coverageRatio: number,
  partsPainted: number,
  totalParts: number,
  hiddenThreshold: number
): ScoreBreakdown {
  const blend = computeBlendScore(paintedColorCounts, targetPalette);
  const creativity = computeCreativityScore(paintedColorCounts);
  const algorithm = computeAlgorithmScore(
    coverageRatio,
    partsPainted,
    totalParts
  );
  // Blend dominates — this is a camouflage game — with technique and
  // creativity keeping monochrome-smear exploits in check.
  const aiScore = Math.round(
    blend * 0.5 + creativity * 0.2 + algorithm * 0.3
  );
  return {
    aiScore: aiScore,
    blend: blend,
    creativity: creativity,
    algorithm: algorithm,
    hidden: aiScore >= hiddenThreshold,
  };
}
