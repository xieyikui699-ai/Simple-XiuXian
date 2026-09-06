// M1 月结闭环切片测试：开局 → 月结 → 突破 → 衰老坐化 → 管理命令 → 结局。
// M2 追加：研读功法法术 / 穿戴装备 / 服用丹药 / 任命长老（E02-F03）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCombatProfile } from "./combat-profile.js";
import {
  appointElder,
  createGame,
  discipleCultivationView,
  learnArt,
  listRecruitCandidates,
  promoteToInner,
  recruitDisciple,
  upgradeSect,
  usePill,
  wearGear,
} from "./engine.js";
import { deterministicRoll } from "./hash.js";
import { assignWorkshopJob } from "./production.js";
import { realmStageForLevel } from "./realms.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import { currentSuccessRate, monthlyZhenyuanGain, settleMonthly } from "./settlement.js";
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

  it("外出历练触发遭遇事件：声望 +1、士气 −2（收获 50% 月份得灵石，D-014 六事件表取代 M1 固定拾取）", () => {
    const state = newGame();
    const { state: after, result } = settleMonthly(state, "explore");
    assert.equal(result.prestigeDelta, 1);
    assert.equal(result.moraleDelta, -2);
    // seed slice-seed-1 第 2 月为「危险-安全」事件：无灵石入账（六事件 golden 见 expedition.test.ts）。
    assert.equal(result.expedition?.event, "danger");
    assert.equal(after.spiritStones, 2000 + 10 - 15 + 0);
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
    // 外门不可研读。
    const outer = state.disciples.find((entry) => entry.role === "outer");
    assert.ok(outer);
    assert.throws(() => learnArt(state, outer.id, "tech-hunyuan"), /disciple_not_inner/);
  });

  it("功法月结生效：混元功真元 +15%、五维 +2 计入月度真元", () => {
    const state = gameWithLibrary();
    state.morale = 50; // 中段士气：避开 ±10% 阈值干扰，专注功法增益。
    const disciple = discipleOf(state, "d-1");
    const before = monthlyZhenyuanGain(state, disciple);
    const { state: after } = learnArt(state, "d-1", "tech-hunyuan");
    const learned = discipleOf(after, "d-1");
    // 设计公式：base = 10 + 有效悟性×0.1；rate = 1 + 天赋% + 功法 0.15（士气中段无加成）。
    const effective = buildCombatProfile(learned).breakdown.attributes.effective;
    const expected = Math.round(
      (10 + effective.comprehension * 0.1) *
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
    after = settleMonthly(after, "rest").state;
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
    const { state: after } = settleMonthly(prepared, "rest");
    assert.equal(after.currentTurn, 2);
    assert.equal(monthlyZhenyuanGain(after, discipleOf(after, "d-1")), Math.round(base * 1.5));
    const { state: after2 } = settleMonthly(after, "rest");
    assert.equal(after2.currentTurn, 3);
    assert.equal(monthlyZhenyuanGain(after2, discipleOf(after2, "d-1")), base);
  });

  it("穿戴装备：仓库取出、旧装备卸下回仓、派生物攻 +档位加成", () => {
    const state = newGame();
    state.warehouse = {
      gear: [
        { slot: "weapon", tier: 1 },
        { slot: "weapon", tier: 2 },
      ],
      pills: [],
    };
    const baseAttack = buildCombatProfile(discipleOf(state, "d-1")).physicalAttack;
    const { state: after1 } = wearGear(state, "d-1", "weapon", 1);
    assert.deepEqual(discipleOf(after1, "d-1").equippedGear, { weapon: 1 });
    assert.deepEqual(after1.warehouse?.gear, [{ slot: "weapon", tier: 2 }]);
    assert.equal(buildCombatProfile(discipleOf(after1, "d-1")).physicalAttack, baseAttack + 10);
    // 替换：档 2 上身、档 1 回仓。
    const { state: after2 } = wearGear(after1, "d-1", "weapon", 2);
    assert.deepEqual(discipleOf(after2, "d-1").equippedGear, { weapon: 2 });
    assert.deepEqual(after2.warehouse?.gear, [{ slot: "weapon", tier: 1 }]);
    assert.equal(buildCombatProfile(discipleOf(after2, "d-1")).physicalAttack, baseAttack + 25);
    // 仓库无此装备被拒。
    assert.throws(() => wearGear(after2, "d-1", "armor", 4), /gear_not_in_warehouse/);
  });

  it("资源长老：外门供奉 +20% 月结生效（20 外门月供奉 40 → 48）；长老不修炼", () => {
    let state = newGame();
    state = appointElder(state, "d-1", "resource").state;
    assert.equal(state.elders?.resource, "d-1");
    const { state: after } = settleMonthly(state, "rest");
    // 供奉 round(20×2×1.2) = 48，俸禄 30 → +18；休养士气 +5。
    assert.equal(after.spiritStones, 2000 + 48 - 30);
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
    const withoutElder = settleMonthly(setup(found.seed, false), "rest");
    const failureEvent = withoutElder.result.breakthroughs.find(
      (entry) => entry.discipleId === "d-2",
    );
    assert.ok(failureEvent);
    assert.equal(failureEvent.outcome, "failure");
    assert.equal(failureEvent.successRate, found.rate0);
    const withElder = settleMonthly(setup(found.seed, true), "rest");
    const successEvent = withElder.result.breakthroughs.find((entry) => entry.discipleId === "d-2");
    assert.ok(successEvent);
    assert.equal(successEvent.outcome, "success");
    assert.equal(successEvent.successRate, found.rate0 + 3);
    assert.equal(discipleOf(withElder.state, "d-2").realmLevel, 7);
  });
});
