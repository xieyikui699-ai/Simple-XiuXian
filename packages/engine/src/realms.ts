// 境界体系：10 段（练气/筑基/金丹 前·中·后 + 元婴前期）。
// 真元需求与基础突破率沿用主仓 REALM_STAGES 前 10 段原值；实力等级重编为 1–10
//（主仓为对齐 24 段存在跳号，简化版无此约束）。

export type RealmStage = {
  realm: string;
  name: string;
  requiredZhenyuan: number;
  baseSuccessRate: number;
  level: number;
};

export const REALM_STAGES: readonly RealmStage[] = [
  {
    realm: "qi_refining_early",
    name: "练气前期",
    requiredZhenyuan: 300,
    baseSuccessRate: 60,
    level: 1,
  },
  {
    realm: "qi_refining_middle",
    name: "练气中期",
    requiredZhenyuan: 800,
    baseSuccessRate: 50,
    level: 2,
  },
  {
    realm: "qi_refining_late",
    name: "练气后期",
    requiredZhenyuan: 1500,
    baseSuccessRate: 30,
    level: 3,
  },
  {
    realm: "foundation_early",
    name: "筑基前期",
    requiredZhenyuan: 3000,
    baseSuccessRate: 50,
    level: 4,
  },
  {
    realm: "foundation_middle",
    name: "筑基中期",
    requiredZhenyuan: 4000,
    baseSuccessRate: 40,
    level: 5,
  },
  {
    realm: "foundation_late",
    name: "筑基后期",
    requiredZhenyuan: 5000,
    baseSuccessRate: 20,
    level: 6,
  },
  {
    realm: "golden_core_early",
    name: "金丹前期",
    requiredZhenyuan: 8000,
    baseSuccessRate: 25,
    level: 7,
  },
  {
    realm: "golden_core_middle",
    name: "金丹中期",
    requiredZhenyuan: 12000,
    baseSuccessRate: 20,
    level: 8,
  },
  {
    realm: "golden_core_late",
    name: "金丹后期",
    requiredZhenyuan: 15000,
    baseSuccessRate: 10,
    level: 9,
  },
  {
    realm: "nascent_soul_early",
    name: "元婴前期",
    requiredZhenyuan: 20000,
    baseSuccessRate: 10,
    level: 10,
  },
] as const;

export const TOP_REALM_LEVEL = 10;

const STAGE_BY_LEVEL = new Map(REALM_STAGES.map((stage) => [stage.level, stage]));

export function realmStageForLevel(level: number): RealmStage {
  const stage = STAGE_BY_LEVEL.get(level);
  if (!stage) throw new RangeError(`realm_level_out_of_range:${level}`);
  return stage;
}

export function nextRealmStage(level: number): RealmStage | undefined {
  return STAGE_BY_LEVEL.get(level + 1);
}

// 境界寿元加成（简化版档位）：筑基 +200、金丹 +500、元婴前期 +1500。
export const REALM_LIFESPAN_BONUSES = [
  { minimumRealmLevel: 1, increase: 0 },
  { minimumRealmLevel: 4, increase: 200 },
  { minimumRealmLevel: 7, increase: 500 },
  { minimumRealmLevel: 10, increase: 1_500 },
] as const;

export function realmLifespanBonusForLevel(realmLevel: number): number {
  return REALM_LIFESPAN_BONUSES.reduce(
    (bonus, milestone) =>
      realmLevel >= milestone.minimumRealmLevel ? bonus + milestone.increase : bonus,
    0,
  );
}
