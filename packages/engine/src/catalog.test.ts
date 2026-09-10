import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDiscipleAttributes } from "./attributes.js";
import {
  GEAR_SLOT_KEYS,
  type GearTier,
  MAX_SPELLS_PER_DISCIPLE,
  MAX_TECHNIQUES_PER_DISCIPLE,
  PILLS,
  type Pill,
  SPELLS,
  SPELL_AFFINITY_PCT,
  type Spell,
  TECHNIQUES,
  TREASURES,
  type Technique,
  canLearnSpell,
  canLearnTechnique,
  gearCombatInput,
  getPillById,
  getSpellById,
  getTechniqueById,
  getTreasureById,
  representativeTreasureOfTier,
  spellAffinityMultiplier,
  treasureEffectDescription,
  treasuresOfTier,
  workshopCraftYieldPct,
} from "./catalog.js";
import { effectiveDeathAge, generateDiscipleMaxLifespan } from "./lifespan.js";
import {
  MAJOR_REALM_LIFESPAN_INCREASES,
  REALM_STAGES,
  lifespanIncreaseForRealmLevel,
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

  it("真元需求与基础成功率锁定调平值（顶点为 ∞/0）", () => {
    assert.deepEqual(
      REALM_STAGES.map((stage) => stage.requiredZhenyuan),
      [
        1_000,
        3_000,
        5_000,
        10_000,
        30_000,
        50_000,
        100_000,
        300_000,
        500_000,
        Number.POSITIVE_INFINITY,
      ],
    );
    assert.deepEqual(
      REALM_STAGES.map((stage) => stage.baseSuccessRate),
      [50, 40, 30, 40, 30, 20, 25, 20, 10, 0],
    );
  });

  it("大境界突破寿元档位：练气→筑基 +200 / 筑基→金丹 +500 / 金丹→元婴 +1000", () => {
    assert.equal(lifespanIncreaseForRealmLevel(3), 0);
    assert.equal(lifespanIncreaseForRealmLevel(4), 200);
    assert.equal(lifespanIncreaseForRealmLevel(6), 0);
    assert.equal(lifespanIncreaseForRealmLevel(7), 500);
    assert.equal(lifespanIncreaseForRealmLevel(9), 0);
    assert.equal(lifespanIncreaseForRealmLevel(10), 1_000);
    assert.deepEqual(
      MAJOR_REALM_LIFESPAN_INCREASES.map((milestone) => milestone.increase),
      [200, 500, 1_000],
    );
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

  it("倍率表与调平基准一致", () => {
    assert.deepEqual(ROOT_MULTIPLIERS, { five: 1, four: 1.2, three: 1.5, dual: 2, single: 3 });
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

  it("有效坐化年龄 = maxLifespan（已含突破寿元） + 平加", () => {
    const deathAge = effectiveDeathAge({ age: 80, maxLifespan: 90, realmLevel: 7 }, 10);
    assert.equal(deathAge, 90 + 10);
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

describe("装备系统（法宝目录 × 10，随机炼制/掉落）", () => {
  it("目录 10 件：名称/品阶/效果逐字对齐设计表（品阶 1–4 各 3/3/2/2 件，效果两两不同）", () => {
    assert.equal(TREASURES.length, 10);
    assert.deepEqual(
      TREASURES.map((treasure) => [treasure.name, treasure.tier, treasure.effect]),
      [
        ["青云珠", 1, { attributeFlat: { soulPower: 5 } }],
        ["赤炎铃", 1, { attributeFlat: { strength: 5 } }],
        ["玄水镜", 1, { attributeFlat: { physique: 5 } }],
        ["御风环", 2, { attributeFlat: { agility: 6 } }],
        ["紫雷梭", 2, { critFlat: 8 }],
        ["黄泉幡", 2, { defensePct: 50 }],
        ["离火扇", 3, { attackPct: 35 }],
        ["山河鼎", 3, { maxHpFlat: 500 }],
        ["混沌钟", 4, { spellPowerFlat: 32 }],
        [
          "太虚塔",
          4,
          {
            attributeFlat: { strength: 3, soulPower: 3, agility: 3, physique: 3, comprehension: 3 },
          },
        ],
      ],
    );
    // 效果描述：逐件锁定展示文案，且两两不重复。
    const descriptions = TREASURES.map((treasure) => treasureEffectDescription(treasure));
    assert.deepEqual(descriptions, [
      "魂力 +5",
      "力量 +5",
      "体魄 +5",
      "身法 +6",
      "暴击率 +8%",
      "防御 +50%",
      "攻击 +35%",
      "生命 +500",
      "法威 +32",
      "五维各 +3",
    ]);
    assert.equal(new Set(descriptions).size, descriptions.length);
    assert.deepEqual([...GEAR_SLOT_KEYS], ["talisman"]);
    assert.deepEqual(
      [1, 2, 3, 4].map((tier) => treasuresOfTier(tier as GearTier).length),
      [3, 3, 2, 2],
    );
  });

  it("id 检索与品阶代表法宝（旧档迁移用）", () => {
    assert.equal(getTreasureById("gear-qingyunzhu")?.name, "青云珠");
    assert.equal(getTreasureById("gear-none"), undefined);
    assert.equal(representativeTreasureOfTier(4).id, "gear-hundunzhong");
    assert.deepEqual(representativeTreasureOfTier(1).effect.attributeFlat, { soulPower: 5 });
  });

  it("装备战力输入接口：法宝各单项效果平加", () => {
    const empty = {
      spellPowerFlat: 0,
      attackFlat: 0,
      attackPct: 0,
      defenseFlat: 0,
      defensePct: 0,
      maxHpFlat: 0,
      critFlat: 0,
      attributeFlat: {},
    };
    assert.deepEqual(gearCombatInput(undefined), empty);
    assert.deepEqual(gearCombatInput({ talisman: "gear-none" }), empty);
    assert.deepEqual(gearCombatInput({ talisman: "gear-qingyunzhu" }), {
      ...empty,
      attributeFlat: { soulPower: 5 },
    });
    assert.deepEqual(gearCombatInput({ talisman: "gear-zileisuo" }), { ...empty, critFlat: 8 });
    assert.deepEqual(gearCombatInput({ talisman: "gear-huangquanfan" }), {
      ...empty,
      defensePct: 50,
    });
    assert.deepEqual(gearCombatInput({ talisman: "gear-lihuoshan" }), { ...empty, attackPct: 35 });
    assert.deepEqual(gearCombatInput({ talisman: "gear-shanheding" }), {
      ...empty,
      maxHpFlat: 500,
    });
    assert.deepEqual(gearCombatInput({ talisman: "gear-hundunzhong" }), {
      ...empty,
      spellPowerFlat: 32,
    });
    assert.deepEqual(gearCombatInput({ talisman: "gear-taixuta" }), {
      ...empty,
      attributeFlat: { strength: 3, soulPower: 3, agility: 3, physique: 3, comprehension: 3 },
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

  it("延寿丹：最大寿命 +30 年（炼制点数统一 30，与丹方无关）", () => {
    const pill = pillByName("延寿丹");
    assert.equal(pill.effect.lifespanFlat, 30);
  });

  it("聚灵丹：12 月真元 ×1.5（倍率不叠加、时长累加）", () => {
    const pill = pillByName("聚灵丹");
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

// ─── T-E00-F02-001 补充：升阶条件表回归（既有 sectUpgradeFailureReason 不回归）───

function discipleFixture(overrides: Partial<Disciple> & Pick<Disciple, "id">): Disciple {
  const realmLevel = overrides.realmLevel ?? 1;
  return {
    id: overrides.id,
    name: overrides.name ?? `弟子${overrides.id}`,
    gender: "male",
    age: 20,
    maxLifespan: 90,
    realm: realmStageForLevel(realmLevel).realm,
    realmLevel,
    zhenyuan: 0,
    breakthroughFailures: 0,
    rootType: "single",
    rootElements: ["metal"],
    attributes: { strength: 50, soulPower: 50, agility: 50, physique: 50, comprehension: 50 },
    talentIds: [],
  };
}

function sectFixture(overrides: Partial<GameState>): GameState {
  return {
    seed: "catalog-seed",
    sectName: "测试宗",
    currentTurn: 1,
    spiritStones: 0,
    sectRank: 1,
    morale: 70,
    prestige: 50,
    discipleSeq: 0,
    disciples: [],
    chronicle: [],
    fallen: [],
    ...overrides,
  };
}

describe("升阶条件表回归（M1 既有 sectUpgradeFailureReason 不回归）", () => {
  it("1→2：任一内门达筑基（实力等级 ≥4）+ 灵石 5,000", () => {
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          spiritStones: 4000,
          disciples: [discipleFixture({ id: "d-1", realmLevel: 4 })],
        }),
      ),
      "insufficient_resource",
    );
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          spiritStones: 6000,
          disciples: [discipleFixture({ id: "d-1", realmLevel: 3 })],
        }),
      ),
      "sect_upgrade_realm_not_met",
    );
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          spiritStones: 6000,
          disciples: [discipleFixture({ id: "d-1", realmLevel: 4 })],
        }),
      ),
      undefined,
    );
  });

  it("2→3：金丹及以上内门弟子 1 名 + 灵石 50,000", () => {
    const noGoldenCore = [
      discipleFixture({ id: "d-1", realmLevel: 4 }),
      discipleFixture({ id: "d-2", realmLevel: 5 }),
    ];
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          sectRank: 2,
          spiritStones: 49000,
          disciples: [...noGoldenCore, discipleFixture({ id: "d-3", realmLevel: 7 })],
        }),
      ),
      "insufficient_resource",
    );
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          sectRank: 2,
          spiritStones: 51000,
          disciples: noGoldenCore,
        }),
      ),
      "sect_upgrade_golden_core_not_met",
    );
    assert.equal(
      sectUpgradeFailureReason(
        sectFixture({
          sectRank: 2,
          spiritStones: 51000,
          disciples: [...noGoldenCore, discipleFixture({ id: "d-3", realmLevel: 7 })],
        }),
      ),
      undefined,
    );
  });

  it("3 级封顶", () => {
    assert.equal(sectUpgradeFailureReason(sectFixture({ sectRank: 3 })), "sect_rank_maxed");
  });
});
