// 五行灵根：类型（纯度档位）决定月度真元倍率，元素列表决定后续法术相性（同系 +15%，M2 消费）。
import { deterministicRoll, sha256 } from "./hash.js";

export const ROOT_MULTIPLIERS = {
  five: 1,
  four: 1.5,
  three: 2,
  dual: 3,
  single: 5,
} as const;

export type RootType = keyof typeof ROOT_MULTIPLIERS;

export const ROOT_TYPE_DISPLAY_NAMES: Record<RootType, string> = {
  five: "五行杂灵根",
  four: "四灵根",
  three: "三灵根",
  dual: "双灵根",
  single: "天灵根",
};

export type RootElement = "metal" | "wood" | "water" | "fire" | "earth";

export const ROOT_ELEMENTS: readonly RootElement[] = ["metal", "wood", "water", "fire", "earth"];

export const ROOT_ELEMENT_DISPLAY_NAMES: Record<RootElement, string> = {
  metal: "金",
  wood: "木",
  water: "水",
  fire: "火",
  earth: "土",
};

const ELEMENT_COUNT: Record<RootType, number> = {
  five: 5,
  four: 4,
  three: 3,
  dual: 2,
  single: 1,
};

// 生成分布（百分比）：五行杂 40 / 四灵根 30 / 三灵根 18 / 双灵根 10 / 天灵根 2。
const ROOT_TYPE_WEIGHTS: ReadonlyArray<{ type: RootType; cumulativePct: number }> = [
  { type: "five", cumulativePct: 40 },
  { type: "four", cumulativePct: 70 },
  { type: "three", cumulativePct: 88 },
  { type: "dual", cumulativePct: 98 },
  { type: "single", cumulativePct: 100 },
];

export type RootProfile = {
  rootType: RootType;
  rootElements: RootElement[];
};

export function generateRootProfile(gameSeed: string, discipleId: string): RootProfile {
  const roll = deterministicRoll(`${gameSeed}:${discipleId}:root-type`);
  const type = ROOT_TYPE_WEIGHTS.find((entry) => roll < entry.cumulativePct)?.type ?? "five";
  const count = ELEMENT_COUNT[type];

  const elements: RootElement[] = [];
  let cursor = sha256(`${gameSeed}:${discipleId}:root-elements`).readUInt8(0);
  while (elements.length < count) {
    const element = ROOT_ELEMENTS[cursor % ROOT_ELEMENTS.length];
    if (element !== undefined && !elements.includes(element)) elements.push(element);
    cursor += 7;
  }
  return { rootType: type, rootElements: elements };
}
