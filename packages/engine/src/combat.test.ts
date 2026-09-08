// 战斗系统 golden 与单元测试（E01 波次：combat-profile / battle / battle-status）。
// 数值锚点全部取自 docs/design/2026-09-06-小程序简化版设计.md §战斗系统 表格，不从旧实现反抄。
// 本文件锁定：属性派生唯一公式（deriveCombatProfile / buildCombatProfile）、回合规则
//（runBattle：先攻/CD/伤害/命中暴击/平局/伤势/确定性）与状态效果的战斗接入行为；
// 状态纯函数契约由 battle.test.ts（T-E00-F01-001）锁定。
// 全部确定性：无 Math.random；掷骰走 hash.deterministicRoll（sha256）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscipleAttributes } from "./attributes.js";
import type { BattleFighter, BattlePlanEntry, BattleSpell } from "./battle.js";
import {
  BASIC_ATTACK_MULTIPLIER,
  CRIT_MULTIPLIER,
  DEFEAT_HEAVY_INJURY_PCT,
  DEFEAT_LIGHT_INJURY_PCT,
  HEAVY_INJURY_MONTHS,
  HIT_RATE,
  LIGHT_INJURY_MONTHS,
  MAX_BATTLE_ROUNDS,
  computeDamage,
  runBattle,
} from "./battle.js";
import { getSpellById } from "./catalog.js";
import { type CombatProfile, buildCombatProfile, deriveCombatProfile } from "./combat-profile.js";
import type { Disciple } from "./state.js";

const BASE_ATTRIBUTES: DiscipleAttributes = {
  strength: 50,
  soulPower: 50,
  agility: 50,
  physique: 50,
  comprehension: 50,
};

const WEAK_ATTRIBUTES: DiscipleAttributes = {
  strength: 10,
  soulPower: 10,
  agility: 10,
  physique: 10,
  comprehension: 10,
};

function profileFighter(
  name: string,
  profile: CombatProfile,
  overrides: Partial<Omit<BattleFighter, "name" | "profile">> = {},
): BattleFighter {
  return {
    name,
    profile,
    rootElements: [],
    spells: [],
    plan: [{ kind: "basic" }],
    ...overrides,
  };
}

function makeDisciple(overrides: Partial<Disciple> = {}): Disciple {
  return {
    id: "d-a",
    name: "甲",
    gender: "male",
    age: 20,
    maxLifespan: 80,
    realm: "qi_refining_early",
    realmLevel: 1,
    zhenyuan: 0,
    breakthroughFailures: 0,
    rootType: "five",
    rootElements: ["wood"],
    attributes: { ...BASE_ATTRIBUTES },
    talentIds: [],
    ...overrides,
  };
}

function fighterOf(
  name: string,
  overrides: Partial<Disciple> = {},
  spells: BattleSpell[] = [],
  plan: BattlePlanEntry[] = [],
): BattleFighter {
  const disciple = makeDisciple({ name, ...overrides });
  return {
    name,
    profile: buildCombatProfile(disciple),
    rootElements: disciple.rootElements,
    spells,
    plan: plan.length > 0 ? plan : [{ kind: "basic" }],
  };
}

function spellPlan(spellId: string): BattlePlanEntry[] {
  return [{ kind: "spell", spellId }];
}

