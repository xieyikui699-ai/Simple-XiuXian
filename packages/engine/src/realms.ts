// 境界体系：10 段（练气/筑基/金丹 前·中·后 + 元婴前期）。
// 真元需求按万进位节奏（1k/3k/5k → 1w/3w/5w → 10w/30w/50w）；元婴前期即顶点，
// requiredZhenyuan = Infinity、成功率 0 表示无下一段（月结另有 TOP_REALM_LEVEL 守卫，不会触达）。

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
    requiredZhenyuan: 1_000,
    baseSuccessRate: 50,
    level: 1,
  },
  {
    realm: "qi_refining_middle",
    name: "练气中期",
    requiredZhenyuan: 3_000,
    baseSuccessRate: 40,
    level: 2,
  },
  {
    realm: "qi_refining_late",
    name: "练气后期",
    requiredZhenyuan: 5_000,
    baseSuccessRate: 30,
    level: 3,
  },
  {
    realm: "foundation_early",
    name: "筑基前期",
    requiredZhenyuan: 10_000,
    baseSuccessRate: 40,
    level: 4,
  },
  {
    realm: "foundation_middle",
    name: "筑基中期",
    requiredZhenyuan: 30_000,
    baseSuccessRate: 30,
    level: 5,
  },
  {
    realm: "foundation_late",
    name: "筑基后期",
    requiredZhenyuan: 50_000,
    baseSuccessRate: 20,
    level: 6,
  },
  {
    realm: "golden_core_early",
    name: "金丹前期",
    requiredZhenyuan: 100_000,
    baseSuccessRate: 25,
    level: 7,
  },
  {
    realm: "golden_core_middle",
    name: "金丹中期",
    requiredZhenyuan: 300_000,
    baseSuccessRate: 20,
    level: 8,
  },
  {
    realm: "golden_core_late",
    name: "金丹后期",
    requiredZhenyuan: 500_000,
    baseSuccessRate: 10,
    level: 9,
  },
  {
    realm: "nascent_soul_early",
    name: "元婴前期",
    requiredZhenyuan: Number.POSITIVE_INFINITY,
    baseSuccessRate: 0,
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

// 大境界突破寿元（简化版）：突破成功时直接把年数加进弟子 maxLifespan。
// 练气→筑基 +200、筑基→金丹 +500、金丹→元婴 +1000（累计 +1700）。
export const MAJOR_REALM_LIFESPAN_INCREASES = [
  { realmLevel: 4, increase: 200 },
  { realmLevel: 7, increase: 500 },
  { realmLevel: 10, increase: 1_000 },
] as const;

/** 突破至该境界等级时的寿元年数（非大境界返回 0）。 */
export function lifespanIncreaseForRealmLevel(realmLevel: number): number {
  return (
    MAJOR_REALM_LIFESPAN_INCREASES.find((milestone) => milestone.realmLevel === realmLevel)
      ?.increase ?? 0
  );
}
