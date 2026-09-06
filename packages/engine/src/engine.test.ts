// M1 月结闭环切片测试：开局 → 月结 → 突破 → 衰老坐化 → 管理命令 → 结局。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGame,
  discipleCultivationView,
  listRecruitCandidates,
  promoteToInner,
  recruitDisciple,
  upgradeSect,
} from "./engine.js";
import { realmStageForLevel } from "./realms.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import { currentSuccessRate, monthlyZhenyuanGain, settleMonthly } from "./settlement.js";
import type { GameState, SettlementResult } from "./state.js";
import { talentsAttributeFlat } from "./talents.js";

function newGame(seed = "slice-seed-1"): GameState {
  return createGame({ seed, sectName: "青云门" });
}

function discipleOf(state: GameState, id: string) {
  const disciple = state.disciples.find((entry) => entry.id === id);
  if (!disciple) throw new Error(`test_setup_disciple_missing:${id}`);
  return disciple;
}

function runMonths(state: GameState, months: number, policy: Parameters<typeof settleMonthly>[1]) {
  let current = state;
  const results: SettlementResult[] = [];
  for (let i = 0; i < months; i++) {
    const outcome = settleMonthly(current, policy);
    current = outcome.state;
    results.push(outcome.result);
  }
  return { state: current, results };
}

describe("开局", () => {
  it("初始状态：1 级宗门、3 内门 + 20 外门、灵石 2000、士气 70", () => {
    const state = newGame();
    assert.equal(state.sectRank, 1);
    assert.equal(state.currentTurn, 1);
    assert.equal(state.spiritStones, 2000);
    assert.equal(state.morale, 70);
    assert.equal(state.disciples.filter((disciple) => disciple.role === "inner").length, 3);
    assert.equal(state.disciples.filter((disciple) => disciple.role === "outer").length, 20);
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
  it("12 月休养生息：回合 13、灵石 +120、年度衰老 +1 岁", () => {
    const { state, results } = runMonths(newGame(), 12, "rest");
    assert.equal(state.currentTurn, 13);
    // 每月：外门供奉 40 − 内门俸禄 30 = +10
    assert.equal(state.spiritStones, 2000 + 120);
    assert.equal(
      results.every((result) => result.policy === "rest"),
      true,
    );
    // 第 12 月年度衰老：全体 +1 岁
    assert.equal(
      state.disciples.every((disciple) => disciple.age >= 17),
      true,
    );
    assert.equal(
      state.disciples.some((disciple) => disciple.age === 19),
      true,
    );
  });

  it("士气上限 100、休养每月 +5", () => {
    const { state } = runMonths(newGame(), 8, "rest");
    assert.equal(state.morale, 100);
  });

  it("闭关修炼消耗灵石且真元增幅", () => {
    const state = newGame();
    const before = state.spiritStones;
    const { state: after } = settleMonthly(state, "cultivate");
    assert.equal(after.spiritStones, before + 10 - 15);
    const first = discipleOf(after, "d-1");
    const gain = monthlyZhenyuanGain(after, first);
    const plain = monthlyZhenyuanGain({ ...after, policy: "rest" }, first);
    assert.ok(gain > plain, `cultivate gain ${gain} 应高于普通 ${plain}`);
  });

  it("外出历练获得灵石、声望 +1、士气 −2", () => {
    const state = newGame();
    const { state: after, result } = settleMonthly(state, "explore");
    assert.equal(result.prestigeDelta, 1);
    assert.equal(result.moraleDelta, -2);
    assert.ok(after.spiritStones >= 2000 + 10 - 15 + 50 - 1);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("历练")));
  });

  it("资源危机：方针不执行、成本勾销、士气 −3", () => {
    const state = { ...structuredClone(newGame()), spiritStones: 0 };
    const { state: after, result } = settleMonthly(state, "cultivate");
    assert.equal(result.crisis, true);
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
      (10 + comprehension * 0.1) * ROOT_MULTIPLIERS[disciple.rootType] * 1.1,
    );
    assert.equal(monthlyZhenyuanGain(state, disciple), expected);
  });

  it("高失败积累保证突破必成：升段、真元清零、积累清零", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    assert.equal(currentSuccessRate(disciple, realmStageForLevel(1).baseSuccessRate), 100);
    const { state: after, result } = settleMonthly(state, "rest");
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    const upgraded = discipleOf(after, "d-1");
    assert.equal(upgraded.realmLevel, 2);
    assert.equal(upgraded.zhenyuan, 0);
    assert.equal(upgraded.breakthroughFailures, 0);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("突破至练气中期")));
  });

  it("突破失败：真元清零、失败积累 +1、成功率提升", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.zhenyuan = realmStageForLevel(1).requiredZhenyuan;
    disciple.talentIds = [];
    disciple.attributes.comprehension = 50;
    const { state: after, result } = settleMonthly(state, "rest");
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    const upgraded = discipleOf(after, "d-1");
    assert.equal(upgraded.zhenyuan, 0);
    if (event.outcome === "failure") {
      assert.equal(event.successRate, 60);
      assert.equal(upgraded.breakthroughFailures, 1);
      assert.equal(currentSuccessRate(upgraded, realmStageForLevel(1).baseSuccessRate), 65);
    } else {
      assert.equal(upgraded.realmLevel, 2);
    }
  });

  it("元婴前期圆满突破 → 飞升结局，终局后拒绝月结", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.realmLevel = 10;
    disciple.realm = realmStageForLevel(10).realm;
    disciple.zhenyuan = realmStageForLevel(10).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    const { state: after, result } = settleMonthly(state, "rest");
    assert.equal(after.ending?.kind, "ascension");
    assert.ok(result.breakthroughs.some((entry) => entry.outcome === "ascended"));
    assert.throws(() => settleMonthly(after, "rest"), /game_already_ended/);
  });

  it("年度坐化：逝者入名录、士气扣减、外门递补内门", () => {
    const prepared = newGame();
    // 内门 d-1 与外门 d-4 将在第 12 月坐化（19 + 1 ≥ 有效坐化年龄 20）。
    discipleOf(prepared, "d-1").maxLifespan = 20;
    discipleOf(prepared, "d-4").maxLifespan = 20;
    discipleOf(prepared, "d-1").age = 19;
    discipleOf(prepared, "d-4").age = 19;
    const { state: after, results } = runMonths(prepared, 12, "rest");
    const month12 = results.find((result) => result.turn === 12);
    assert.ok(month12);
    assert.equal(month12.deaths.length, 2);
    assert.equal(after.fallen.length, 2);
    // 士气：前 6 月 +5 至 100 封顶；第 12 月 2 人坐化 −10，第 13 月休养 +5。
    assert.equal(after.morale, 95);
    // 内门坐化 1 人 → 最强外门递补，内门回到 3 人。
    assert.equal(after.disciples.filter((disciple) => disciple.role === "inner").length, 3);
    assert.equal(month12.promotions.length, 1);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("坐化仙逝")));
    assert.ok(after.chronicle.some((entry) => entry.text.includes("递补入内门")));
  });

  it("24 月长跑确定性：同 seed 两局 deepEqual", () => {
    const a = runMonths(newGame("long-run"), 24, "cultivate").state;
    const b = runMonths(newGame("long-run"), 24, "cultivate").state;
    assert.deepEqual(a, b);
  });
});

