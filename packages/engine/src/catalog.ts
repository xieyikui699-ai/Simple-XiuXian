// 内容目录：功法 8 门 / 法术 12 门 / 法宝 10 件 / 丹药 2 种。
// 数值唯一来源：docs/design/2026-09-06-小程序简化版设计.md §功法目录/§法术目录/§装备系统/§丹药系统。
// 本模块只做目录数据与检索/校验辅助：不做生产推进（production.ts）、不做管理命令（engine.ts）。
import {
  ATTRIBUTE_DISPLAY_NAMES,
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type DiscipleAttributes,
} from "./attributes.js";
import type { RootElement } from "./roots.js";
import { TALENTS } from "./talents.js";

// ─── 功法目录（8 门，被动）───────────────────────────────────────────────
// 每弟子限修 1 门；宗门藏经阁拥有即可研读习得，书册研读后消耗（一书仅一人可研，历练奇遇可再得）。

export type TechniqueEffect = {
  /** 月度真元增幅率（加法并入总增幅池，与天赋同口径）。 */
  zhenyuanPct?: number;
  /** 五维平加。 */
  attributeFlat?: Partial<DiscipleAttributes>;
  /** 防御平加（派生公式：⌊体魄×1.5 + 护甲防御⌋ 之外的功法直接加值）。 */
  defenseFlat?: number;
  /** 突破成功率加成（百分点）。 */
  breakthroughFlat?: number;
};

export type Technique = {
  id: string;
  name: string;
  effect: TechniqueEffect;
};

export const MAX_TECHNIQUES_PER_DISCIPLE = 1;

export const TECHNIQUES: readonly Technique[] = [
  {
    id: "tech-hunyuan",
    name: "混元功",
    effect: {
      zhenyuanPct: 0.15,
      attributeFlat: { strength: 2, soulPower: 2, agility: 2, physique: 2, comprehension: 2 },
    },
  },
  {
    id: "tech-zixia",
    name: "紫霞功",
    effect: { zhenyuanPct: 0.1, attributeFlat: { comprehension: 4 } },
  },
  { id: "tech-jinzhong", name: "金钟罩", effect: { attributeFlat: { physique: 8 } } },
  { id: "tech-jifeng", name: "疾风诀", effect: { attributeFlat: { agility: 8 } } },
  {
    id: "tech-fenxin",
    name: "焚心诀",
    effect: { zhenyuanPct: 0.12, attributeFlat: { strength: 3 } },
  },
  {
    id: "tech-xuanbing",
    name: "玄冰诀",
    effect: { zhenyuanPct: 0.1, attributeFlat: { soulPower: 4 } },
  },
  { id: "tech-houtu", name: "厚土诀", effect: { attributeFlat: { physique: 5 }, defenseFlat: 5 } },
  { id: "tech-yangqi", name: "养气诀", effect: { zhenyuanPct: 0.08, breakthroughFlat: 3 } },
] as const;

const TECHNIQUE_BY_ID = new Map(TECHNIQUES.map((technique) => [technique.id, technique]));

export function getTechniqueById(id: string): Technique | undefined {
  return TECHNIQUE_BY_ID.get(id);
}

// ─── 法术目录（12 门，主动战技）─────────────────────────────────────────
// 每弟子限修 2 门，从藏经阁已有法术中选择（突破顿悟可直接领悟未修法术，见 settlement.ts）；
// 与弟子任一灵根元素同系威力 +15%。

export type SpellElement = RootElement | "none";

