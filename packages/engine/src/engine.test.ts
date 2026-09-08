// M1 月结闭环切片测试：开局 → 月结 → 突破 → 衰老坐化 → 管理命令 → 结局。
// M2 追加：研读功法法术 / 穿戴装备 / 服用丹药 / 任命长老（E02-F03）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BattleReport } from "./battle.js";
import { SPELLS } from "./catalog.js";
import { buildCombatProfile } from "./combat-profile.js";
import {
  appointElder,
  createGame,
  discipleCultivationView,
  learnArt,
  listRecruitCandidates,
  recruitDisciple,
  upgradeSect,
  usePill,
  wearGear,
} from "./engine.js";
import { deterministicRoll } from "./hash.js";
import { assignWorkshopJob } from "./production.js";
import { realmStageForLevel } from "./realms.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import { OUTER_INCOME_PER_DISCIPLE, sectLimitsFor } from "./sect.js";
import {
  BATTLE_LOG_BYTE_BUDGET,
  BATTLE_LOG_LIMIT,
  EPIPHANY_CHANCE_PCT,
  ZHENYUAN_BASE,
  ZHENYUAN_COMPREHENSION_COEFF,
  currentSuccessRate,
  monthlyZhenyuanGain,
  prependBattleReports,
  settleMonthly,
} from "./settlement.js";
import type { GameState, SettlementResult } from "./state.js";
import { talentsAttributeFlat, talentsZhenyuanPct } from "./talents.js";

function newGame(seed = "slice-seed-1"): GameState {
  return createGame({ seed, sectName: "青云门" });
}

function discipleOf(state: GameState, id: string) {
  const disciple = state.disciples.find((entry) => entry.id === id);
  if (!disciple) throw new Error(`test_setup_disciple_missing:${id}`);
  return disciple;
}

function runMonths(state: GameState, months: number) {
  let current = state;
  const results: SettlementResult[] = [];
  for (let i = 0; i < months; i++) {
    const outcome = settleMonthly(current);
    current = outcome.state;
    results.push(outcome.result);
  }
  return { state: current, results };
}

describe("开局", () => {
  it("初始状态：1 级宗门、3 弟子、灵石 2000、士气 70", () => {
    const state = newGame();
    assert.equal(state.sectRank, 1);
    assert.equal(state.currentTurn, 1);
    assert.equal(state.spiritStones, 2000);
    assert.equal(state.morale, 70);
    assert.equal(state.disciples.length, 3);
    assert.equal(
      state.disciples.every((disciple) => disciple.realmLevel === 1),
      true,
    );
    assert.ok(state.chronicle.length > 0);
  });

  it("同 seed 恒定", () => {
    assert.deepEqual(newGame(), newGame());
    assert.notDeepEqual(newGame("seed-a"), newGame("seed-b"));
  });

  it("非法开局输入", () => {
    assert.throws(() => createGame({ seed: "", sectName: "青云门" }));
    assert.throws(() => createGame({ seed: "s", sectName: "门" }));
  });
});