describe("属性派生唯一公式（combat-profile，玩家与 NPC 共用）", () => {
  it("最大生命 = 100 + 实力等级×体魄 + (实力等级−1)×50", () => {
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, physique: 50 } })
        .maxHp,
      150, // 100 + 50×1
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 7, attributes: { ...BASE_ATTRIBUTES, physique: 80 } })
        .maxHp,
      960, // 100 + 80×7 + 6×50
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 10, attributes: { ...BASE_ATTRIBUTES, physique: 100 } })
        .maxHp,
      1550, // 100 + 100×10 + 9×50
    );
  });

  it("物理攻击 = 30 + 等级×(力量/4) + (等级−1)×10", () => {
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES }).physicalAttack,
      43, // 30 + 50/4 = 42.5 → 43
    );
    assert.equal(
      deriveCombatProfile({
        realmLevel: 1,
        attributes: { ...BASE_ATTRIBUTES, strength: 100 },
      }).physicalAttack,
      55,
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 10, attributes: BASE_ATTRIBUTES }).physicalAttack,
      245, // 30 + 12.5×10 + 9×10
    );
  });

  it("法术威力 = 30 + 等级×(魂力/4) + (等级−1)×10 + 法宝法威（档 1=+8 / 档 4=+32）", () => {
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES }).magicPower,
      43,
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES, artifactMagic: 8 })
        .magicPower,
      51,
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 10, attributes: BASE_ATTRIBUTES, artifactMagic: 32 })
        .magicPower,
      277,
    );
  });

  it("防御 = ⌊5 + 等级×(体魄/4) + (等级−1)×4⌋ + 功法防御平加（向下取整）", () => {
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, physique: 47 } })
        .defense,
      16, // 5 + 47/4 = 16.75 → ⌊⌋
    );
    assert.equal(
      deriveCombatProfile({
        realmLevel: 1,
        attributes: { ...BASE_ATTRIBUTES, physique: 47 },
        defenseFlat: 5,
      }).defense,
      21,
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 10, attributes: BASE_ATTRIBUTES }).defense,
      166, // 5 + 12.5×10 + 9×4
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, physique: 100 } })
        .defense,
      30,
    );
  });

  it("先攻 = 身法 + 天赋先攻 + 状态修正（迅雷之势 +3、减速 −5）", () => {
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, agility: 60 } })
        .firstStrike,
      60,
    );
    assert.equal(
      deriveCombatProfile({
        realmLevel: 1,
        attributes: { ...BASE_ATTRIBUTES, agility: 60 },
        firstStrikeFlat: 3,
      }).firstStrike,
      63,
    );
    assert.equal(
      deriveCombatProfile({
        realmLevel: 1,
        attributes: { ...BASE_ATTRIBUTES, agility: 60 },
        firstStrikeFlat: 3,
        firstStrikeModifier: -5,
      }).firstStrike,
      58,
    );
  });

  it("暴击率 = 10 + 悟性/4 + 天赋暴击，上限 50（锋芒毕露 +8）", () => {
    assert.equal(deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES }).critRate, 23);
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, comprehension: 90 } })
        .critRate,
      33, // 10 + round(90/4)
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES, critFlat: 8 }).critRate,
      31,
    );
    assert.equal(
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES, critFlat: 100 }).critRate,
      50,
    );
  });

  it("弟子适配层：法宝/功法/天赋聚合成有效五维后进入公式，并返回分来源明细", () => {
    const profile = buildCombatProfile(
      makeDisciple({
        equippedGear: { talisman: 1 },
        techniqueId: "tech-houtu",
        talentIds: ["t-thunder-momentum"],
      }),
    );
    // 有效五维：五维 = 基础 50 + 厚土诀体魄 5 → 体魄 55，其余 50。
    assert.equal(profile.maxHp, 100 + 55);
    assert.equal(profile.defense, Math.floor(5 + (55 / 4) * 1) + 5);
    assert.equal(profile.physicalAttack, 43);
    assert.equal(profile.magicPower, 43 + 8);
    assert.equal(profile.firstStrike, 50 + 3);
    assert.equal(profile.breakdown.attributes.effective.physique, 55);
    assert.equal(profile.breakdown.attributes.artFlat.physique, 5);
    assert.equal(profile.breakdown.artDefenseFlat, 5);
    assert.equal(profile.breakdown.talentFirstStrikeFlat, 3);
    // 减速修正经 speedModifier 进入先攻。
    const slowed = buildCombatProfile(makeDisciple(), { speedModifier: -5 });
    assert.equal(slowed.firstStrike, 45);
  });
});