export type SpellStatusEffect = {
  /** 灼烧：行动后每回合扣最大生命的 hpPctPerTurn，持续 turns 回合。 */
  burn?: { hpPctPerTurn: number; turns: number };
  /** 冰冻：目标无法行动 turns 回合；chancePct 缺省 100（必定冰冻）。 */
  freeze?: { turns: number; chancePct?: number };
  /** 减速：目标先攻 −firstStrike，持续 turns 回合。 */
  slow?: { firstStrikeFlat: number; turns: number };
  /** 护盾：自身护盾 = 最大生命 × shieldHpPct（吸收伤害，直至破除）。 */
  shieldHpPct?: number;
  /** 反伤：受击反弹受到伤害的 reflectPct。 */
  reflectPct?: number;
  /** 吸血：按造成的伤害治疗自身 lifestealPct。 */
  lifestealPct?: number;
  /** 破防：无视目标 ignoreDefensePct 防御。 */
  ignoreDefensePct?: number;
};

export type Spell = {
  id: string;
  name: string;
  element: SpellElement;
  /** 伤害倍率（× 法威）。 */
  multiplier: number;
  /** 冷却回合数。 */
  cooldown: number;
  status: SpellStatusEffect;
};

export const MAX_SPELLS_PER_DISCIPLE = 2;

/** 同灵根元素法术威力加成：+15%。 */
export const SPELL_AFFINITY_PCT = 0.15;
export const SPELL_AFFINITY_MULTIPLIER = 1 + SPELL_AFFINITY_PCT;

export const SPELLS: readonly Spell[] = [
  {
    id: "spell-jinfeng",
    name: "金锋斩",
    element: "metal",
    multiplier: 2.2,
    cooldown: 3,
    status: {},
  },
  {
    id: "spell-qingmu",
    name: "青木缠",
    element: "wood",
    multiplier: 1.8,
    cooldown: 4,
    status: { lifestealPct: 20 },
  },
  {
    id: "spell-hanbing",
    name: "寒冰咒",
    element: "water",
    multiplier: 1.2,
    cooldown: 6,
    status: { freeze: { turns: 1 } },
  },
  {
    id: "spell-yanbao",
    name: "炎爆术",
    element: "fire",
    multiplier: 2.6,
    cooldown: 5,
    status: { burn: { hpPctPerTurn: 6, turns: 3 } },
  },
  {
    id: "spell-liedi",
    name: "裂地击",
    element: "earth",
    multiplier: 2.0,
    cooldown: 4,
    status: { ignoreDefensePct: 30 },
  },
  {
    id: "spell-sanmei",
    name: "三昧真火",
    element: "fire",
    multiplier: 1.5,
    cooldown: 6,
    status: { burn: { hpPctPerTurn: 6, turns: 3 } },
  },
  {
    id: "spell-yehuo",
    name: "业火焚心",
    element: "fire",
    multiplier: 1.0,
    cooldown: 4,
    status: { burn: { hpPctPerTurn: 8, turns: 2 } },
  },
  {
    id: "spell-xuanbingci",
    name: "玄冰刺",
    element: "water",
    multiplier: 1.4,
    cooldown: 5,
    status: { freeze: { turns: 1, chancePct: 30 } },
  },
  {
    id: "spell-ningshuang",
    name: "凝霜术",
    element: "water",
    multiplier: 0.8,
    cooldown: 4,
    status: { slow: { firstStrikeFlat: 5, turns: 3 } },
  },
  {
    id: "spell-xuanguang",
    name: "玄光罩",
    element: "none",
    multiplier: 0,
    cooldown: 6,
    status: { shieldHpPct: 20 },
  },
  {
    id: "spell-linggui",
    name: "灵龟盾",
    element: "none",
    multiplier: 0,
    cooldown: 5,
    status: { shieldHpPct: 12, reflectPct: 10 },
  },
  {
    id: "spell-shehun",
    name: "摄魂大法",
    element: "none",
    multiplier: 1.6,
    cooldown: 6,
    status: { lifestealPct: 30 },
  },
] as const;

const SPELL_BY_ID = new Map(SPELLS.map((spell) => [spell.id, spell]));

export function getSpellById(id: string): Spell | undefined {
  return SPELL_BY_ID.get(id);
}

