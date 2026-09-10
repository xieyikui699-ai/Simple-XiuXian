// 战斗属性派生：唯一公式 owner（设计文档 §战斗系统·属性派生表，D-010）。玩家与 NPC 共用，无 clamp 例外。
// deriveCombatProfile：纯公式（输入为已聚合的法宝/天赋旋钮与五维）；
// buildCombatProfile：弟子快照适配层（聚合天赋/功法/已穿戴法宝 → 有效五维 clamp(1,100) → 公式），
// 并返回分来源明细（基础/天赋/功法/法宝）供 UI tooltip。
// 本模块纯派生、无掷骰。
import { ATTRIBUTE_KEYS } from "./attributes.js";
import type { DiscipleAttributes } from "./attributes.js";
import type { GearCombatInput } from "./catalog.js";
import { gearCombatInput, getTechniqueById } from "./catalog.js";
import type { Disciple } from "./state.js";
import { talentById, talentsAttributeFlat } from "./talents.js";

// ─── 派生公式常量（设计 §战斗系统·属性派生）─────────────────────────────
// 生命/攻击/法威/防御均为「等级×五维」耦合式：等级是乘区、五维是基数，境界压制为主、先天五维为辅。

/** 最大生命 = 100 + 实力等级×体魄 + (实力等级−1)×50。 */
export const COMBAT_BASE_HP = 100;
export const HP_PHYSIQUE_PER_LEVEL = 1;
export const HP_PER_EXTRA_REALM_LEVEL = 50;
/** 物理攻击 = 30 + 实力等级×(力量/4) + (实力等级−1)×10。 */
export const ATTACK_BASE = 30;
export const ATTACK_STRENGTH_DIVISOR = 4;
export const ATTACK_FLAT_PER_REALM_LEVEL = 10;
/** 法术威力（法威）= 30 + 实力等级×(魂力/4) + (实力等级−1)×10 + 法宝法威。 */
export const MAGIC_BASE = 30;
export const MAGIC_SOUL_POWER_DIVISOR = 4;
export const MAGIC_FLAT_PER_REALM_LEVEL = 10;
/** 防御 = ⌊5 + 实力等级×(体魄/4) + (实力等级−1)×4⌋ + 功法防御平加（成长慢于攻击，保伤害不被稀释）。 */
export const DEFENSE_BASE = 5;
export const DEFENSE_PHYSIQUE_DIVISOR = 4;
export const DEFENSE_FLAT_PER_REALM_LEVEL = 4;
/** 暴击率 = 10 + 悟性/4 + 天赋暴击（上限 50）；暴伤 2×（见 battle.ts 的 CRIT_MULTIPLIER）。 */
export const BASE_CRIT_RATE = 10;
export const CRIT_COMPREHENSION_DIVISOR = 4;
export const MAX_CRIT_RATE = 50;

export type CombatProfileInput = {
  realmLevel: number;
  attributes: DiscipleAttributes;
  /** 法宝法威平加（目录 TREASURES，如混沌钟 +32）。 */
  artifactMagic?: number;
  /** 天赋先攻平加（迅雷之势 +3）。 */
  firstStrikeFlat?: number;
  /** 先攻状态修正（减速 −5，由战斗引擎传入）。 */
  firstStrikeModifier?: number;
  /** 暴击率平加（百分点；天赋锋芒毕露 +8 / 法宝紫雷梭 +8）。 */
  critFlat?: number;
  /** 防御平加（功法厚土诀 +5，在取整之外直接加值）。 */
  defenseFlat?: number;
  /** 法宝防御百分比加成（百分点，乘等级乘区基础派生值，如黄泉幡 +50%）。 */
  defensePct?: number;
  /** 法宝物理攻击平加。 */
  attackFlat?: number;
  /** 法宝物理攻击百分比加成（百分点，乘等级乘区基础派生值，如离火扇 +35%）。 */
  attackPct?: number;
  /** 法宝最大生命平加（山河鼎 +500）。 */
  maxHpFlat?: number;
  /** 天赋吸血聚合（百分点）。 */
  lifestealPct?: number;
  /** 天赋状态抗性聚合（百分点）。 */
  statusResistPct?: number;
};

export type CombatProfile = {
  maxHp: number;
  physicalAttack: number;
  /** 法术威力（法威）。 */
  magicPower: number;
  defense: number;
  /** 先攻 = 身法 + 天赋先攻 + 减速修正。 */
  firstStrike: number;
  /** 暴击率（百分点，[5, 50]）。 */
  critRate: number;
  /** 吸血比例（百分点）：天赋聚合。 */
  lifestealPct: number;
  /** 状态抗性（百分点）：按概率抵消状态附加。 */
  statusResistPct: number;
};