describe("月度结算", () => {
  it("12 月推进：回合 13、月结收支 = 灵脉产出 − 俸禄 + 历练收获、年度衰老 +1 岁", () => {
    let state = newGame();
    const results: SettlementResult[] = [];
    for (let month = 0; month < 12; month++) {
      // 经济：月入 = 外门供奉（外门恒按等级上限满员 × 人均 2），俸禄 = 名册 ×10；历练另计。
      const innerCount = state.disciples.length;
      const settled = settleMonthly(state);
      state = settled.state;
      results.push(settled.result);
      const expected = settled.result.crisis
        ? 0
        : sectLimitsFor(state.sectRank).outerLimit * OUTER_INCOME_PER_DISCIPLE -
          innerCount * 10 +
          (settled.result.expedition?.spiritStonesDelta ?? 0);
      assert.equal(settled.result.spiritStonesDelta, expected, `month ${month + 1}`);
    }
    assert.equal(state.currentTurn, 13);
    assert.equal(
      state.spiritStones,
      2000 + results.reduce((sum, result) => sum + result.spiritStonesDelta, 0),
    );
    // 第 12 月年度衰老：开局名册全体 +1 岁（来投新弟子 16 岁入门，未逢年度节点不在其列）。
    const initialIds = new Set(newGame().disciples.map((disciple) => disciple.id));
    assert.equal(
      state.disciples
        .filter((disciple) => initialIds.has(disciple.id))
        .every((disciple) => disciple.age >= 17),
      true,
    );
    assert.equal(
      state.disciples.some((disciple) => disciple.age === 19),
      true,
    );
  });

  it("基线士气：无事月 +1、上限 100（seed slice-seed-1 第 2 月为危险-安全事件，无奖惩）", () => {
    const { state: after } = settleMonthly(newGame());
    assert.equal(after.morale, 70 + 1);
    const prepared = { ...structuredClone(newGame()), morale: 100 };
    const { state: capped } = settleMonthly(prepared);
    assert.equal(capped.morale, 100);
  });

  it("每月自动历练：遭遇事件落 result.expedition（危险-安全月无灵石入账）", () => {
    const state = newGame();
    const { state: after, result } = settleMonthly(state);
    assert.equal(result.expedition?.event, "danger");
    assert.equal(result.moraleDelta, 1);
    assert.equal(result.prestigeDelta, 0);
    // 灵脉产出 200，俸禄 30 → +170（危险-安全月历练无灵石入账）。
    assert.equal(after.spiritStones, 2000 + 170 + 0);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("历练")));
  });

  it("资源危机：当月停摆（无历练）、收支勾销、士气 −3", () => {
    const state = structuredClone(newGame());
    // 灵脉产出 200；把名册膨胀到 53 人（俸禄 530 > 产出 200）且灵石归零 → 危机。
    state.spiritStones = 0;
    const template = state.disciples[0];
    assert.ok(template);
    for (let i = 0; i < 50; i++) {
      state.disciples.push({ ...template, id: `extra-${i}` });
    }
    const { state: after, result } = settleMonthly(state);
    assert.equal(result.crisis, true);
    assert.equal(result.expedition, undefined);
    assert.equal(after.spiritStones, 0);
    assert.equal(after.morale, 70 - 3);
    assert.ok(after.chronicle.some((entry) => entry.kind === "warning"));
  });

  it("真元公式：基础 (10 + 悟性×0.1) × 灵根倍率 × 增幅", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    const flat = talentsAttributeFlat(disciple.talentIds);
    const comprehension = Math.min(
      100,
      Math.max(1, disciple.attributes.comprehension + flat.comprehension),
    );
    const expected = Math.round(
      (ZHENYUAN_BASE + comprehension * ZHENYUAN_COMPREHENSION_COEFF) *
        ROOT_MULTIPLIERS[disciple.rootType] *
        1.1,
    );
    assert.equal(monthlyZhenyuanGain(state, disciple), expected);
  });

  it("高失败积累保证突破必成：升段、真元清零、积累清零", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    assert.equal(currentSuccessRate(disciple, realmStageForLevel(1).baseSuccessRate), 100);
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    const upgraded = discipleOf(after, "d-1");
    assert.equal(upgraded.realmLevel, 2);
    assert.equal(upgraded.zhenyuan, 0);
    assert.equal(upgraded.breakthroughFailures, 0);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("突破至练气中期")));
  });

  it("突破顿悟：突破成功 20% 概率直接领悟一门未修法术（不经藏经阁）", () => {
    // 扫描 seed：锁定一个顿悟掷骰命中（< EPIPHANY_CHANCE_PCT）的确定性样本。
    let found: string | undefined;
    for (let i = 0; i < 50 && !found; i++) {
      const seed = `epiphany-${i}`;
      if (deterministicRoll(`${seed}:epiphany:d-1:2`) < EPIPHANY_CHANCE_PCT) found = seed;
    }
    assert.ok(found, "test_setup_epiphany_seed_not_found");
    const state = newGame(found);
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.breakthroughFailures = 20; // 成功率封顶 100，保证突破成功
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    assert.ok(event.epiphanySpellId, "epiphany should trigger for the scanned seed");
    assert.equal(
      event.epiphanySpellName,
      SPELLS.find((spell) => spell.id === event.epiphanySpellId)?.name,
    );
    const upgraded = discipleOf(after, "d-1");
    assert.deepEqual(upgraded.spellIds, [event.epiphanySpellId]);
    assert.ok(
      after.chronicle.some((entry) =>
        entry.text.includes(`顿悟法术《${event.epiphanySpellName}》`),
      ),
    );
  });

  it("突破顿悟未命中：突破成功但不新增法术", () => {
    let missed: string | undefined;
    for (let i = 0; i < 50 && !missed; i++) {
      const seed = `no-epiphany-${i}`;
      if (deterministicRoll(`${seed}:epiphany:d-1:2`) >= EPIPHANY_CHANCE_PCT) missed = seed;
    }
    assert.ok(missed, "test_setup_no_epiphany_seed_not_found");
    const state = newGame(missed);
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    assert.equal(event.epiphanySpellId, undefined);
    assert.equal(discipleOf(after, "d-1").spellIds, undefined);
  });

  it("突破顿悟已修满 2 门：命中概率也不再新增", () => {
    let found: string | undefined;
    for (let i = 0; i < 50 && !found; i++) {
      const seed = `epiphany-full-${i}`;
      if (deterministicRoll(`${seed}:epiphany:d-1:2`) < EPIPHANY_CHANCE_PCT) found = seed;
    }
    assert.ok(found, "test_setup_epiphany_full_seed_not_found");
    const state = newGame(found);
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    const knownIds = SPELLS.slice(0, 2).map((spell) => spell.id);
    disciple.spellIds = [...knownIds];
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    assert.equal(event.epiphanySpellId, undefined);
    assert.deepEqual(discipleOf(after, "d-1").spellIds, knownIds);
  });

  it("突破失败：真元清零、失败积累 +1、成功率提升", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.talentIds = [];
    disciple.attributes.comprehension = 50;
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    const upgraded = discipleOf(after, "d-1");
    assert.equal(upgraded.zhenyuan, 0);
    if (event.outcome === "failure") {
      assert.equal(event.successRate, 50);
      assert.equal(upgraded.breakthroughFailures, 1);
      assert.equal(currentSuccessRate(upgraded, realmStageForLevel(1).baseSuccessRate), 55);
    } else {
      assert.equal(upgraded.realmLevel, 2);
    }
  });

  it("元婴前期圆满止步：不再积累真元、不再突破，月结照常推进", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.realmLevel = 10;
    disciple.realm = realmStageForLevel(10).realm;
    disciple.zhenyuan = 999_999;
    const { state: after, result } = settleMonthly(state);
    assert.equal(after.ending, undefined);
    assert.ok(!result.breakthroughs.some((entry) => entry.discipleId === "d-1"));
    assert.equal(discipleOf(after, "d-1").zhenyuan, 999_999);
    assert.equal(settleMonthly(after).state.ending, undefined);
  });

  it("年度坐化：逝者入名录、士气扣减、新弟子递补席位", () => {
    const prepared = newGame();
    // 内门 d-1 将在第 12 月坐化（19 + 1 ≥ 有效坐化年龄 20）。
    discipleOf(prepared, "d-1").maxLifespan = 20;
    discipleOf(prepared, "d-1").age = 19;
    const { state: after, results } = runMonths(prepared, 12);
    const month12 = results.find((result) => result.turn === 12);
    assert.ok(month12);
    assert.equal(month12.deaths.length, 1);
    assert.equal(after.fallen.length, 1);
    // 士气随结果落账：终值 = 初始 + Σ(月士气增量)，且不越界。
    const expectedMorale = Math.min(
      100,
      Math.max(0, 70 + results.reduce((sum, result) => sum + result.moraleDelta, 0)),
    );
    assert.equal(after.morale, expectedMorale);
    // 坐化 1 人 → 递补 1 人（新弟子入册），名册回到 3 人。
    assert.equal(after.disciples.length, 3);
    assert.equal(month12.promotions.length, 1);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("坐化仙逝")));
    assert.ok(after.chronicle.some((entry) => entry.text.includes("补入内门")));
  });

  it("24 月长跑确定性：同 seed 两局 deepEqual", () => {
    const a = runMonths(newGame("long-run"), 24).state;
    const b = runMonths(newGame("long-run"), 24).state;
    assert.deepEqual(a, b);
  });
});

