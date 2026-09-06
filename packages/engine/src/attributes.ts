// 五维生成：移植自主仓 attributes.ts 的截断正态算法（Box-Muller + 拒绝采样），
// 算法与口径保持一致：均值 50、标准差 20、值域 [10, 90]，同 seed 同人恒定。
import { sha256 } from "./hash.js";

export type AttributeKey = "strength" | "soulPower" | "agility" | "physique" | "comprehension";

export type DiscipleAttributes = Record<AttributeKey, number>;

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  "strength",
  "soulPower",
  "agility",
  "physique",
  "comprehension",
];

export const ATTRIBUTE_DISPLAY_NAMES: Record<AttributeKey, string> = {
  strength: "力量",
  soulPower: "魂力",
  agility: "身法",
  physique: "体魄",
  comprehension: "悟性",
};

export const INITIAL_ATTRIBUTE_MIN = 10;
export const INITIAL_ATTRIBUTE_MAX = 90;
export const INITIAL_ATTRIBUTE_MEAN = 50;
export const INITIAL_ATTRIBUTE_STD_DEV = 20;

/** 拒绝采样重试上限；越界率约 4.5%，连续越界概率可忽略，兜底钳制保证值域不变式。 */
const MAX_NORMAL_ATTEMPTS = 8;

function uniformPair(seed: string): { u1: number; u2: number } {
  const digest = sha256(seed);
  const raw1 = digest.readUInt32BE(0);
  const raw2 = digest.readUInt32BE(4);
  // u1 落在 (0,1]，避免 log(0)；u2 落在 [0,1)。
  return { u1: (raw1 + 1) / 2 ** 32, u2: raw2 / 2 ** 32 };
}

export function deterministicNormalInteger(seed: string, mean: number, stdDev: number): number {
  let lastCandidate = mean;
  for (let attempt = 0; attempt < MAX_NORMAL_ATTEMPTS; attempt += 1) {
    const { u1, u2 } = uniformPair(`${seed}:normal:${attempt}`);
    const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const candidate = Math.round(mean + stdDev * standardNormal);
    if (candidate >= INITIAL_ATTRIBUTE_MIN && candidate <= INITIAL_ATTRIBUTE_MAX) {
      return candidate;
    }
    lastCandidate = candidate;
  }
  return Math.min(INITIAL_ATTRIBUTE_MAX, Math.max(INITIAL_ATTRIBUTE_MIN, lastCandidate));
}

export type DiscipleAttributeGenerationContext = {
  gameSeed: string;
  discipleId: string;
};

export function generateDiscipleAttributes(
  context: DiscipleAttributeGenerationContext,
): DiscipleAttributes {
  if (
    context.gameSeed.trim().length === 0 ||
    context.discipleId.trim().length === 0 ||
    context.gameSeed.length > 128 ||
    context.discipleId.length > 128
  ) {
    throw new Error("disciple_attribute_generation_context_invalid");
  }
  const values = ATTRIBUTE_KEYS.map(
    (key) =>
      [
        key,
        deterministicNormalInteger(
          `${context.gameSeed}:${context.discipleId}:initial-attributes:${key}`,
          INITIAL_ATTRIBUTE_MEAN,
          INITIAL_ATTRIBUTE_STD_DEV,
        ),
      ] as const,
  );
  return Object.fromEntries(values) as DiscipleAttributes;
}
