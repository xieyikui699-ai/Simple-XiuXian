// 寿命生成：移植自主仓 generation.ts（70–108 岁基线，同 seed 同人恒定）。
// 简化版直接存 maxLifespan（坐化年龄基准），不走主仓的剩余寿数镜像；
// 有效坐化年龄 = maxLifespan + 境界寿元加成 + 天赋/丹药寿命平加。
import { sha256 } from "./hash.js";
import { realmLifespanBonusForLevel } from "./realms.js";

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

/** 有效坐化年龄：境界加成与天赋/丹药寿命平加（extraLifespanFlat）只作用于有效上限，不写存储值。 */
export function effectiveDeathAge(disciple: DiscipleLifespanSource, extraLifespanFlat = 0): number {
  return disciple.maxLifespan + realmLifespanBonusForLevel(disciple.realmLevel) + extraLifespanFlat;
}
