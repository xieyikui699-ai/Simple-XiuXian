import type { DiscipleAttributes } from "./attributes.js";
// 天赋目录 30 条，不区分品级；强度只由数值档位区分。
// M1 消费旋钮：zhenyuanPct / breakthroughFlat / attributeFlat / lifespanFlat；
// 其余旋钮为 M2+ 预留（丹房器坊产出、招募候选、战斗旋钮），结算暂不消费。
import { deterministicRoll } from "./hash.js";

export type TalentEffect = {
  /** 月度真元增幅率，加法并入总增幅池。 */
  zhenyuanPct?: number;
  /** 突破成功率加成（百分点）。 */
  breakthroughFlat?: number;
  /** 五维平加。 */
  attributeFlat?: Partial<DiscipleAttributes>;
  /** 有效最大寿命 +N 年。 */
  lifespanFlat?: number;
  /** 丹房/器坊产出 +%（M2 消费）。 */
  craftYieldPct?: number;
  /** 招募候选 +N（M2 消费）。 */
  recruitCandidateBonus?: number;
  /** 灵石收入 +%（M2 会战掠夺/历练分成消费）。 */
  incomePct?: number;
  /** 战斗旋钮（M2 消费）。 */
  combat?: {
    firstStrikeFlat?: number;
    lifestealPct?: number;
    critFlat?: number;
    statusResistPct?: number;
  };
};

export type Talent = {
  id: string;
  name: string;
  description: string;
  /** 抽取权重：数值越强权重越低；同弟子不重复。 */
  weight: number;
  effect: TalentEffect;
};

export const TALENTS: readonly Talent[] = [
  // 修炼向
  {
    id: "t-spirit-affinity",
    name: "灵气亲和",
    description: "吐纳时周身灵气自然汇聚，真元获取 +10%。",
    weight: 10,
    effect: { zhenyuanPct: 0.1 },
  },
  {
    id: "t-firm-dao-heart",
    name: "道心坚定",
    description: "心志如铁，突破成功率 +5。",
    weight: 10,
    effect: { breakthroughFlat: 5 },
  },
  {
    id: "t-born-dao-body",
    name: "天生道体",
    description: "与道合真的稀实体质，真元获取 +20%。",
    weight: 2,
    effect: { zhenyuanPct: 0.2 },
  },
  {
    id: "t-photographic-mind",
    name: "过目不忘",
    description: "经文道法一读即记，悟性 +8。",
    weight: 6,
    effect: { attributeFlat: { comprehension: 8 } },
  },
  {
    id: "t-turtle-breath",
    name: "龟息绵长",
    description: "气息悠长，有效寿元 +15 年。",
    weight: 6,
    effect: { lifespanFlat: 15 },
  },
  {
    id: "t-calm-circulation",
    name: "吐纳自若",
    description: "行功圆融无滞，真元获取 +6%。",
    weight: 12,
    effect: { zhenyuanPct: 0.06 },
  },
  {
    id: "t-breakthrough-heart",
    name: "破境之心",
    description: "从不畏惧瓶颈，突破成功率 +4。",
    weight: 8,
    effect: { breakthroughFlat: 4 },
  },
  {
    id: "t-deep-still-water",
    name: "静水深流",
    description: "沉静内敛，真元获取 +4%，悟性 +3。",
    weight: 10,
    effect: { zhenyuanPct: 0.04, attributeFlat: { comprehension: 3 } },
  },
  {
    id: "t-fetal-breath",
    name: "胎息之体",
    description: "如婴儿胎息与天地交感，真元获取 +12%。",
    weight: 5,
    effect: { zhenyuanPct: 0.12 },
  },
  {
    id: "t-enlightened-genius",
    name: "悟道奇才",
    description: "常于寻常处见道，悟性 +5，突破成功率 +3。",
    weight: 5,
    effect: { attributeFlat: { comprehension: 5 }, breakthroughFlat: 3 },
  },
  // 战斗向
  {
    id: "t-mountain-strength",
    name: "力拔山河",
    description: "天生神力，力量 +8。",
    weight: 8,
    effect: { attributeFlat: { strength: 8 } },
  },
  {
    id: "t-iron-bones",
    name: "铜筋铁骨",
    description: "筋骨如铁浇铜铸，体魄 +8。",
    weight: 8,
    effect: { attributeFlat: { physique: 8 } },
  },
  {
    id: "t-light-swallow",
    name: "身轻如燕",
    description: "身法灵动飘逸，身法 +8。",
    weight: 8,
    effect: { attributeFlat: { agility: 8 } },
  },
  {
    id: "t-condensed-soul",
    name: "神魂凝练",
    description: "神识远超同侪，魂力 +8。",
    weight: 8,
    effect: { attributeFlat: { soulPower: 8 } },
  },
  {
    id: "t-thunder-momentum",
    name: "迅雷之势",
    description: "出手快如惊雷，先攻 +3。",
    weight: 6,
    effect: { combat: { firstStrikeFlat: 3 } },
  },
  {
    id: "t-soul-devour",
    name: "吸星纳元",
    description: "伤敌时抽取气血回养自身，吸血 10%。",
    weight: 4,
    effect: { combat: { lifestealPct: 10 } },
  },
  {
    id: "t-sharp-edge",
    name: "锋芒毕露",
    description: "招招直指要害，暴击 +8。",
    weight: 6,
    effect: { combat: { critFlat: 8 } },
  },
  {
    id: "t-immovable-mountain",
    name: "不动如山",
    description: "稳如山岳，体魄 +5，力量 +3。",
    weight: 8,
    effect: { attributeFlat: { physique: 5, strength: 3 } },
  },
  {
    id: "t-heaven-blessed-all",
    name: "天纵全才",
    description: "五维俱佳，全属性 +4。",
    weight: 4,
    effect: {
      attributeFlat: { strength: 4, soulPower: 4, agility: 4, physique: 4, comprehension: 4 },
    },
  },
  {
    id: "t-soaring-spirit",
    name: "气冲霄汉",
    description: "气血神魂两旺，魂力 +5，力量 +3。",
    weight: 7,
    effect: { attributeFlat: { soulPower: 5, strength: 3 } },
  },
  // 生活向
  {
    id: "t-pill-talent",
    name: "丹道天赋",
    description: "天生亲近丹炉，丹房产出 +20%。",
    weight: 5,
    effect: { craftYieldPct: 0.2 },
  },
  {
    id: "t-forge-talent",
    name: "器道天赋",
    description: "手上功夫天成，器坊产出 +20%。",
    weight: 5,
    effect: { craftYieldPct: 0.2 },
  },
  {
    id: "t-discerning-eye",
    name: "慧眼识珠",
    description: "招募时眼光独到，候选 +1。",
    weight: 4,
    effect: { recruitCandidateBonus: 1 },
  },
  {
    id: "t-wealth-attraction",
    name: "生财有道",
    description: "经营有方，宗门灵石收入 +10%。",
    weight: 6,
    effect: { incomePct: 0.1 },
  },
  {
    id: "t-longevity-look",
    name: "长寿之相",
    description: "耳长面润是有福之相，有效寿元 +10 年。",
    weight: 7,
    effect: { lifespanFlat: 10 },
  },
  {
    id: "t-diligent-cultivation",
    name: "苦修不辍",
    description: "寒暑不辍地苦修，真元获取 +5%。",
    weight: 12,
    effect: { zhenyuanPct: 0.05 },
  },
  {
    id: "t-still-mind",
    name: "心如止水",
    description: "临瓶颈而心不乱，突破成功率 +3。",
    weight: 10,
    effect: { breakthroughFlat: 3 },
  },
  {
    id: "t-spirit-spark",
    name: "灵犀一点",
    description: "一点灵犀通窍，悟性 +6。",
    weight: 6,
    effect: { attributeFlat: { comprehension: 6 } },
  },
  {
    id: "t-poison-immune",
    name: "百毒不侵",
    description: "百毒难侵己身，异常状态抗性 20%。",
    weight: 5,
    effect: { combat: { statusResistPct: 20 } },
  },
  {
    id: "t-deep-fortune",
    name: "福缘深厚",
    description: "行走总能捡到好处，历练灵石收益 +15%。",
    weight: 4,
    effect: { incomePct: 0.15 },
  },
] as const;

