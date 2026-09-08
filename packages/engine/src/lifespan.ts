// 寿命生成：移植自主仓 generation.ts（70–108 岁基线，同 seed 同人恒定）。
// 简化版直接存 maxLifespan（坐化年龄基准）；大境界突破的寿元奖励在突破时直接累加进 maxLifespan，
// 故有效坐化年龄 = maxLifespan + 天赋寿命平加。
import { sha256 } from "./hash.js";

export const NEW_DISCIPLE_AGE = 16;

export function generateDiscipleMaxLifespan(gameSeed: string, discipleId: string): number {
  if (gameSeed.trim().length === 0 || discipleId.trim().length === 0) {
    throw new Error("disciple_lifespan_context_invalid");
  }
  const digest = sha256(`${gameSeed}:${discipleId}:lifespan`);
  return 70 + (digest.readUInt8(0) % 39);
}

export type DiscipleLifespanSource = {
  age: number;
  maxLifespan: number;
  realmLevel: number;
};

/** 有效坐化年龄：maxLifespan 已含突破寿元（突破时直接累加），此处再叠加天赋寿命平加。 */
export function effectiveDeathAge(disciple: DiscipleLifespanSource, extraLifespanFlat = 0): number {
  return disciple.maxLifespan + extraLifespanFlat;
}
