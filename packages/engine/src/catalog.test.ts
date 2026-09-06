import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDiscipleAttributes } from "./attributes.js";
import {
  FORGE_TIER_LIMIT_BY_RANK,
  GEAR_CATALOG,
  GEAR_CRAFT_COST,
  GEAR_CRAFT_POINTS,
  GEAR_TIERS,
  type GearSlot,
  type GearStats,
  type GearTier,
  MAX_SPELLS_PER_DISCIPLE,
  MAX_TECHNIQUES_PER_DISCIPLE,
  PILLS,
  type Pill,
  SPELLS,
  SPELL_AFFINITY_PCT,
  type Spell,
  TECHNIQUES,
  type Technique,
  canLearnSpell,
  canLearnTechnique,
  gearCombatInput,
  getGear,
  getPillById,
  getSpellById,
  getTechniqueById,
  spellAffinityMultiplier,
  workshopCraftYieldPct,
} from "./catalog.js";
import { effectiveDeathAge, generateDiscipleMaxLifespan } from "./lifespan.js";
import {
  REALM_LIFESPAN_BONUSES,
  REALM_STAGES,
  realmLifespanBonusForLevel,
  realmStageForLevel,
} from "./realms.js";
import { ROOT_ELEMENTS, ROOT_MULTIPLIERS, generateRootProfile } from "./roots.js";
import { sectUpgradeFailureReason } from "./sect.js";
import type { Disciple, GameState } from "./state.js";
import { TALENTS, generateTalentIds, talentsZhenyuanPct } from "./talents.js";

describe("境界表", () => {
  it("10 段、实力等级 1–10 连续且真元递增", () => {
    assert.equal(REALM_STAGES.length, 10);
    for (let i = 0; i < REALM_STAGES.length; i++) {
      const stage = REALM_STAGES[i];
      assert.ok(stage);
      assert.equal(stage.level, i + 1);
      if (i > 0) {
        const previous = REALM_STAGES[i - 1];
        assert.ok(previous);
        assert.ok(stage.requiredZhenyuan > previous.requiredZhenyuan);
      }
    }
    const last = REALM_STAGES[REALM_STAGES.length - 1];
    assert.ok(last);
    assert.equal(last.name, "元婴前期");
    assert.equal(realmStageForLevel(10).realm, "nascent_soul_early");
  });

  it("境界寿元加成档位", () => {
    assert.equal(realmLifespanBonusForLevel(1), 0);
    assert.equal(realmLifespanBonusForLevel(3), 0);
    assert.equal(realmLifespanBonusForLevel(4), 200);
    assert.equal(realmLifespanBonusForLevel(7), 700);
    assert.equal(realmLifespanBonusForLevel(10), 2200);
    assert.equal(REALM_LIFESPAN_BONUSES.length, 4);
  });
});

describe("五维生成", () => {
  it("确定性且在 [10, 90]", () => {
    const a = generateDiscipleAttributes({ gameSeed: "seed-1", discipleId: "d-1" });
    const b = generateDiscipleAttributes({ gameSeed: "seed-1", discipleId: "d-1" });
    assert.deepEqual(a, b);
    for (const value of Object.values(a)) {
      assert.ok(value >= 10 && value <= 90);
    }
  });

  it("总体分布均值接近 50", () => {
    let sum = 0;
    let count = 0;
    for (let i = 1; i <= 200; i++) {
      const attributes = generateDiscipleAttributes({ gameSeed: "dist", discipleId: `d-${i}` });
      for (const value of Object.values(attributes)) {
        sum += value;
        count += 1;
      }
    }
    const mean = sum / count;
    assert.ok(mean > 47 && mean < 53, `mean=${mean}`);
  });
});

describe("灵根", () => {
  it("确定性、元素数量与类型匹配且不重复", () => {
    for (let i = 1; i <= 100; i++) {
      const profile = generateRootProfile("root-seed", `d-${i}`);
      const expectedCount = { five: 5, four: 4, three: 3, dual: 2, single: 1 }[profile.rootType];
      assert.equal(profile.rootElements.length, expectedCount);
      assert.equal(new Set(profile.rootElements).size, expectedCount);
      for (const element of profile.rootElements) {
        assert.ok(ROOT_ELEMENTS.includes(element));
      }
    }
  });

  it("倍率表与主仓一致", () => {
    assert.deepEqual(ROOT_MULTIPLIERS, { five: 1, four: 1.5, three: 2, dual: 3, single: 5 });
  });
});