describe("管理命令", () => {
  it("招募候选确定、直入名册并扣灵石", () => {
    const state = newGame();
    const candidates = listRecruitCandidates(state);
    assert.equal(candidates.length, 3);
    assert.deepEqual(candidates, listRecruitCandidates(state));
    const first = candidates[0];
    assert.ok(first);
    const { state: after, disciple } = recruitDisciple(state, first.candidateId);
    assert.equal(after.spiritStones, 2000 - 300);
    assert.equal(after.disciples.length, 4);
    assert.ok(after.disciples.some((entry) => entry.id === disciple.id));
    assert.equal(disciple.age, 16);
  });

  it("招募录入所选候选本人（3 选 1 的选择生效，预览即录入档案）", () => {
    const state = newGame();
    const candidates = listRecruitCandidates(state);
    const second = candidates[1];
    assert.ok(second);
    const { disciple } = recruitDisciple(state, second.candidateId);
    assert.match(disciple.id, /^d-\d+$/);
    assert.equal(disciple.name, second.disciple.name);
    assert.equal(disciple.gender, second.disciple.gender);
    assert.equal(disciple.maxLifespan, second.disciple.maxLifespan);
    assert.equal(disciple.rootType, second.disciple.rootType);
    assert.deepEqual(disciple.rootElements, second.disciple.rootElements);
    assert.deepEqual(disciple.attributes, second.disciple.attributes);
    assert.deepEqual(disciple.talentIds, second.disciple.talentIds);
    // 选不同候选得到不同档案（选择真实影响结果）
    const third = candidates[2];
    assert.ok(third);
    const { disciple: other } = recruitDisciple(state, third.candidateId);
    assert.notDeepEqual(
      { a: disciple.attributes, r: disciple.rootElements, t: disciple.talentIds },
      { a: other.attributes, r: other.rootElements, t: other.talentIds },
    );
  });

  it("灵石不足招募被拒", () => {
    const state = { ...structuredClone(newGame()), spiritStones: 100 };
    const first = listRecruitCandidates(state)[0];
    assert.ok(first);
    assert.throws(() => recruitDisciple(state, first.candidateId), /insufficient_resource/);
  });

  it("招募受内门上限约束（补满至 10 人后拒绝再招募）", () => {
    let state = { ...structuredClone(newGame()), spiritStones: 100_000 };
    while (state.disciples.length < 10) {
      const first = listRecruitCandidates(state)[0];
      assert.ok(first);
      state = recruitDisciple(state, first.candidateId).state;
    }
    assert.equal(state.disciples.length, 10);
    const overflow = listRecruitCandidates(state)[0];
    assert.ok(overflow);
    assert.throws(() => recruitDisciple(state, overflow.candidateId), /inner_limit_reached/);
  });

  it("升阶：境界与灵石条件", () => {
    let state = newGame();
    // 灵石不足
    assert.throws(() => upgradeSect(state), /insufficient_resource/);
    // 无筑基弟子
    state = { ...structuredClone(state), spiritStones: 10000 };
    assert.throws(() => upgradeSect(state), /sect_upgrade_realm_not_met/);
    // 满足 1→2
    discipleOf(state, "d-1").realmLevel = 4;
    discipleOf(state, "d-1").realm = realmStageForLevel(4).realm;
    const { state: rank2 } = upgradeSect(state);
    assert.equal(rank2.sectRank, 2);
    assert.equal(rank2.spiritStones, 5000);
    // 2→3 需金丹弟子 ≥3（先补足灵石，避免触发资源检查）
    const rank2Prepared = structuredClone(rank2);
    rank2Prepared.spiritStones = 40000;
    assert.throws(() => upgradeSect(rank2Prepared), /sect_upgrade_golden_core_not_met/);
    for (const id of ["d-1", "d-2", "d-3"]) {
      discipleOf(rank2Prepared, id).realmLevel = 7;
      discipleOf(rank2Prepared, id).realm = realmStageForLevel(7).realm;
    }
    const { state: rank3 } = upgradeSect(rank2Prepared);
    assert.equal(rank3.sectRank, 3);
    assert.throws(() => upgradeSect(rank3), /sect_rank_maxed/);
  });

  it("修炼视图派生与状态只读", () => {
    const state = newGame();
    const view = discipleCultivationView(state, discipleOf(state, "d-1"));
    assert.equal(view.stageName, "练气前期");
    assert.equal(view.requiredZhenyuan, 1_000);
    assert.ok(view.monthlyGain > 0);
    assert.ok(view.successRate > 0 && view.successRate <= 100);
  });
});