/** 法术相性：法术五行系与弟子任一灵根元素同系时威力 +15%，无系法术恒为 1。 */
export function spellAffinityMultiplier(
  spell: Pick<Spell, "element">,
  rootElements: readonly RootElement[],
): number {
  if (spell.element === "none") return 1;
  return rootElements.includes(spell.element) ? SPELL_AFFINITY_MULTIPLIER : 1;
}

// ─── 学习资格与上限校验（藏经阁拥有集合 + 每弟子限 1 功法 / 2 法术）───────

/** 功法研读资格：藏经阁拥有该书且弟子功法未满 1 门。 */
export function canLearnTechnique(
  libraryTechniqueIds: readonly string[],
  techniqueId: string,
  learnedCount: number,
): boolean {
  return libraryTechniqueIds.includes(techniqueId) && learnedCount < MAX_TECHNIQUES_PER_DISCIPLE;
}

/** 法术研读资格：藏经阁拥有该书且弟子法术未满 2 门。 */
export function canLearnSpell(
  librarySpellIds: readonly string[],
  spellId: string,
  learnedCount: number,
): boolean {
  return librarySpellIds.includes(spellId) && learnedCount < MAX_SPELLS_PER_DISCIPLE;
}

// ─── 装备系统（法宝目录 × 10，随机炼制/掉落）───────────────────────────
// 法宝是唯一装备（功法/法术之外唯一物件），弟子至多 1 件；来源：器坊炼制 + 历练掉落。
// 目录 10 件各有其名，效果各加各的单项战斗数值（五维/攻击/防御/生命/暴击/法威），
// 品阶仅作掉落池与 NPC 配装的内部数值带，不在 UI 展示（UI 显示法宝名 + 效果描述）。

export const GEAR_SLOT_KEYS = ["talisman"] as const;
export type GearSlot = (typeof GEAR_SLOT_KEYS)[number];

export const GEAR_SLOT_DISPLAY_NAMES: Record<GearSlot, string> = {
  talisman: "法宝",
};

/** 内部品阶数值带（1–4）：只用于历练掉落池与 NPC 按宗门等级配装，不入 UI。 */
export type GearTier = 1 | 2 | 3 | 4;
export const GEAR_TIERS: readonly GearTier[] = [1, 2, 3, 4];

export type TreasureEffect = {
  /** 法术威力（法威）平加。 */
  spellPowerFlat?: number;
  /** 物理攻击平加。 */
  attackFlat?: number;
  /** 物理攻击百分比加成（百分点，乘等级乘区基础派生值后四舍五入，如离火扇 +35%）。 */
  attackPct?: number;
  /** 防御平加（派生取整之外直接加值，与功法防御同口径）。 */
  defenseFlat?: number;
  /** 防御百分比加成（百分点，乘等级乘区基础派生值后四舍五入，如黄泉幡 +50%）。 */
  defensePct?: number;
  /** 最大生命平加。 */
  maxHpFlat?: number;
  /** 暴击率平加（百分点）。 */
  critFlat?: number;
  /** 五维平加（与天赋/功法同并入有效五维，参与 clamp(1,100)）。 */
  attributeFlat?: Partial<DiscipleAttributes>;
};

export type Treasure = {
  id: string;
  name: string;
  /** 内部品阶（1–4，不入 UI 展示）。 */
  tier: GearTier;
  /** 单项效果：十件各加各的（五维/攻击/防御/生命/暴击/法威）。 */
  effect: TreasureEffect;
};

/**
 * 法宝目录 10 件：品阶 1–4 各 3/3/2/2 件，效果两两不同；
 * 器坊炼制十选一随机出炉，历练掉落其中品阶 1–2 六种。
 */