describe("回合规则（battle）", () => {
  it("常量锚点：命中 90 / 暴伤 2× / 普攻 1.0× / 30 回合上限 / 伤势 40/20 与 1/3 月", () => {
    assert.equal(HIT_RATE, 90);
    assert.equal(CRIT_MULTIPLIER, 2);
    assert.equal(BASIC_ATTACK_MULTIPLIER, 1.0);
    assert.equal(MAX_BATTLE_ROUNDS, 30);
    assert.equal(DEFEAT_LIGHT_INJURY_PCT, 40);
    assert.equal(DEFEAT_HEAVY_INJURY_PCT, 20);
    assert.equal(LIGHT_INJURY_MONTHS, 1);
    assert.equal(HEAVY_INJURY_MONTHS, 3);
  });

  it("伤害 = max(1, round(攻击×倍率 − 防御×0.8))；暴击再 ×2", () => {
    assert.equal(computeDamage({ attack: 110, multiplier: 1.0, defense: 0 }), 110);
    assert.equal(computeDamage({ attack: 110, multiplier: 1.0, defense: 50 }), 70);
    assert.equal(computeDamage({ attack: 110, multiplier: 2.2, defense: 50 }), 202);
    assert.equal(computeDamage({ attack: 100, multiplier: 0.8, defense: 50 }), 40);
    assert.equal(computeDamage({ attack: 2, multiplier: 1.0, defense: 220 }), 1);
    assert.equal(computeDamage({ attack: 110, multiplier: 1.0, defense: 0, crit: true }), 220);
    assert.equal(computeDamage({ attack: 100, multiplier: 1.2, defense: 50, crit: true }), 160);
    assert.equal(computeDamage({ attack: 2, multiplier: 1.0, defense: 220, crit: true }), 2);
  });

  it("先攻高者先行动；同值攻方（A 方）先", () => {
    const fast = profileFighter(
      "快手",
      deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, agility: 60 } }),
    );
    const slow = profileFighter(
      "慢手",
      deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES }),
    );
    const report = runBattle(fast, slow, "battle-order-golden");
    const first = report.actions[0];
    assert.ok(first);
    assert.equal(first.actor, "A");

    const tie = runBattle(
      slow,
      profileFighter("对手", deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES })),
      "battle-tie-golden",
    );
    const tieFirst = tie.actions[0];
    assert.ok(tieFirst);
    assert.equal(tieFirst.actor, "A");
  });

  it("30 回合未分胜负判平：双方无伤势，双方伤害至多个位数", () => {
    // 双方攻击 123、防御 291、生命 1550：单击减伤后恒为 min 值 1（暴击 round(1×2)=2），
    // 30 回合累计 ≤60，必然打不死 → 平局与掷骰结果无关。
    const stumpy = () =>
      profileFighter(
        "铁桶",
        deriveCombatProfile({
          realmLevel: 10,
          attributes: { strength: 1, soulPower: 1, agility: 50, physique: 100, comprehension: 50 },
        }),
      );
    const report = runBattle(stumpy(), stumpy(), "battle-draw-golden");
    assert.equal(report.winner, "draw");
    assert.equal(report.rounds, MAX_BATTLE_ROUNDS);
    assert.equal(report.actions.length, 60);
    for (const action of report.actions) {
      assert.ok(action.damage >= 0 && action.damage <= 2, `damage=${action.damage}`);
    }
    assert.ok(report.totalDamage.A <= 60 && report.totalDamage.B <= 60);
    assert.equal(report.injuries.A, "none");
    assert.equal(report.injuries.B, "none");
  });

  it("法术冷却：CD 内自动回落普通攻伐（金锋斩 CD 3 → 法/普/普/法）", () => {
    // 施法者：魂力 90 + 法宝档 4（+32）→ 法威 30+225+90+32=377；等级 10 体魄 90 → 生命 1450、防御 266。
    // 金锋斩 2.2× 且与金灵根同系 ×1.15 → 对防 266 目标单发 round(377×2.53−212.8)=741；普攻 32。
    const spell = {
      id: "s-jinfeng",
      name: "金锋斩",
      element: "metal",
      multiplier: 2.2,
      cooldown: 3,
    } as const;
    const caster = profileFighter(
      "施法者",
      deriveCombatProfile({
        realmLevel: 10,
        attributes: { ...BASE_ATTRIBUTES, soulPower: 90, physique: 90 },
        artifactMagic: 32,
      }),
      {
        rootElements: ["metal"],
        spells: [spell],
        plan: [{ kind: "spell", spellId: "s-jinfeng" }],
      },
    );
    const tank = profileFighter(
      "铁塔",
      deriveCombatProfile({ realmLevel: 10, attributes: { ...BASE_ATTRIBUTES, physique: 90 } }),
    );
    const report = runBattle(caster, tank, "battle-cd-golden");
    const casterActions = report.actions.filter((action) => action.actor === "A").slice(0, 4);
    assert.deepEqual(
      casterActions.map((action) => action.kind),
      ["spell", "basic", "basic", "spell"],
    );
    assert.equal(casterActions[0]?.spellId, "s-jinfeng");
    assert.equal(casterActions[3]?.spellId, "s-jinfeng");
    const firstSpell = casterActions[0];
    assert.ok(firstSpell);
    if (firstSpell.hit) assert.equal(firstSpell.damage, 741);
    assert.equal(report.winner, "A");
  });

  it("命中率 90%、暴击率 23%（悟性 50）的统计口径（200 场固定 seed 派生，全程确定）", () => {
    const brawler = () =>
      profileFighter("斗士", deriveCombatProfile({ realmLevel: 1, attributes: BASE_ATTRIBUTES }));
    let attacks = 0;
    let hits = 0;
    let crits = 0;
    for (let i = 1; i <= 200; i++) {
      const report = runBattle(brawler(), brawler(), `battle-dist-${i}`);
      for (const action of report.actions) {
        if (action.actor !== "A") continue;
        attacks += 1;
        if (action.hit) {
          hits += 1;
          if (action.crit) crits += 1;
        }
      }
    }
    const hitRate = hits / attacks;
    assert.ok(hitRate > 0.85 && hitRate < 0.95, `命中率 ${hitRate}`);
    const critRate = crits / hits;
    assert.ok(critRate > 0.18 && critRate < 0.28, `暴击率 ${critRate}`);
  });

  it("伤势：胜利方无伤，战败方按 40% 轻伤 / 20% 重伤 / 其余无伤掷骰", () => {
    // 10 级强者对 1 级弱者形成完全压制（单击 241 一击必杀、对方反击恒 min 1），
    // 胜负与伤势掷骰解耦，200 seed 只统计伤势分布。
    const bully = () =>
      profileFighter("强者", deriveCombatProfile({ realmLevel: 10, attributes: BASE_ATTRIBUTES }));
    const weakling = () =>
      profileFighter(
        "弱者",
        deriveCombatProfile({ realmLevel: 1, attributes: { ...BASE_ATTRIBUTES, physique: 1 } }),
      );
    const counts = { none: 0, light: 0, heavy: 0 };
    for (let i = 1; i <= 200; i++) {
      const report = runBattle(bully(), weakling(), `battle-injury-${i}`);
      assert.equal(report.winner, "A");
      assert.equal(report.injuries.A, "none");
      counts[report.injuries.B] += 1;
    }
    assert.ok(counts.light / 200 >= 0.32 && counts.light / 200 <= 0.48, `light=${counts.light}`);
    assert.ok(counts.heavy / 200 >= 0.12 && counts.heavy / 200 <= 0.28, `heavy=${counts.heavy}`);
  });

  it("天赋吸血：按名义伤害回量，不越过最大生命", () => {
    // 乙先手打甲 40 点，甲反击命中时吸血 10% = 4。
    const healer = fighterOf("甲", { talentIds: ["t-soul-devour"] });
    const striker = fighterOf("乙", { attributes: { ...BASE_ATTRIBUTES, agility: 60 } });
    const report = runBattle(healer, striker, "lifesteal-1");
    const reply = report.actions.find(
      (entry) => entry.actor === "A" && entry.hit === true && entry.lifestealHeal > 0,
    );
    assert.ok(reply);
    assert.equal(reply.lifestealHeal, Math.round((reply.damage * 10) / 100));
  });

  it("确定性：同 seed 双跑 deepEqual；不同 seed 战报不同（禁 Math.random）", () => {
    const a = () => fighterOf("甲");
    const b = () => fighterOf("乙");
    const first = runBattle(a(), b(), "battle-det-seed");
    assert.deepEqual(first, runBattle(a(), b(), "battle-det-seed"));
    assert.notDeepEqual(first, runBattle(a(), b(), "battle-det-seed-2"));
  });
});

