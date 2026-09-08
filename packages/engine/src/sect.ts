import { realmStageForLevel } from "./realms.js";
// 宗门规则与经济常量（设计文档 §宗门体系 / §灵石经济）。
import type { GameState } from "./state.js";

export const SECT_RANK_RULES = {
  1: { innerLimit: 10, outerLimit: 100 },
  2: { innerLimit: 24, outerLimit: 300 },
  3: { innerLimit: 48, outerLimit: 500 },
} as const;

export type SectRank = keyof typeof SECT_RANK_RULES;

export const OUTER_INCOME_PER_DISCIPLE = 2;
export const INNER_SALARY_PER_DISCIPLE = 10;
export const RECRUIT_COST = 300;
export const RECRUIT_CANDIDATE_COUNT = 3;
export const INITIAL_SPIRIT_STONES = 2000;
export const INITIAL_MORALE = 70;
export const INITIAL_PRESTIGE = 50;
export const INITIAL_INNER_DISCIPLES = 3;
// 外门弟子只是数字、不入个体名册：外门总数恒等于当前宗门等级的外门上限（1/2/3 级 = 100/300/500），
// 开局即满员、升阶即扩容；在岗（丹房/器坊/挖矿/练气）之外的人数一律按供奉计。

export type SectUpgradeRequirement = {
  cost: number;
  /** 需要至少一名弟子达到该实力等级。 */
  minRealmLevel?: number;
  /** 需要金丹及以上弟子人数。 */
  goldenCoreCount?: number;
};

// 升阶条件：1→2 任一弟子筑基 + 灵石 5,000；2→3 金丹弟子 ≥3 + 灵石 30,000。
export const SECT_UPGRADE_REQUIREMENTS: Record<1, SectUpgradeRequirement> &
  Record<2, SectUpgradeRequirement> = {
  1: { cost: 5000, minRealmLevel: 4 },
  2: { cost: 30000, goldenCoreCount: 3 },
};

export function sectLimitsFor(rank: GameState["sectRank"]): {
  innerLimit: number;
  outerLimit: number;
} {
  return SECT_RANK_RULES[rank];
}

export function upgradeRequirementFor(
  rank: GameState["sectRank"],
): SectUpgradeRequirement | undefined {
  if (rank === 1 || rank === 2) return SECT_UPGRADE_REQUIREMENTS[rank];
  return undefined;
}

export function sectUpgradeFailureReason(state: GameState): string | undefined {
  const requirement = upgradeRequirementFor(state.sectRank);
  if (!requirement) return "sect_rank_maxed";
  if (state.spiritStones < requirement.cost) return "insufficient_resource";
  const minRealmLevel = requirement.minRealmLevel;
  if (minRealmLevel !== undefined) {
    const reached = state.disciples.some((disciple) => disciple.realmLevel >= minRealmLevel);
    if (!reached) return "sect_upgrade_realm_not_met";
  }
  const goldenCoreCount = requirement.goldenCoreCount;
  if (goldenCoreCount !== undefined) {
    const count = state.disciples.filter(
      (disciple) => disciple.realmLevel >= realmStageForLevel(7).level,
    ).length;
    if (count < goldenCoreCount) return "sect_upgrade_golden_core_not_met";
  }
  return undefined;
}