export const TREASURES: readonly Treasure[] = [
  { id: "gear-qingyunzhu", name: "青云珠", tier: 1, effect: { attributeFlat: { soulPower: 5 } } },
  { id: "gear-chiyanling", name: "赤炎铃", tier: 1, effect: { attributeFlat: { strength: 5 } } },
  { id: "gear-xuanshuijing", name: "玄水镜", tier: 1, effect: { attributeFlat: { physique: 5 } } },
  { id: "gear-yufenghuan", name: "御风环", tier: 2, effect: { attributeFlat: { agility: 6 } } },
  { id: "gear-zileisuo", name: "紫雷梭", tier: 2, effect: { critFlat: 8 } },
  { id: "gear-huangquanfan", name: "黄泉幡", tier: 2, effect: { defensePct: 50 } },
  { id: "gear-lihuoshan", name: "离火扇", tier: 3, effect: { attackPct: 35 } },
  { id: "gear-shanheding", name: "山河鼎", tier: 3, effect: { maxHpFlat: 500 } },
  { id: "gear-hundunzhong", name: "混沌钟", tier: 4, effect: { spellPowerFlat: 32 } },
  {
    id: "gear-taixuta",
    name: "太虚塔",
    tier: 4,
    effect: {
      attributeFlat: { strength: 10, soulPower: 10, agility: 10, physique: 10, comprehension: 10 },
    },
  },
] as const;

const TREASURE_BY_ID = new Map(TREASURES.map((treasure) => [treasure.id, treasure]));

export function getTreasureById(id: string): Treasure | undefined {
  return TREASURE_BY_ID.get(id);
}

/** 指定品阶的法宝列表（历练掉落池 / NPC 按宗门等级配装用）。 */
export function treasuresOfTier(tier: GearTier): Treasure[] {
  return TREASURES.filter((treasure) => treasure.tier === tier);
}

/** 品阶代表法宝（该阶目录首位）：仅旧档档位迁移用。 */
export function representativeTreasureOfTier(tier: GearTier): Treasure {
  const found = treasuresOfTier(tier)[0];
  if (!found) throw new Error("treasure_tier_empty");
  return found;
}

/**
 * 法宝效果描述（UI/纪事文案用）：「魂力 +5」/「暴击率 +8%」/「五维各 +3」等。
 * 五维项：单一维度显示维度名，五维等值显示「五维各 +N」。
 */
export function treasureEffectDescription(treasure: Treasure): string {
  const effect = treasure.effect;
  const parts: string[] = [];
  if (effect.attributeFlat) {
    const entries = Object.entries(effect.attributeFlat) as [AttributeKey, number][];
    const first = entries[0]?.[1];
    const sameValue = first !== undefined && entries.every(([, value]) => value === first);
    if (entries.length === ATTRIBUTE_KEYS.length && sameValue) {
      parts.push(`五维各 +${first}`);
    } else {
      parts.push(...entries.map(([key, value]) => `${ATTRIBUTE_DISPLAY_NAMES[key]} +${value}`));
    }
  }
  if (effect.attackFlat !== undefined) parts.push(`攻击 +${effect.attackFlat}`);
  if (effect.attackPct !== undefined) parts.push(`攻击 +${effect.attackPct}%`);
  if (effect.defenseFlat !== undefined) parts.push(`防御 +${effect.defenseFlat}`);
  if (effect.defensePct !== undefined) parts.push(`防御 +${effect.defensePct}%`);
  if (effect.maxHpFlat !== undefined) parts.push(`生命 +${effect.maxHpFlat}`);
  if (effect.critFlat !== undefined) parts.push(`暴击率 +${effect.critFlat}%`);
  if (effect.spellPowerFlat !== undefined) parts.push(`法威 +${effect.spellPowerFlat}`);
  return parts.length > 0 ? parts.join("·") : "无效果";
}

/** 弟子已穿戴装备：槽位 → 法宝 id（每槽至多 1 件）。 */
export type EquippedGear = { [slot in GearSlot]?: string };