describe("寿命", () => {
  it("maxLifespan 在 [70, 108] 且确定", () => {
    const a = generateDiscipleMaxLifespan("life-seed", "d-1");
    assert.equal(a, generateDiscipleMaxLifespan("life-seed", "d-1"));
    for (let i = 1; i <= 100; i++) {
      const value = generateDiscipleMaxLifespan("life-seed", `d-${i}`);
      assert.ok(value >= 70 && value <= 108);
    }
  });

  it("有效坐化年龄 = 基准 + 境界加成 + 平加", () => {
    const deathAge = effectiveDeathAge({ age: 80, maxLifespan: 90, realmLevel: 7 }, 10);
    assert.equal(deathAge, 90 + 700 + 10);
  });
});

describe("天赋目录", () => {
  it("30 条、id 唯一、权重为正", () => {
    assert.equal(TALENTS.length, 30);
    assert.equal(new Set(TALENTS.map((talent) => talent.id)).size, 30);
    for (const talent of TALENTS) {
      assert.ok(talent.weight > 0);
    }
  });

  it("每人 1–3 条且不重复、确定性", () => {
    for (let i = 1; i <= 100; i++) {
      const ids = generateTalentIds("talent-seed", `d-${i}`);
      assert.ok(ids.length >= 1 && ids.length <= 3);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids, generateTalentIds("talent-seed", `d-${i}`));
    }
  });

  it("真元加成聚合", () => {
    // 灵气亲和 0.1 + 苦修不辍 0.05
    assert.ok(
      Math.abs(talentsZhenyuanPct(["t-spirit-affinity", "t-diligent-cultivation"]) - 0.15) < 1e-9,
    );
  });
});

// ─── M2 内容目录全表数值断言（锚点：设计文档 §功法目录/§法术目录/§装备系统/§丹药系统）───

function techniqueByName(name: string): Technique {
  const found = TECHNIQUES.find((entry) => entry.name === name);
  if (!found) throw new Error(`test_setup_technique_missing:${name}`);
  return found;
}

function spellByName(name: string): Spell {
  const found = SPELLS.find((entry) => entry.name === name);
  if (!found) throw new Error(`test_setup_spell_missing:${name}`);
  return found;
}

function pillByName(name: string): Pill {
  const found = PILLS.find((entry) => entry.name === name);
  if (!found) throw new Error(`test_setup_pill_missing:${name}`);
  return found;
}

describe("功法目录（8 门被动）", () => {
  it("8 门、id 唯一、名称与顺序逐字对齐设计表", () => {
    assert.equal(TECHNIQUES.length, 8);
    assert.equal(new Set(TECHNIQUES.map((entry) => entry.id)).size, 8);
    assert.deepEqual(
      TECHNIQUES.map((entry) => entry.name),
      ["混元功", "紫霞功", "金钟罩", "疾风诀", "焚心诀", "玄冰诀", "厚土诀", "养气诀"],
    );
  });

  it("全表效果数值（真元% / 五维平加 / 防御 / 突破率）", () => {
    const hunyuan = techniqueByName("混元功");
    assert.equal(hunyuan.effect.zhenyuanPct, 0.15);
    assert.deepEqual(hunyuan.effect.attributeFlat, {
      strength: 2,
      soulPower: 2,
      agility: 2,
      physique: 2,
      comprehension: 2,
    });

    const zixia = techniqueByName("紫霞功");
    assert.equal(zixia.effect.zhenyuanPct, 0.1);
    assert.deepEqual(zixia.effect.attributeFlat, { comprehension: 4 });

    const jinzhong = techniqueByName("金钟罩");
    assert.equal(jinzhong.effect.zhenyuanPct, undefined);
    assert.deepEqual(jinzhong.effect.attributeFlat, { physique: 8 });

    assert.deepEqual(techniqueByName("疾风诀").effect.attributeFlat, { agility: 8 });

    const fenxin = techniqueByName("焚心诀");
    assert.equal(fenxin.effect.zhenyuanPct, 0.12);
    assert.deepEqual(fenxin.effect.attributeFlat, { strength: 3 });

    const xuanbing = techniqueByName("玄冰诀");
    assert.equal(xuanbing.effect.zhenyuanPct, 0.1);
    assert.deepEqual(xuanbing.effect.attributeFlat, { soulPower: 4 });

    const houtu = techniqueByName("厚土诀");
    assert.deepEqual(houtu.effect.attributeFlat, { physique: 5 });
    assert.equal(houtu.effect.defenseFlat, 5);

    const yangqi = techniqueByName("养气诀");
    assert.equal(yangqi.effect.zhenyuanPct, 0.08);
    assert.equal(yangqi.effect.breakthroughFlat, 3);
  });

  it("检索与每弟子限 1 门上限", () => {
    assert.equal(getTechniqueById("tech-hunyuan")?.name, "混元功");
    assert.equal(getTechniqueById("tech-none"), undefined);
    assert.equal(MAX_TECHNIQUES_PER_DISCIPLE, 1);
    // 藏经阁拥有 + 未满 → 可学；未拥有 / 已满 → 不可学。
    assert.equal(canLearnTechnique(["tech-hunyuan"], "tech-hunyuan", 0), true);
    assert.equal(canLearnTechnique([], "tech-hunyuan", 0), false);
    assert.equal(canLearnTechnique(["tech-hunyuan"], "tech-hunyuan", 1), false);
  });
});