describe("状态效果接入（battle-status × battle）", () => {
  it("灼烧：回合末结算 6% 最大生命（次回合起扣血）", () => {
    const sanmei = getSpellById("spell-sanmei");
    assert.ok(sanmei);
    const caster = fighterOf("甲", {}, [sanmei], spellPlan(sanmei.id));
    const target = fighterOf("乙", {});
    const report = runBattle(caster, target, "status-burn-1");
    const burnTicks = report.actions.filter(
      (entry) => entry.kind === "burn" && entry.actor === "B",
    );
    assert.ok(burnTicks.length > 0, "灼烧应至少结算一次");
    for (const tick of burnTicks) {
      assert.equal(tick.damage, 9); // 150 × 6%
      assert.equal(tick.hpLoss, 0); // 灼烧直接扣血，不走护盾口径
    }
  });

  it("灼烧可致死：灼烧结算打空生命，战败方按掷骰结算伤势", () => {
    const yehuo = getSpellById("spell-yehuo");
    assert.ok(yehuo);
    // 双方 10 级互压成刮痧（甲普攻对防 291 恒 min 1、业火单发 112；乙普攻 min 1），
    // 主要伤害来自业火灼烧（每 tick 8% × 1550 = 124），30 回合内必有多枚 tick 并磨死乙。
    const caster = fighterOf(
      "甲",
      {
        realmLevel: 10,
        attributes: { ...BASE_ATTRIBUTES, strength: 1, physique: 90, soulPower: 90 },
      },
      [yehuo],
      spellPlan(yehuo.id),
    );
    const fragile = fighterOf("乙", {
      realmLevel: 10,
      attributes: { ...WEAK_ATTRIBUTES, physique: 100 },
    });
    const report = runBattle(caster, fragile, "status-burn-kill-1");
    assert.equal(report.winner, "A");
    assert.ok(
      report.actions.some((entry) => entry.kind === "burn" && entry.actor === "B"),
      "灼烧应至少结算一次",
    );
    assert.equal(report.finalHp.B, 0);
  });

  it("冰冻：命中后下一回合跳过行动，之后恢复", () => {
    const hanbing = getSpellById("spell-hanbing");
    assert.ok(hanbing);
    const caster = fighterOf(
      "甲",
      { attributes: { ...BASE_ATTRIBUTES, agility: 60 } },
      [hanbing],
      spellPlan(hanbing.id),
    );
    const target = fighterOf("乙", {});
    const report = runBattle(caster, target, "status-freeze-1");
    const firstCast = report.actions.find(
      (entry) =>
        entry.actor === "A" &&
        entry.kind === "spell" &&
        entry.spellId === hanbing.id &&
        entry.hit === true,
    );
    assert.ok(firstCast, "寒冰咒应至少命中一次");
    const skips = report.actions.filter((entry) => entry.kind === "skip" && entry.actor === "B");
    assert.ok(skips.length >= 1);
    const firstSkip = skips[0];
    assert.ok(firstSkip);
    assert.equal(firstSkip.round, firstCast.round + 1);
    // 跳过当回合乙没有其他行动条目。
    const actedOnSkipRound = report.actions.some(
      (entry) => entry.round === firstSkip.round && entry.actor === "B" && entry.kind !== "skip",
    );
    assert.equal(actedOnSkipRound, false);
  });

  it("减速：先攻 −5 持续 3 回合，行动顺序翻转后恢复", () => {
    const ningshuang = getSpellById("spell-ningshuang");
    assert.ok(ningshuang);
    // 平常乙先手（54 > 50）；被减速后甲先手，持续 3 回合后恢复。
    const caster = fighterOf("甲", {}, [ningshuang], spellPlan(ningshuang.id));
    const swift = fighterOf("乙", { attributes: { ...BASE_ATTRIBUTES, agility: 54 } });
    const report = runBattle(caster, swift, "status-slow-1");
    const appliedRound = report.actions.find((entry) =>
      entry.statusNotes.some((note) => note.includes("被附加减速")),
    )?.round;
    assert.ok(appliedRound, "凝霜术应至少命中并附加减速一次");
    const applied = appliedRound ?? 0;
    for (let offset = 1; offset <= 3; offset++) {
      const roundEntries = report.actions.filter((entry) => entry.round === applied + offset);
      const first = roundEntries[0];
      assert.ok(first);
      assert.equal(first.actor, "A", `第 ${applied + offset} 回合甲应先手`);
    }
    const recovered = report.actions.filter((entry) => entry.round === applied + 4);
    const firstRecovered = recovered[0];
    assert.ok(firstRecovered);
    assert.equal(firstRecovered.actor, "B", "减速消退后乙恢复先手");
  });

  it("护盾：吸收伤害直至破除；吸收量与扣血守恒", () => {
    const xuanguang = getSpellById("spell-xuanguang");
    assert.ok(xuanguang);
    const caster = fighterOf("甲", {}, [xuanguang], spellPlan(xuanguang.id));
    const striker = fighterOf("乙", {});
    const report = runBattle(caster, striker, "status-shield-1");
    const shieldCast = report.actions.find(
      (entry) => entry.actor === "A" && entry.kind === "spell" && entry.spellId === xuanguang.id,
    );
    assert.ok(shieldCast);
    assert.equal(shieldCast.hit, undefined); // 纯增益法术不掷命中
    assert.equal(shieldCast.damage, 0);
    assert.ok(shieldCast.statusNotes.some((note) => note.includes("护盾")));
    // 打在护盾上的攻击（乙的行动条目）应出现吸收量。
    const absorbed = report.actions.filter(
      (entry) => entry.actor === "B" && (entry.shieldAbsorbed ?? 0) > 0,
    );
    assert.ok(absorbed.length > 0, "护盾应吸收至少一次伤害");
    for (const entry of report.actions) {
      if (entry.hit === true) {
        assert.equal(entry.damage, (entry.shieldAbsorbed ?? 0) + entry.hpLoss);
      }
    }
  });

  it("反伤：受击反弹实际扣血伤害的 10%", () => {
    const linggui = getSpellById("spell-linggui");
    assert.ok(linggui);
    const turtle = fighterOf("甲", {}, [linggui], spellPlan(linggui.id));
    const striker = fighterOf("乙", { attributes: { ...BASE_ATTRIBUTES, strength: 90 } });
    const report = runBattle(turtle, striker, "status-reflect-1");
    const reflected = report.actions.filter((entry) => (entry.reflectDamage ?? 0) > 0);
    assert.ok(reflected.length > 0, "护盾破碎前应触发反伤");
    for (const entry of reflected) {
      assert.equal(entry.reflectDamage, Math.round((entry.hpLoss * 10) / 100));
    }
  });

  it("状态抗性：百毒不侵 20% 按概率抵消附加（40 场固定 seed）", () => {
    const yanbao = getSpellById("spell-yanbao");
    assert.ok(yanbao);
    // 双方互为刮痧：10 级攻击 123 对防御 291 → 普攻恒 min 1，主要伤害来自炎爆术与灼烧，
    // 30 回合内难以速胜，保证多次施法附加尝试。
    const caster = fighterOf(
      "甲",
      {
        realmLevel: 10,
        attributes: { ...WEAK_ATTRIBUTES, strength: 1, soulPower: 10, physique: 100 },
      },
      [yanbao],
      spellPlan(yanbao.id),
    );
    const resistant = fighterOf("乙", {
      realmLevel: 10,
      attributes: { ...WEAK_ATTRIBUTES, strength: 1, physique: 100 },
      talentIds: ["t-poison-immune"],
    });
    let applied = 0;
    let resisted = 0;
    for (let i = 0; i < 40; i++) {
      const report = runBattle(caster, resistant, `status-resist-${i}`);
      for (const entry of report.actions) {
        for (const note of entry.statusNotes) {
          if (note.includes("被附加灼烧")) applied += 1;
          if (note.includes("抗性抵消")) resisted += 1;
        }
      }
    }
    const total = applied + resisted;
    assert.ok(total > 100, `附加尝试次数 ${total}`);
    assert.ok(resisted / total > 0.1 && resisted / total < 0.3, `抵抗率 ${resisted}/${total}`);
  });

  it("状态战同输入双跑 deepEqual", () => {
    const sanmei = getSpellById("spell-sanmei");
    assert.ok(sanmei);
    const a = fighterOf("甲", {}, [sanmei], spellPlan(sanmei.id));
    const b = fighterOf("乙", { talentIds: ["t-poison-immune"] });
    assert.deepEqual(runBattle(a, b, "status-double"), runBattle(a, b, "status-double"));
  });
});