const TALENT_BY_ID = new Map(TALENTS.map((talent) => [talent.id, talent]));

export function talentById(id: string): Talent | undefined {
  return TALENT_BY_ID.get(id);
}

// 天赋条数分布（百分比）：1 条 50 / 2 条 35 / 3 条 15。
export function generateTalentIds(gameSeed: string, discipleId: string): string[] {
  const countRoll = deterministicRoll(`${gameSeed}:${discipleId}:talent-count`);
  const count = countRoll < 50 ? 1 : countRoll < 85 ? 2 : 3;

  const totalWeight = TALENTS.reduce((sum, talent) => sum + talent.weight, 0);
  const picked: string[] = [];
  let round = 0;
  while (picked.length < count) {
    const roll =
      (deterministicRoll(`${gameSeed}:${discipleId}:talent:${round}`) / 100) * totalWeight;
    let cursor = 0;
    for (const talent of TALENTS) {
      cursor += talent.weight;
      if (roll < cursor) {
        if (!picked.includes(talent.id)) picked.push(talent.id);
        break;
      }
    }
    round += 1;
    if (round > 32) break;
  }
  return picked;
}

export function talentsLifespanFlat(talentIds: readonly string[]): number {
  return talentIds.reduce((sum, id) => sum + (talentById(id)?.effect.lifespanFlat ?? 0), 0);
}

export function talentsBreakthroughFlat(talentIds: readonly string[]): number {
  return talentIds.reduce((sum, id) => sum + (talentById(id)?.effect.breakthroughFlat ?? 0), 0);
}

export function talentsZhenyuanPct(talentIds: readonly string[]): number {
  return talentIds.reduce((sum, id) => sum + (talentById(id)?.effect.zhenyuanPct ?? 0), 0);
}

export function talentsAttributeFlat(talentIds: readonly string[]): DiscipleAttributes {
  const flat: DiscipleAttributes = {
    strength: 0,
    soulPower: 0,
    agility: 0,
    physique: 0,
    comprehension: 0,
  };
  for (const id of talentIds) {
    const attributeFlat = talentById(id)?.effect.attributeFlat;
    if (!attributeFlat) continue;
    for (const key of Object.keys(attributeFlat) as (keyof DiscipleAttributes)[]) {
      flat[key] += attributeFlat[key] ?? 0;
    }
  }
  return flat;
}

export function effectiveAttributes(
  base: DiscipleAttributes,
  talentIds: readonly string[],
): DiscipleAttributes {
  const flat = talentsAttributeFlat(talentIds);
  const effective = {} as DiscipleAttributes;
  for (const key of Object.keys(base) as (keyof DiscipleAttributes)[]) {
    effective[key] = Math.min(100, Math.max(1, base[key] + flat[key]));
  }
  return effective;
}