describe("管理命令", () => {
  it("招募候选确定、入册为外门并扣灵石", () => {
    const state = newGame();
    const candidates = listRecruitCandidates(state);
    assert.equal(candidates.length, 3);
    assert.deepEqual(candidates, listRecruitCandidates(state));
    const first = candidates[0];
    assert.ok(first);
    const { state: after, disciple } = recruitDisciple(state, first.candidateId);
    assert.equal(after.spiritStones, 2000 - 300);
    assert.equal(after.disciples.length, 24);
    assert.equal(disciple.role, "outer");
    assert.equal(disciple.age, 16);
  });

  it("灵石不足招募被拒", () => {
    const state = { ...structuredClone(newGame()), spiritStones: 100 };
    const first = listRecruitCandidates(state)[0];
    assert.ok(first);
    assert.throws(() => recruitDisciple(state, first.candidateId), /insufficient_resource/);
  });

  it("提拔内门并受容量约束", () => {
    let state = newGame();
    const outers = state.disciples.filter((disciple) => disciple.role === "outer");
    for (let i = 0; i < 7; i++) {
      const target = outers[i];
      assert.ok(target);
      state = promoteToInner(state, target.id).state;
    }
    assert.equal(state.disciples.filter((disciple) => disciple.role === "inner").length, 10);
    const overflow = outers[7];
    assert.ok(overflow);
    assert.throws(() => promoteToInner(state, overflow.id), /inner_limit_reached/);
    assert.throws(() => promoteToInner(state, "d-1"), /disciple_already_inner/);
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
    assert.equal(view.requiredZhenyuan, 300);
    assert.ok(view.monthlyGain > 0);
    assert.ok(view.successRate > 0 && view.successRate <= 100);
  });
});