describe("法术目录（12 门主动战技）", () => {
  it("12 门、id 唯一、名称与顺序逐字对齐设计表", () => {
    assert.equal(SPELLS.length, 12);
    assert.equal(new Set(SPELLS.map((entry) => entry.id)).size, 12);
    assert.deepEqual(
      SPELLS.map((entry) => entry.name),
      [
        "金锋斩",
        "青木缠",
        "寒冰咒",
        "炎爆术",
        "裂地击",
        "三昧真火",
        "业火焚心",
        "玄冰刺",
        "凝霜术",
        "玄光罩",
        "灵龟盾",
        "摄魂大法",
      ],
    );
  });

  it("全表数值：五行系 / 倍率 / CD / 附加效果", () => {
    const cases: Array<[string, Spell["element"], number, number, Spell["status"]]> = [
      ["金锋斩", "metal", 2.2, 3, {}],
      ["青木缠", "wood", 1.8, 4, { lifestealPct: 20 }],
      ["寒冰咒", "water", 1.2, 6, { freeze: { turns: 1 } }],
      ["炎爆术", "fire", 2.6, 5, { burn: { hpPctPerTurn: 6, turns: 3 } }],
      ["裂地击", "earth", 2.0, 4, { ignoreDefensePct: 30 }],
      ["三昧真火", "fire", 1.5, 6, { burn: { hpPctPerTurn: 6, turns: 3 } }],
      ["业火焚心", "fire", 1.0, 4, { burn: { hpPctPerTurn: 8, turns: 2 } }],
      ["玄冰刺", "water", 1.4, 5, { freeze: { turns: 1, chancePct: 30 } }],
      ["凝霜术", "water", 0.8, 4, { slow: { firstStrikeFlat: 5, turns: 3 } }],
      ["玄光罩", "none", 0, 6, { shieldHpPct: 20 }],
      ["灵龟盾", "none", 0, 5, { shieldHpPct: 12, reflectPct: 10 }],
      ["摄魂大法", "none", 1.6, 6, { lifestealPct: 30 }],
    ];
    assert.equal(cases.length, SPELLS.length);
    for (const [name, element, multiplier, cooldown, status] of cases) {
      const spell = spellByName(name);
      assert.equal(spell.element, element, `${name} 五行系`);
      assert.equal(spell.multiplier, multiplier, `${name} 倍率`);
      assert.equal(spell.cooldown, cooldown, `${name} CD`);
      assert.deepEqual(spell.status, status, `${name} 附加效果`);
    }
  });

  it("相性：同灵根元素 +15%，异系与无系恒为 1", () => {
    assert.equal(SPELL_AFFINITY_PCT, 0.15);
    const jinfeng = spellByName("金锋斩");
    assert.ok(Math.abs(spellAffinityMultiplier(jinfeng, ["metal"]) - 1.15) < 1e-9);
    assert.ok(Math.abs(spellAffinityMultiplier(jinfeng, ["fire", "wood"]) - 1) < 1e-9);
    assert.ok(Math.abs(spellAffinityMultiplier(jinfeng, []) - 1) < 1e-9);
    const xuanguang = spellByName("玄光罩");
    assert.ok(Math.abs(spellAffinityMultiplier(xuanguang, ["metal"]) - 1) < 1e-9);
  });

  it("检索与每弟子限 2 门上限", () => {
    assert.equal(getSpellById("spell-jinfeng")?.name, "金锋斩");
    assert.equal(getSpellById("spell-none"), undefined);
    assert.equal(MAX_SPELLS_PER_DISCIPLE, 2);
    assert.equal(canLearnSpell(["spell-jinfeng"], "spell-jinfeng", 1), true);
    assert.equal(canLearnSpell([], "spell-jinfeng", 0), false);
    assert.equal(canLearnSpell(["spell-jinfeng"], "spell-jinfeng", 2), false);
  });
});