/** 装备战力输入接口（供 combat-profile 读取）：法宝各单项效果（平加/百分比）聚合。 */
export type GearCombatInput = {
  spellPowerFlat: number;
  attackFlat: number;
  attackPct: number;
  defenseFlat: number;
  defensePct: number;
  maxHpFlat: number;
  critFlat: number;
  attributeFlat: Partial<DiscipleAttributes>;
};

export function gearCombatInput(equipped: EquippedGear | undefined): GearCombatInput {
  const result: GearCombatInput = {
    spellPowerFlat: 0,
    attackFlat: 0,
    attackPct: 0,
    defenseFlat: 0,
    defensePct: 0,
    maxHpFlat: 0,
    critFlat: 0,
    attributeFlat: {},
  };
  if (!equipped) return result;
  for (const slot of GEAR_SLOT_KEYS) {
    const treasureId = equipped[slot];
    if (treasureId === undefined) continue;
    const treasure = getTreasureById(treasureId);
    if (!treasure) continue;
    const effect = treasure.effect;
    result.spellPowerFlat += effect.spellPowerFlat ?? 0;
    result.attackFlat += effect.attackFlat ?? 0;
    result.attackPct += effect.attackPct ?? 0;
    result.defenseFlat += effect.defenseFlat ?? 0;
    result.defensePct += effect.defensePct ?? 0;
    result.maxHpFlat += effect.maxHpFlat ?? 0;
    result.critFlat += effect.critFlat ?? 0;
    for (const [key, value] of Object.entries(effect.attributeFlat ?? {}) as [
      AttributeKey,
      number,
    ][]) {
      result.attributeFlat[key] = (result.attributeFlat[key] ?? 0) + value;
    }
  }
  return result;
}

// ─── 丹药系统（2 种，丹房）───────────────────────────────────────────────

export type PillEffect = {
  /** 服用后有效最大寿命 +N 年。 */
  lifespanFlat?: number;
  /** 服用者真元增益：×multiplier 持续 months 月；stacks=false 时重复服用倍率不叠加、时长在剩余月数上累加。 */
  zhenyuanBuff?: { multiplier: number; months: number; stacks: false };
};

export type Pill = {
  id: string;
  name: string;
  effect: PillEffect;
};

export const PILLS: readonly Pill[] = [
  {
    id: "pill-yanshou",
    name: "延寿丹",
    effect: { lifespanFlat: 30 },
  },
  {
    id: "pill-juling",
    name: "聚灵丹",
    effect: { zhenyuanBuff: { multiplier: 1.5, months: 12, stacks: false } },
  },
] as const;

const PILL_BY_ID = new Map(PILLS.map((pill) => [pill.id, pill]));

export function getPillById(id: string): Pill | undefined {
  return PILL_BY_ID.get(id);
}

// ─── 生产速率：craftYieldPct 聚合（丹房/器坊共用旋钮）────────────────────

export type CraftJobKind = "pill" | "gear";

export const CRAFT_JOB_DISPLAY_NAMES: Record<CraftJobKind, string> = {
  pill: "丹房",
  gear: "器坊",
};

/** 各车间吃加成的天赋：丹房 ← 丹道天赋，器坊 ← 器道天赋（talents.ts 目录 id）。 */
export const WORKSHOP_CRAFT_TALENT_IDS: Record<CraftJobKind, readonly string[]> = {
  pill: ["t-pill-talent"],
  gear: ["t-forge-talent"],
};

/** 岗位产出聚合：该车间认可的天赋 craftYieldPct 之和（丹道/器道各 +0.2）。 */
export function workshopCraftYieldPct(kind: CraftJobKind, talentIds: readonly string[]): number {
  const affinity = WORKSHOP_CRAFT_TALENT_IDS[kind];
  return talentIds.reduce((sum, id) => {
    if (!affinity.includes(id)) return sum;
    const talent = TALENTS.find((entry) => entry.id === id);
    return sum + (talent?.effect.craftYieldPct ?? 0);
  }, 0);
}
