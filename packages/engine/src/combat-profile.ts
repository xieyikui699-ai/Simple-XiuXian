// 战斗属性派生：唯一公式 owner（设计文档 §战斗系统·属性派生表，D-010）。玩家与 NPC 共用，无 clamp 例外。
// deriveCombatProfile：纯公式（输入为已聚合的装备/天赋旋钮与五维）；
// buildCombatProfile：弟子快照适配层（聚合天赋/功法/已穿戴装备 → 有效五维 clamp(1,100) → 公式），
// 并返回分来源明细（基础/天赋/功法/装备）供 UI tooltip。
// 本模块纯派生、无掷骰。
import { ATTRIBUTE_KEYS } from "./attributes.js";
import type { DiscipleAttributes } from "./attributes.js";
import type { GearCombatInput } from "./catalog.js";
import { gearCombatInput, getTechniqueById } from "./catalog.js";
import type { Disciple } from "./state.js";
import { talentById, talentsAttributeFlat } from "./talents.js";

// ─── 派生公式常量（设计 §战斗系统·属性派生）─────────────────────────────

/** 最大生命 = 100 + 体魄×5 + (实力等级−1)×50。 */
export const COMBAT_BASE_HP = 100;
export const HP_PER_PHYSIQUE = 5;
export const HP_PER_EXTRA_REALM_LEVEL = 50;
/** 物理攻击 = 力量×2 + 武器攻击。 */
export const ATTACK_PER_STRENGTH = 2;
/** 法术威力（法威）= 魂力×2 + 法宝法威。 */
export const SPELL_POWER_PER_SOUL_POWER = 2;
/** 防御 = ⌊体魄×1.5 + 护甲防御⌋ + 功法防御平加。 */
export const DEFENSE_PER_PHYSIQUE = 1.5;
/** 暴击率 = 5 + 天赋暴击（上限 50）；暴伤 1.5×（见 battle.ts 的 CRIT_MULTIPLIER）。 */
export const BASE_CRIT_RATE = 5;
export const MAX_CRIT_RATE = 50;

export type CombatProfileInput = {
  realmLevel: number;
  attributes: DiscipleAttributes;
  /** 武器攻击平加（装备档 1–4 → 10/25/45/70）。 */
  weaponAttack?: number;
  /** 护甲防御平加（装备档 1–4 → 10/25/45/70）。 */
  armorDefense?: number;
  /** 法宝法威平加（装备档 1–4 → 8/14/22/32）。 */
  artifactMagic?: number;
  /** 天赋先攻平加（迅雷之势 +3）。 */
  firstStrikeFlat?: number;
  /** 先攻状态修正（减速 −5，由战斗引擎传入）。 */
  firstStrikeModifier?: number;
  /** 天赋暴击平加（锋芒毕露 +8）。 */
  critFlat?: number;
  /** 功法防御平加（厚土诀 +5，在取整之外直接加值）。 */
  defenseFlat?: number;
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
  return {
    maxHp:
      COMBAT_BASE_HP +
      attributes.physique * HP_PER_PHYSIQUE +
      (input.realmLevel - 1) * HP_PER_EXTRA_REALM_LEVEL,
    physicalAttack: attributes.strength * ATTACK_PER_STRENGTH + (input.weaponAttack ?? 0),
    magicPower: attributes.soulPower * SPELL_POWER_PER_SOUL_POWER + (input.artifactMagic ?? 0),
    defense:
      Math.floor(attributes.physique * DEFENSE_PER_PHYSIQUE + (input.armorDefense ?? 0)) +
      (input.defenseFlat ?? 0),
    firstStrike:
      attributes.agility + (input.firstStrikeFlat ?? 0) + (input.firstStrikeModifier ?? 0),
    critRate: Math.min(MAX_CRIT_RATE, BASE_CRIT_RATE + (input.critFlat ?? 0)),
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
  /** 装备五维平加（饰品档位）。 */
  gearFlat: DiscipleAttributes;
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

/** 弟子快照 → 战斗属性视图：聚合天赋/功法/装备平加后走唯一公式。 */
export function buildCombatProfile(
  disciple: Disciple,
  options: CombatProfileOptions = {},
): CombatProfileView {
  const talentFlat = talentsAttributeFlat(disciple.talentIds);
  const art = disciple.techniqueId ? getTechniqueById(disciple.techniqueId) : undefined;
  const artFlat: Partial<DiscipleAttributes> = art?.effect.attributeFlat ?? {};
  const artDefenseFlat = art?.effect.defenseFlat ?? 0;
  const gear = gearCombatInput(disciple.equippedGear);

  const gearFlat: DiscipleAttributes = {
    strength: 0,
    soulPower: 0,
    agility: 0,
    physique: 0,
    comprehension: 0,
  };
  if (gear.attributeFlat !== 0) {
    for (const key of ATTRIBUTE_KEYS) gearFlat[key] = gear.attributeFlat;
  }

  const base = { ...disciple.attributes };
  const effective = {} as DiscipleAttributes;
  for (const key of ATTRIBUTE_KEYS) {
    effective[key] = clampAttribute(
      base[key] + talentFlat[key] + (artFlat[key] ?? 0) + gearFlat[key],
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

  const profile = deriveCombatProfile({
    realmLevel: disciple.realmLevel,
    attributes: effective,
    weaponAttack: gear.attackFlat,
    armorDefense: gear.defenseFlat,
    artifactMagic: gear.spellPowerFlat,
    firstStrikeFlat: talentFirstStrikeFlat,
    firstStrikeModifier: options.speedModifier ?? 0,
    critFlat,
    defenseFlat: artDefenseFlat,
    lifestealPct,
    statusResistPct,
  });
  return {
    ...profile,
    breakdown: {
      attributes: { base, talentFlat, artFlat, gearFlat, effective },
      gear,
      artDefenseFlat,
      talentFirstStrikeFlat,
    },
  };
}