describe("M2 管理命令：研读功法法术 / 穿戴装备 / 服用丹药 / 任命长老（E02-F03）", () => {
  function gameWithLibrary(seed = "cmd-seed-1"): GameState {
    const state = newGame(seed);
    state.library = {
      techniqueIds: ["tech-hunyuan", "tech-yangqi"],
      spellIds: ["spell-jinfeng", "spell-hanbing", "spell-yanbao"],
    };
    return state;
  }

  it("研读功法/法术：藏经阁拥有方可研读，功法限 1 门、法术限 2 门，纪事 normal", () => {
    let state = gameWithLibrary();
    const learned = learnArt(state, "d-1", "tech-hunyuan");
    state = learned.state;
    assert.equal(learned.disciple.techniqueId, "tech-hunyuan");
    assert.ok(state.chronicle[0]?.kind === "normal");
    assert.ok(state.chronicle[0]?.text.includes("研读功法"));
    // 功法限 1 门。
    assert.throws(() => learnArt(state, "d-1", "tech-yangqi"), /technique_limit_reached/);
    // 法术限 2 门、不可重复。
    state = learnArt(state, "d-1", "spell-jinfeng").state;
    state = learnArt(state, "d-1", "spell-hanbing").state;
    assert.throws(() => learnArt(state, "d-1", "spell-yanbao"), /spell_limit_reached/);
    assert.throws(() => learnArt(state, "d-1", "spell-jinfeng"), /spell_already_learned/);
    // 藏经阁未拥有被拒。
    assert.throws(() => learnArt(state, "d-2", "tech-jinzhong"), /art_not_in_library/);
    assert.throws(() => learnArt(state, "d-2", "art-none"), /art_not_found/);
  });

  it("功法月结生效：混元功真元 +15%、五维 +2 计入月度真元", () => {
    const state = gameWithLibrary();
    state.morale = 50; // 中段士气：避开 ±10% 阈值干扰，专注功法增益。
    const disciple = discipleOf(state, "d-1");
    const before = monthlyZhenyuanGain(state, disciple);
    const { state: after } = learnArt(state, "d-1", "tech-hunyuan");
    const learned = discipleOf(after, "d-1");
    // 设计公式：base = ZHENYUAN_BASE + 有效悟性×COEFF；rate = 1 + 天赋% + 功法 0.15（士气中段无加成）。
    const effective = buildCombatProfile(learned).breakdown.attributes.effective;
    const expected = Math.round(
      (ZHENYUAN_BASE + effective.comprehension * ZHENYUAN_COMPREHENSION_COEFF) *
        ROOT_MULTIPLIERS[learned.rootType] *
        (1 + talentsZhenyuanPct(learned.talentIds) + 0.15),
    );
    assert.equal(monthlyZhenyuanGain(after, learned), expected);
    assert.ok(monthlyZhenyuanGain(after, learned) > before);
  });

  it("服用聚灵丹：12 月内真元 ×1.5、不叠加只刷新；延寿丹最大寿命 +10", () => {
    const state = newGame();
    state.warehouse = {
      gear: [],
      pills: [
        { pillId: "pill-juling", count: 3 },
        { pillId: "pill-yanshou", count: 1 },
      ],
    };
    const base = monthlyZhenyuanGain(state, discipleOf(state, "d-1"));
    let { state: after } = usePill(state, "d-1", "pill-juling");
    assert.equal(discipleOf(after, "d-1").spiritFocusUntilTurn, 1 + 12);
    assert.equal(monthlyZhenyuanGain(after, discipleOf(after, "d-1")), Math.round(base * 1.5));
    assert.deepEqual(after.warehouse?.pills, [
      { pillId: "pill-juling", count: 2 },
      { pillId: "pill-yanshou", count: 1 },
    ]);
    // 推进一月后重复服用：刷新时长（turn 2 + 12 = 14），不叠加为 ×2.25。
    after = settleMonthly(after).state;
    after = usePill(after, "d-1", "pill-juling").state;
    assert.equal(discipleOf(after, "d-1").spiritFocusUntilTurn, 2 + 12);
    // 仓库耗尽后拒绝。
    after = usePill(after, "d-1", "pill-juling").state;
    assert.throws(() => usePill(after, "d-1", "pill-juling"), /pill_not_in_warehouse/);
    // 延寿丹直接 +10 年（写入 maxLifespan）。
    const lifespanBefore = discipleOf(after, "d-2").maxLifespan;
    after = usePill(after, "d-2", "pill-yanshou").state;
    assert.equal(discipleOf(after, "d-2").maxLifespan, lifespanBefore + 10);
  });

  it("聚灵丹增益到期自动失效", () => {
    const state = newGame();
    const base = monthlyZhenyuanGain(state, discipleOf(state, "d-1"));
    const prepared = structuredClone(state);
    discipleOf(prepared, "d-1").spiritFocusUntilTurn = 2;
    // 第 2 月仍在增益期内（untilTurn >= 当前回目）。
    assert.equal(
      monthlyZhenyuanGain(prepared, discipleOf(prepared, "d-1")),
      Math.round(base * 1.5),
    );
    const { state: after } = settleMonthly(prepared);
    assert.equal(after.currentTurn, 2);
    assert.equal(monthlyZhenyuanGain(after, discipleOf(after, "d-1")), Math.round(base * 1.5));
    const { state: after2 } = settleMonthly(after);
    assert.equal(after2.currentTurn, 3);
    assert.equal(monthlyZhenyuanGain(after2, discipleOf(after2, "d-1")), base);
  });

  it("穿戴法宝：仓库取出、旧法宝卸下回仓、派生法威 +档位加成", () => {
    const state = newGame();
    state.warehouse = {
      gear: [
        { slot: "talisman", tier: 1 },
        { slot: "talisman", tier: 2 },
      ],
      pills: [],
    };
    const baseMagic = buildCombatProfile(discipleOf(state, "d-1")).magicPower;
    const { state: after1 } = wearGear(state, "d-1", "talisman", 1);
    assert.deepEqual(discipleOf(after1, "d-1").equippedGear, { talisman: 1 });
    assert.deepEqual(after1.warehouse?.gear, [{ slot: "talisman", tier: 2 }]);
    assert.equal(buildCombatProfile(discipleOf(after1, "d-1")).magicPower, baseMagic + 8);
    // 替换：档 2 上身、档 1 回仓。
    const { state: after2 } = wearGear(after1, "d-1", "talisman", 2);
    assert.deepEqual(discipleOf(after2, "d-1").equippedGear, { talisman: 2 });
    assert.deepEqual(after2.warehouse?.gear, [{ slot: "talisman", tier: 1 }]);
    assert.equal(buildCombatProfile(discipleOf(after2, "d-1")).magicPower, baseMagic + 14);
    // 仓库无此装备被拒。
    assert.throws(() => wearGear(after2, "d-1", "talisman", 4), /gear_not_in_warehouse/);
  });

  it("资源长老：灵脉产出 +20% 月结生效（200 → 240）；长老不修炼", () => {
    let state = newGame();
    state = appointElder(state, "d-1", "resource").state;
    assert.equal(state.elders?.resource, "d-1");
    const { state: after } = settleMonthly(state);
    // 产出 round(200×1.2) = 240，俸禄 30 → +210（危险-安全月历练无灵石入账）。
    assert.equal(after.spiritStones, 2000 + 240 - 30);
    // 长老不修炼：真元零增长。
    assert.equal(discipleOf(after, "d-1").zhenyuan, 0);
    assert.ok(discipleOf(after, "d-2").zhenyuan > 0);
  });

  it("长老唯一性：同职替换旧长老卸任，兼差被拒", () => {
    let state = newGame();
    state = appointElder(state, "d-1", "resource").state;
    const replaced = appointElder(state, "d-2", "resource");
    assert.equal(replaced.state.elders?.resource, "d-2");
    assert.equal(replaced.replacedDiscipleId, "d-1");
    // 同一弟子不可兼任两职。
    assert.throws(() => appointElder(replaced.state, "d-2", "war"), /disciple_job_busy/);
    // 在岗丹师不可任长老。
    state = assignWorkshopJob(replaced.state, "pill", "d-3").state;
    assert.throws(() => appointElder(state, "d-3", "war"), /disciple_job_busy/);
  });

  it("战备长老：全门突破率 +3 月结生效（边界 seed 扫描锁定）", () => {
    // 扫描确定性 seed：使 roll 落在 [rate0, rate0+3) —— 无长老失败、有长老成功。
    let found: { seed: string; failures: number; techniqueId?: string; rate0: number } | undefined;
    for (let i = 0; i < 2000 && !found; i++) {
      const seed = `war-elder-${i}`;
      const roll = deterministicRoll(`${seed}:breakthrough:d-2:2`);
      for (let failures = 0; failures <= 7; failures++) {
        for (const techniqueId of [undefined, "tech-yangqi"] as const) {
          const rate0 = Math.min(100, 20 + failures * 5 + (techniqueId ? 3 : 0));
          if (rate0 + 3 > 100) continue;
          if (roll >= rate0 && roll < rate0 + 3) {
            found = { seed, failures, techniqueId, rate0 };
            break;
          }
        }
        if (found) break;
      }
    }
    assert.ok(found, "test_setup_breakthrough_seed_not_found");
    const setup = (seed: string, withElder: boolean): GameState => {
      const state = newGame(seed);
      const disciple = discipleOf(state, "d-2");
      disciple.realmLevel = 6;
      disciple.realm = realmStageForLevel(6).realm;
      disciple.zhenyuan = realmStageForLevel(6).requiredZhenyuan;
      disciple.breakthroughFailures = found?.failures ?? 0;
      if (found?.techniqueId) disciple.techniqueId = found.techniqueId;
      if (withElder) return appointElder(state, "d-1", "war").state;
      return state;
    };
    const withoutElder = settleMonthly(setup(found.seed, false));
    const failureEvent = withoutElder.result.breakthroughs.find(
      (entry) => entry.discipleId === "d-2",
    );
    assert.ok(failureEvent);
    assert.equal(failureEvent.outcome, "failure");
    assert.equal(failureEvent.successRate, found.rate0);
    const withElder = settleMonthly(setup(found.seed, true));
    const successEvent = withElder.result.breakthroughs.find((entry) => entry.discipleId === "d-2");
    assert.ok(successEvent);
    assert.equal(successEvent.outcome, "success");
    assert.equal(successEvent.successRate, found.rate0 + 3);
    assert.equal(discipleOf(withElder.state, "d-2").realmLevel, 7);
  });
});