export function deriveCombatProfile(input: CombatProfileInput): CombatProfile {
  const attributes = input.attributes;
  const level = input.realmLevel;
  return {
    maxHp:
      COMBAT_BASE_HP +
      attributes.physique * HP_PHYSIQUE_PER_LEVEL * level +
      (level - 1) * HP_PER_EXTRA_REALM_LEVEL +
      (input.maxHpFlat ?? 0),
    physicalAttack: Math.round(
      (ATTACK_BASE +
        (attributes.strength / ATTACK_STRENGTH_DIVISOR) * level +
        (level - 1) * ATTACK_FLAT_PER_REALM_LEVEL) *
        (1 + (input.attackPct ?? 0) / 100) +
        (input.attackFlat ?? 0),
    ),
    magicPower:
      Math.round(
        MAGIC_BASE +
          (attributes.soulPower / MAGIC_SOUL_POWER_DIVISOR) * level +
          (level - 1) * MAGIC_FLAT_PER_REALM_LEVEL,
      ) + (input.artifactMagic ?? 0),
    defense:
      Math.round(
        Math.floor(
          DEFENSE_BASE +
            (attributes.physique / DEFENSE_PHYSIQUE_DIVISOR) * level +
            (level - 1) * DEFENSE_FLAT_PER_REALM_LEVEL,
        ) *
          (1 + (input.defensePct ?? 0) / 100),
      ) + (input.defenseFlat ?? 0),
    firstStrike:
      attributes.agility + (input.firstStrikeFlat ?? 0) + (input.firstStrikeModifier ?? 0),
    critRate: Math.min(
      MAX_CRIT_RATE,
      BASE_CRIT_RATE +
        Math.round(attributes.comprehension / CRIT_COMPREHENSION_DIVISOR) +
        (input.critFlat ?? 0),
    ),
    lifestealPct: input.lifestealPct ?? 0,
    statusResistPct: Math.min(100, input.statusResistPct ?? 0),
  };
}

export type CombatProfileOptions = {
  /** 减速修正（负值）：战斗中由状态系统传入（减速 −5），属性派生默认 0。 */
  speedModifier?: number;
};

/** 五维分来源明细（UI tooltip 直接消费）。 */
export type CombatAttributeBreakdown = {
  base: DiscipleAttributes;
  talentFlat: DiscipleAttributes;
  artFlat: Partial<DiscipleAttributes>;
  gearFlat: Partial<DiscipleAttributes>;
  /** clamp(1, 100) 后的有效五维；派生公式一律取有效值。 */
  effective: DiscipleAttributes;
};

export type CombatProfileView = CombatProfile & {
  breakdown: {
    attributes: CombatAttributeBreakdown;
    gear: GearCombatInput;
    artDefenseFlat: number;
    talentFirstStrikeFlat: number;
  };
};

function clampAttribute(value: number): number {
  return Math.min(100, Math.max(1, value));
}

/** 弟子快照 → 战斗属性视图：聚合天赋/功法/法宝平加后走唯一公式。 */
export function buildCombatProfile(
  disciple: Disciple,
  options: CombatProfileOptions = {},
): CombatProfileView {
  const talentFlat = talentsAttributeFlat(disciple.talentIds);
  const art = disciple.techniqueId ? getTechniqueById(disciple.techniqueId) : undefined;
  const artFlat: Partial<DiscipleAttributes> = art?.effect.attributeFlat ?? {};
  const artDefenseFlat = art?.effect.defenseFlat ?? 0;
  const gear = gearCombatInput(disciple.equippedGear);

  const base = { ...disciple.attributes };
  const effective = {} as DiscipleAttributes;
  for (const key of ATTRIBUTE_KEYS) {
    effective[key] = clampAttribute(
      base[key] + talentFlat[key] + (artFlat[key] ?? 0) + (gear.attributeFlat[key] ?? 0),
    );
  }

  let talentFirstStrikeFlat = 0;
  let critFlat = 0;
  let lifestealPct = 0;
  let statusResistPct = 0;
  for (const id of disciple.talentIds) {
    const combat = talentById(id)?.effect.combat;
    if (!combat) continue;
    talentFirstStrikeFlat += combat.firstStrikeFlat ?? 0;
    critFlat += combat.critFlat ?? 0;
    lifestealPct += combat.lifestealPct ?? 0;
    statusResistPct += combat.statusResistPct ?? 0;
  }
  critFlat += gear.critFlat;

  const profile = deriveCombatProfile({
    realmLevel: disciple.realmLevel,
    attributes: effective,
    artifactMagic: gear.spellPowerFlat,
    firstStrikeFlat: talentFirstStrikeFlat,
    firstStrikeModifier: options.speedModifier ?? 0,
    critFlat,
    defenseFlat: artDefenseFlat + gear.defenseFlat,
    defensePct: gear.defensePct,
    attackFlat: gear.attackFlat,
    attackPct: gear.attackPct,
    maxHpFlat: gear.maxHpFlat,
    lifestealPct,
    statusResistPct,
  });
  return {
    ...profile,
    breakdown: {
      attributes: { base, talentFlat, artFlat, gearFlat: gear.attributeFlat, effective },
      gear,
      artDefenseFlat,
      talentFirstStrikeFlat,
    },
  };
}
