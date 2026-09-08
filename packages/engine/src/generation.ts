// 弟子生成：名字/性别/五维/灵根/寿命/天赋全部由 seed + discipleId 确定性派生。
// 仅生成内门弟子：外门恒按宗门等级上限满员、不入个体名册。
import { generateDiscipleAttributes } from "./attributes.js";
import { generateDiscipleMaxLifespan } from "./lifespan.js";
import { generateDiscipleProfile } from "./naming.js";
import { realmStageForLevel } from "./realms.js";
import { generateRootProfile } from "./roots.js";
import type { Disciple } from "./state.js";
import { generateTalentIds } from "./talents.js";

export type GenerateDiscipleInput = {
  gameSeed: string;
  discipleId: string;
  /** 取名序号：同局内单调递增，保证避重。 */
  ordinal: number;
  usedNames?: Iterable<string>;
  age?: number;
};

export function generateDisciple(input: GenerateDiscipleInput): Disciple {
  const { name, gender } = generateDiscipleProfile({
    seed: input.gameSeed,
    ordinal: input.ordinal,
    usedNames: input.usedNames,
  });
  const age = input.age ?? 16;
  const maxLifespan = generateDiscipleMaxLifespan(input.gameSeed, input.discipleId);
  const { rootType, rootElements } = generateRootProfile(input.gameSeed, input.discipleId);
  return {
    id: input.discipleId,
    name,
    gender,
    age,
    maxLifespan,
    realm: realmStageForLevel(1).realm,
    realmLevel: 1,
    zhenyuan: 0,
    breakthroughFailures: 0,
    rootType,
    rootElements,
    attributes: generateDiscipleAttributes({
      gameSeed: input.gameSeed,
      discipleId: input.discipleId,
    }),
    talentIds: generateTalentIds(input.gameSeed, input.discipleId),
  };
}