describe("战报存档预算（快照 <128KB 约束，设计 D-022）", () => {
  const bigReport = (index: number): BattleReport => ({
    seed: `report-${index}`,
    winner: "A",
    rounds: 30,
    fighters: { A: "甲", B: "乙" },
    actions: Array.from({ length: 30 }, (_, turn) => ({
      round: turn + 1,
      actor: turn % 2 === 0 ? "A" : "B",
      kind: "basic",
      hit: true,
      crit: false,
      damage: 40,
      hpLoss: 40,
      shieldAbsorbed: 0,
      lifestealHeal: 0,
      reflectDamage: 0,
      hp: { A: 300, B: 300 },
      statusNotes: [],
    })),
    totalDamage: { A: 600, B: 600 },
    injuries: { A: "none", B: "none" },
    finalHp: { A: 60, B: 60 },
    injuryMonths: { none: 0, light: 1, heavy: 3 },
  });

  it("条数上限 + 字节预算：超限自旧向新丢弃，至少保留最新 1 条", () => {
    const state = newGame();
    for (let i = 0; i < BATTLE_LOG_LIMIT + 10; i++) {
      prependBattleReports(state, [bigReport(i)]);
    }
    assert.ok(state.battles);
    assert.ok(state.battles.length <= BATTLE_LOG_LIMIT);
    const bytes = JSON.stringify(state.battles).length;
    assert.ok(
      bytes <= BATTLE_LOG_BYTE_BUDGET,
      `battles ${bytes}B 应 ≤ 预算 ${BATTLE_LOG_BYTE_BUDGET}B`,
    );
    assert.equal(state.battles[0]?.seed, `report-${BATTLE_LOG_LIMIT + 9}`);
    assert.ok(state.battles.length < BATTLE_LOG_LIMIT + 10);
  });

  it("确定性：同输入双跑 deepEqual", () => {
    const first = newGame();
    const second = newGame();
    for (let i = 0; i < 12; i++) {
      prependBattleReports(first, [bigReport(i)]);
      prependBattleReports(second, [bigReport(i)]);
    }
    assert.deepEqual(first.battles, second.battles);
  });
});