describe("装备系统（4 槽 × 4 档固定数值）", () => {
  it("全表数值逐字对齐设计表", () => {
    const expected: Record<GearSlot, Record<GearTier, GearStats>> = {
      weapon: {
        1: { attackFlat: 10 },
        2: { attackFlat: 25 },
        3: { attackFlat: 45 },
        4: { attackFlat: 70 },
      },
      armor: {
        1: { defenseFlat: 10 },
        2: { defenseFlat: 25 },
        3: { defenseFlat: 45 },
        4: { defenseFlat: 70 },
      },
      accessory: {
        1: { attributeFlat: 2 },
        2: { attributeFlat: 4 },
        3: { attributeFlat: 6 },
        4: { attributeFlat: 9 },
      },
      talisman: {
        1: { spellPowerFlat: 8 },
        2: { spellPowerFlat: 14 },
        3: { spellPowerFlat: 22 },
        4: { spellPowerFlat: 32 },
      },
    };
    assert.deepEqual(GEAR_CATALOG, expected);
  });

  it("器坊点数 20/60/150/300、费用 200/600/1500/3000", () => {
    assert.deepEqual(GEAR_CRAFT_POINTS, { 1: 20, 2: 60, 3: 150, 4: 300 });
    assert.deepEqual(GEAR_CRAFT_COST, { 1: 200, 2: 600, 3: 1500, 4: 3000 });
    assert.deepEqual([...GEAR_TIERS], [1, 2, 3, 4]);
  });

  it("宗门等级限档映射：1 级→档 2 / 2 级→档 3 / 3 级→档 4", () => {
    assert.deepEqual(FORGE_TIER_LIMIT_BY_RANK, { 1: 2, 2: 3, 3: 4 });
  });

  it("装备战力输入接口：四槽合计平加", () => {
    assert.deepEqual(getGear("weapon", 1), { attackFlat: 10 });
    assert.deepEqual(getGear("accessory", 4), { attributeFlat: 9 });
    assert.deepEqual(gearCombatInput(undefined), {
      attackFlat: 0,
      defenseFlat: 0,
      attributeFlat: 0,
      spellPowerFlat: 0,
    });
    assert.deepEqual(gearCombatInput({ weapon: 1, armor: 2, accessory: 3, talisman: 4 }), {
      attackFlat: 10,
      defenseFlat: 25,
      attributeFlat: 6,
      spellPowerFlat: 32,
    });
  });
});

describe("丹药系统（2 种，丹房）", () => {
  it("2 种、名称与顺序逐字对齐设计表", () => {
    assert.equal(PILLS.length, 2);
    assert.deepEqual(
      PILLS.map((entry) => entry.name),
      ["延寿丹", "聚灵丹"],
    );
  });

  it("延寿丹：40 点 / 500 灵石 / 2 月 / 最大寿命 +10 年", () => {
    const pill = pillByName("延寿丹");
    assert.equal(pill.craftPoints, 40);
    assert.equal(pill.craftCost, 500);
    assert.equal(pill.craftMonths, 2);
    assert.equal(pill.effect.lifespanFlat, 10);
  });

  it("聚灵丹：20 点 / 300 灵石 / 1 月 / 12 月真元 ×1.5 不叠加刷新", () => {
    const pill = pillByName("聚灵丹");
    assert.equal(pill.craftPoints, 20);
    assert.equal(pill.craftCost, 300);
    assert.equal(pill.craftMonths, 1);
    assert.deepEqual(pill.effect.zhenyuanBuff, { multiplier: 1.5, months: 12, stacks: false });
  });

  it("检索", () => {
    assert.equal(getPillById("pill-yanshou")?.name, "延寿丹");
    assert.equal(getPillById("pill-none"), undefined);
  });
});

describe("craftYieldPct 聚合（丹房/器坊生产速率）", () => {
  it("丹道天赋加成丹房、器道天赋加成器坊，各 +20%", () => {
    assert.ok(Math.abs(workshopCraftYieldPct("pill", ["t-pill-talent"]) - 0.2) < 1e-9);
    assert.ok(Math.abs(workshopCraftYieldPct("gear", ["t-forge-talent"]) - 0.2) < 1e-9);
  });

  it("天赋不跨车间加成；同车间多天赋聚合", () => {
    assert.ok(Math.abs(workshopCraftYieldPct("gear", ["t-pill-talent"]) - 0) < 1e-9);
    assert.ok(
      Math.abs(workshopCraftYieldPct("pill", ["t-pill-talent", "t-forge-talent"]) - 0.2) < 1e-9,
    );
  });
});
