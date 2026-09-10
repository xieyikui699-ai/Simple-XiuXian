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
  removeElder,
  setAutoPill,
  upgradeSect,
  usePill,
  wearGear,
} from "./engine.js";
import { combatReadyDisciples } from "./expedition.js";
import { deterministicRoll } from "./hash.js";
import { assignOuterJobs } from "./outer-jobs.js";
import { assignWorkshopJob } from "./production.js";
import { realmStageForLevel } from "./realms.js";
import { declareWar } from "./rival.js";
import { ROOT_MULTIPLIERS } from "./roots.js";
import { RECRUIT_CANDIDATE_COUNT, RECRUIT_REFRESH_TURNS } from "./sect.js";
import {
  BATTLE_LOG_BYTE_BUDGET,
  BATTLE_LOG_LIMIT,
  EPIPHANY_CHANCE_PCT,
  ZHENYUAN_BASE,
  ZHENYUAN_COMPREHENSION_COEFF,
  currentSuccessRate,
  mineElderBonusPct,
  monthlyZhenyuanGain,
  prependBattleReports,
  settleMonthly,
} from "./settlement.js";
import type { GameState, SettlementResult } from "./state.js";
import { migrateGameState } from "./state.js";
import { talentsAttributeFlat, talentsLifespanFlat, talentsZhenyuanPct } from "./talents.js";

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
  it("12 月推进：回合 13、月结收支 = 挖矿上缴 − 俸禄 + 历练收获、年度衰老 +1 岁", () => {
    let state = newGame();
    const results: SettlementResult[] = [];
    for (let month = 0; month < 12; month++) {
      // 经济：月入 = 挖矿上缴（新局未分岗 = 0），俸禄 = 名册 ×10；历练另计。
      const innerCount = state.disciples.length;
      const settled = settleMonthly(state);
      state = settled.state;
      results.push(settled.result);
      const expected = settled.result.crisis
        ? 0
        : -innerCount * 10 + (settled.result.expedition?.spiritStonesDelta ?? 0);
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
    // 供奉已删除（未分岗无挖矿收入），俸禄 30 → −30（危险-安全月历练无灵石入账）。
    assert.equal(after.spiritStones, 2000 - 30 + 0);
    assert.ok(after.chronicle.some((entry) => entry.text.includes("历练")));
  });

  it("资源危机：当月停摆（无历练）、收支勾销、士气 −3", () => {
    const state = structuredClone(newGame());
    // 无供奉收入（未分岗无挖矿）；把名册膨胀到 53 人（俸禄 530）且灵石归零 → 危机。
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

  it("元婴胜利：门下有元婴期弟子即胜利；圆满弟子不再积累真元、不再突破", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.realmLevel = 10;
    disciple.realm = realmStageForLevel(10).realm;
    disciple.zhenyuan = 999_999;
    const { state: after, result } = settleMonthly(state);
    assert.equal(after.ending?.kind, "nascent_soul");
    assert.ok(after.ending);
    assert.ok(after.ending.text.includes(disciple.name));
    assert.ok(after.ending.rating);
    assert.ok(!result.breakthroughs.some((entry) => entry.discipleId === "d-1"));
    assert.equal(discipleOf(after, "d-1").zhenyuan, 999_999);
    assert.throws(() => settleMonthly(after), /game_already_ended/);
  });

  it("元婴胜利：弟子当月真实突破至元婴前期即落胜利结局", () => {
    const state = newGame();
    const disciple = discipleOf(state, "d-1");
    disciple.realmLevel = 9;
    disciple.realm = realmStageForLevel(9).realm;
    disciple.zhenyuan = 500_000;
    disciple.techniqueId = "tech-yangqi"; // 功法突破 +3
    disciple.breakthroughFailures = 18; // 连败加成 18×5 → 成功率封顶 100，必成
    const { state: after, result } = settleMonthly(state);
    const event = result.breakthroughs.find((entry) => entry.discipleId === "d-1");
    assert.ok(event);
    assert.equal(event.outcome, "success");
    assert.equal(event.toRealmLevel, 10);
    assert.equal(after.ending?.kind, "nascent_soul");
    assert.ok(after.ending?.text.includes(disciple.name));
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
    assert.equal(candidates.length, RECRUIT_CANDIDATE_COUNT);
    assert.deepEqual(candidates, listRecruitCandidates(state));
    const first = candidates[0];
    assert.ok(first);
    const { state: after, disciple } = recruitDisciple(state, first.candidateId);
    assert.equal(after.spiritStones, 2000 - 300);
    assert.equal(after.disciples.length, 4);
    assert.ok(after.disciples.some((entry) => entry.id === disciple.id));
    assert.equal(disciple.age, 16);
  });

  it("招募录入所选候选本人（候选 5 选 1 的选择生效，预览即录入档案）", () => {
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

  it("招募一人后本批候选只少一人，其余原样保留（不重掷）", () => {
    const state = newGame();
    const before = listRecruitCandidates(state);
    const first = before[0];
    assert.ok(first);
    const { state: after, disciple } = recruitDisciple(state, first.candidateId);
    assert.equal(disciple.fromCandidate, first.candidateId);
    // 其余候选连人带档案原样保留（预览即档案，跨招募不变）
    assert.deepEqual(listRecruitCandidates(after), before.slice(1));
    // 已招候选在本窗口内不得再次出现/再次招募
    assert.throws(() => recruitDisciple(after, first.candidateId), /candidate_not_found/);
  });

  it("每 120 个月（10 年）整批刷新新候选", () => {
    const state = newGame();
    const before = listRecruitCandidates(state);
    const { state: advanced } = runMonths(state, RECRUIT_REFRESH_TURNS);
    const next = listRecruitCandidates(advanced);
    assert.equal(next.length, RECRUIT_CANDIDATE_COUNT);
    const beforeNames = new Set(before.map((entry) => entry.disciple.name));
    for (const entry of next) {
      // 新窗口候选：id 与档案（姓名等）均为全新一批
      assert.ok(entry.candidateId.startsWith("cand-1-"));
      assert.ok(!beforeNames.has(entry.disciple.name));
    }
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
      // 批内候选耗尽则推进到下一刷新窗口（10 年一批，每批 5 人）
      const batch = listRecruitCandidates(state);
      if (batch.length === 0) {
        state = runMonths(state, RECRUIT_REFRESH_TURNS).state;
        continue;
      }
      const first = batch[0];
      assert.ok(first);
      state = recruitDisciple(state, first.candidateId).state;
    }
    assert.equal(state.disciples.length, 10);
    let overflow = listRecruitCandidates(state)[0];
    if (!overflow) {
      state = runMonths(state, RECRUIT_REFRESH_TURNS).state;
      overflow = listRecruitCandidates(state)[0];
    }
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
    // 2→3 需金丹弟子 1 名 + 灵石 50,000（先补足灵石，避免触发资源检查）
    const rank2Prepared = structuredClone(rank2);
    rank2Prepared.spiritStones = 51000;
    assert.throws(() => upgradeSect(rank2Prepared), /sect_upgrade_golden_core_not_met/);
    discipleOf(rank2Prepared, "d-1").realmLevel = 7;
    discipleOf(rank2Prepared, "d-1").realm = realmStageForLevel(7).realm;
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

  it("研读功法/法术均消耗书册：书自藏经阁消失，他人不可再研", () => {
    let state = gameWithLibrary();
    state = learnArt(state, "d-1", "tech-hunyuan").state;
    // 混元功书册消耗，养气诀仍在阁。
    assert.deepEqual(state.library?.techniqueIds, ["tech-yangqi"]);
    // 已耗的书他人研读被拒（历练奇遇可再得，故非「已修」类错误）。
    assert.throws(() => learnArt(state, "d-2", "tech-hunyuan"), /art_not_in_library/);
    // 法术研读同样耗书：金锋斩书册消耗，余两本仍在阁。
    state = learnArt(state, "d-2", "spell-jinfeng").state;
    assert.deepEqual(state.library?.spellIds, ["spell-hanbing", "spell-yanbao"]);
    assert.throws(() => learnArt(state, "d-1", "spell-jinfeng"), /art_not_in_library/);
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

  it("服用聚灵丹：12 月内真元 ×1.5、时长累加倍率不叠加；延寿丹最大寿命 +30", () => {
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
    // 推进一月后重复服用：时长在剩余月数上累加（13 + 12 = 25），倍率仍 ×1.5 不叠加。
    after = settleMonthly(after).state;
    after = usePill(after, "d-1", "pill-juling").state;
    assert.equal(discipleOf(after, "d-1").spiritFocusUntilTurn, 1 + 12 + 12);
    const noBuff = structuredClone(after);
    Reflect.deleteProperty(discipleOf(noBuff, "d-1"), "spiritFocusUntilTurn");
    assert.equal(
      monthlyZhenyuanGain(after, discipleOf(after, "d-1")),
      Math.round(monthlyZhenyuanGain(noBuff, discipleOf(noBuff, "d-1")) * 1.5),
    );
    // 过期后服用：自当前回月起算（turn 2 + 12 = 14）。
    discipleOf(after, "d-1").spiritFocusUntilTurn = 2;
    after = usePill(after, "d-1", "pill-juling").state;
    assert.equal(discipleOf(after, "d-1").spiritFocusUntilTurn, 2 + 12);
    // 仓库耗尽后拒绝。
    assert.throws(() => usePill(after, "d-1", "pill-juling"), /pill_not_in_warehouse/);
    // 延寿丹直接 +30 年（写入 maxLifespan）。
    const lifespanBefore = discipleOf(after, "d-2").maxLifespan;
    after = usePill(after, "d-2", "pill-yanshou").state;
    assert.equal(discipleOf(after, "d-2").maxLifespan, lifespanBefore + 30);
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

  it("setAutoPill 开关：落档/关断置 undefined；非法丹药 id、未知弟子拒", () => {
    const state = newGame();
    const { state: after, disciple } = setAutoPill(state, "d-1", "pill-yanshou", true);
    assert.equal(disciple.autoPillYanshou, true);
    assert.equal(discipleOf(after, "d-1").autoPillYanshou, true);
    const { state: off } = setAutoPill(after, "d-1", "pill-yanshou", false);
    assert.equal(discipleOf(off, "d-1").autoPillYanshou, undefined);
    const { state: both } = setAutoPill(state, "d-2", "pill-juling", true);
    assert.equal(discipleOf(both, "d-2").autoPillJuling, true);
    assert.throws(() => setAutoPill(state, "d-1", "pill-unknown", true), /pill_not_found/);
    assert.throws(() => setAutoPill(state, "d-99", "pill-yanshou", true), /disciple_not_found/);
  });

  it("自动服用聚灵丹：月结开头自动续服（当月真元即 ×1.5）、库存不足静默跳过", () => {
    const state = newGame();
    state.warehouse = { gear: [], pills: [{ pillId: "pill-juling", count: 1 }] };
    const d1 = discipleOf(state, "d-1");
    d1.autoPillJuling = true;
    const base = monthlyZhenyuanGain(state, d1);
    const { state: after } = settleMonthly(state);
    const after1 = discipleOf(after, "d-1");
    // 月结开头自动服：自 turn 2 起算 12 月（2+12），当月真元增速即按 ×1.5 落账。
    assert.equal(after1.spiritFocusUntilTurn, 2 + 12);
    const buffGain = monthlyZhenyuanGain(after, after1);
    assert.equal(buffGain, Math.round(base * 1.5));
    if (after1.realmLevel === d1.realmLevel) {
      assert.equal(after1.zhenyuan, d1.zhenyuan + buffGain);
    }
    // 仓库唯一一枚被自动服掉；未勾选的 d-2/d-3 不受影响。
    assert.deepEqual(after.warehouse?.pills, []);
    assert.equal(discipleOf(after, "d-2").spiritFocusUntilTurn, undefined);
    assert.ok(
      after.chronicle.some((entry) => entry.text.includes("自动服用聚灵丹")),
      "自动服用应落纪事",
    );
    // 库存不足：勾选开着但仓库无丹药，月结照常（不抛错、不生效）。
    const empty = newGame();
    discipleOf(empty, "d-1").autoPillJuling = true;
    const { state: afterEmpty } = settleMonthly(empty);
    assert.equal(discipleOf(afterEmpty, "d-1").spiritFocusUntilTurn, undefined);
  });

  it("自动服用聚灵丹：增益到期次月自动接上，无空窗月（30 月恰耗 3 枚）", () => {
    const state = newGame();
    state.warehouse = { gear: [], pills: [{ pillId: "pill-juling", count: 6 }] };
    discipleOf(state, "d-1").autoPillJuling = true;
    let current = state;
    for (let month = 0; month < 30; month++) {
      current = settleMonthly(current).state;
      const d = discipleOf(current, "d-1");
      if (d.spiritFocusUntilTurn !== undefined) {
        assert.ok(
          d.spiritFocusUntilTurn >= current.currentTurn,
          `第 ${current.currentTurn} 月增益不应出现空窗`,
        );
      }
    }
    // turn 2 服至 14、turn 15 服至 27、turn 28 服至 40：30 个月内恰自动服 3 枚
    //（按纪事计数；仓库库存受历练掉落丹药扰动，不作断言依据）。
    const autoConsumed = current.chronicle.filter(
      (entry) => entry.text.includes("自动服用聚灵丹") && entry.turn <= current.currentTurn,
    ).length;
    assert.equal(autoConsumed, 3);
  });

  it("自动服用延寿丹：剩余寿命 ≤30 年时月结自动服 1 枚；>30 年不空耗", () => {
    const setup = (ageOffset: number) => {
      const base = newGame();
      base.warehouse = { gear: [], pills: [{ pillId: "pill-yanshou", count: 1 }] };
      const d1 = discipleOf(base, "d-1");
      d1.autoPillYanshou = true;
      // 按有效坐化年龄（含天赋寿命平加）设定年龄，避免天赋口径漂移。
      d1.age = d1.maxLifespan + talentsLifespanFlat(d1.talentIds) - ageOffset;
      return base;
    };
    // 剩余 29 年（≤30）：自动服 1 枚。对照组（不勾选）同一 seed 同月结，差异应恰为 +30 年。
    const state = setup(29);
    const mirror = structuredClone(state);
    discipleOf(mirror, "d-1").autoPillYanshou = undefined;
    const withAuto = settleMonthly(state).state;
    const withoutAuto = settleMonthly(mirror).state;
    const autoDisciple = discipleOf(withAuto, "d-1");
    assert.equal(autoDisciple.maxLifespan, discipleOf(withoutAuto, "d-1").maxLifespan + 30);
    assert.deepEqual(withAuto.warehouse?.pills, []);
    assert.ok(
      withAuto.chronicle.some((entry) => entry.text.includes("自动服用延寿丹")),
      "自动服用应落纪事",
    );
    // 剩余 31 年（>30）：勾选也服不动——对照组（不勾选）同月结，最大寿命应一致、库存原样。
    const state2 = setup(31);
    const mirror2 = structuredClone(state2);
    discipleOf(mirror2, "d-1").autoPillYanshou = undefined;
    const withAuto2 = settleMonthly(state2).state;
    const withoutAuto2 = settleMonthly(mirror2).state;
    assert.equal(
      discipleOf(withAuto2, "d-1").maxLifespan,
      discipleOf(withoutAuto2, "d-1").maxLifespan,
    );
    assert.deepEqual(withAuto2.warehouse?.pills, [{ pillId: "pill-yanshou", count: 1 }]);
  });

  it("穿戴法宝：仓库取出、旧法宝卸下回仓、单项效果进入派生（五维/先攻/防御）", () => {
    const state = newGame();
    state.warehouse = {
      gear: [
        { slot: "talisman", treasureId: "gear-qingyunzhu" },
        { slot: "talisman", treasureId: "gear-yufenghuan" },
        { slot: "talisman", treasureId: "gear-huangquanfan" },
      ],
      pills: [],
    };
    const baseProfile = buildCombatProfile(discipleOf(state, "d-1"));
    // 青云珠：有效五维魂力 +5（法威随等级公式重算，非平加）。
    const { state: after1 } = wearGear(state, "d-1", "talisman", "gear-qingyunzhu");
    assert.deepEqual(discipleOf(after1, "d-1").equippedGear, { talisman: "gear-qingyunzhu" });
    assert.deepEqual(after1.warehouse?.gear, [
      { slot: "talisman", treasureId: "gear-yufenghuan" },
      { slot: "talisman", treasureId: "gear-huangquanfan" },
    ]);
    const profile1 = buildCombatProfile(discipleOf(after1, "d-1"));
    assert.equal(profile1.breakdown.attributes.gearFlat.soulPower, 5);
    assert.equal(
      profile1.breakdown.attributes.effective.soulPower,
      Math.min(100, baseProfile.breakdown.attributes.effective.soulPower + 5),
    );
    assert.ok(profile1.magicPower > baseProfile.magicPower);
    // 替换：御风环（身法 +6）上身、青云珠回仓，先攻 +6。
    const { state: after2 } = wearGear(after1, "d-1", "talisman", "gear-yufenghuan");
    assert.deepEqual(discipleOf(after2, "d-1").equippedGear, { talisman: "gear-yufenghuan" });
    // 卸下回仓的青云珠追加在仓库末尾。
    assert.deepEqual(after2.warehouse?.gear, [
      { slot: "talisman", treasureId: "gear-huangquanfan" },
      { slot: "talisman", treasureId: "gear-qingyunzhu" },
    ]);
    const profile2 = buildCombatProfile(discipleOf(after2, "d-1"));
    assert.equal(profile2.firstStrike, baseProfile.firstStrike + 6);
    assert.ok(after2.chronicle[0]?.text.includes("「御风环」"));
    // 黄泉幡：防御 +50%（基础防御 floor 值 ×1.5 四舍五入；初始弟子无功法，base 即 floor 值）。
    const { state: after3 } = wearGear(after2, "d-1", "talisman", "gear-huangquanfan");
    const profile3 = buildCombatProfile(discipleOf(after3, "d-1"));
    assert.equal(profile3.breakdown.gear.defensePct, 50);
    assert.equal(profile3.defense, Math.round(baseProfile.defense * 1.5));
    assert.ok(after3.chronicle[0]?.text.includes("防御 +50%"));
    // 仓库无此法宝被拒；目录不存在的 id 同样被拒。
    assert.throws(
      () => wearGear(after3, "d-1", "talisman", "gear-hundunzhong"),
      /gear_not_in_warehouse/,
    );
    assert.throws(() => wearGear(after3, "d-1", "talisman", "gear-none"), /gear_invalid/);
  });

  it("旧档法宝迁移：仓库/已穿戴档位数字 → 法宝 id、旧 gear 任务剥离槽档、幂等", () => {
    const state = newGame();
    state.warehouse = {
      gear: [
        { slot: "talisman", tier: 1 },
        { slot: "talisman", tier: 4 },
      ] as never,
      pills: [],
    };
    discipleOf(state, "d-1").equippedGear = { talisman: 2 } as never;
    if (state.rival) {
      for (const disciple of state.rival.disciples) {
        disciple.equippedGear = { talisman: 3 } as never;
      }
    }
    state.jobs = {
      pill: { workers: [], assignedOuter: 0, task: null },
      gear: {
        workers: [],
        assignedOuter: 5,
        task: { kind: "gear", slot: "talisman", tier: 3, accumulatedPoints: 40 } as never,
      },
    };
    const migrated = migrateGameState(state);
    // 仓库：档位 → 该档代表法宝（目录首位）。
    assert.deepEqual(migrated.warehouse?.gear, [
      { slot: "talisman", treasureId: "gear-qingyunzhu" },
      { slot: "talisman", treasureId: "gear-hundunzhong" },
    ]);
    // 已穿戴：档 2 → 御风环。
    const wearer = migrated.disciples.find((entry) => entry.id === "d-1");
    assert.deepEqual(wearer?.equippedGear, { talisman: "gear-yufenghuan" });
    // 对手名册：档 3 → 离火扇（品阶 3 目录首位）；法宝 id 均在目录内。
    if (migrated.rival) {
      for (const disciple of migrated.rival.disciples) {
        assert.equal(disciple.equippedGear?.talisman, "gear-lihuoshan");
      }
    }
    // 在炉法宝任务：槽档剥离、进度保留。
    assert.deepEqual(migrated.jobs?.gear.task, { kind: "gear", accumulatedPoints: 40 });
    // 幂等：迁移后再迁移不变。
    assert.deepEqual(migrateGameState(migrated), migrated);
  });

  it("资源长老：供奉已删除暂无加成，任命仍生效；不历练（历练选将不选）但照常修炼", () => {
    let state = newGame();
    state = appointElder(state, "d-1", "resource").state;
    assert.equal(state.elders?.resource, "d-1");
    const { state: after } = settleMonthly(state);
    // 供奉已删除（新局未分岗无挖矿收入）：仅 − 俸禄 30（危险-安全月历练无灵石入账）。
    assert.equal(after.spiritStones, 2000 - 30);
    // 不历练：历练选将的可出战名册不含占用者。
    const readyIds = new Set(
      combatReadyDisciples(after, after.currentTurn).map((entry) => entry.id),
    );
    assert.ok(!readyIds.has("d-1"));
    assert.ok(readyIds.has("d-2"));
    // 照常修炼：真元每月增长。
    assert.ok(discipleOf(after, "d-1").zhenyuan > 0);
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

  it("灵矿长老：挖矿上缴按境界加成（每级 +10%，元婴前期 +100% 封顶）；任内照常修炼、不被历练选将、卸任即失效", () => {
    // 加成曲线：练气前期 +10% … 元婴前期（10 级）+100%，越界钳顶。
    assert.equal(mineElderBonusPct(1), 0.1);
    assert.equal(mineElderBonusPct(7), 0.7);
    assert.equal(mineElderBonusPct(10), 1);
    assert.equal(mineElderBonusPct(99), 1);
    assert.equal(mineElderBonusPct(0), 0);

    // 月结对照：同 seed、只差挖矿配置与长老在任/境界（d-1 在任时不出战，历练选将不受影响）。
    const setup = (realmLevel: number, appointed: boolean): GameState => {
      let state = newGame("mine-elder-1");
      state = assignOuterJobs(state, { mining: 10 }).state;
      const elder = discipleOf(state, "d-1");
      elder.realmLevel = realmLevel;
      elder.realm = realmStageForLevel(realmLevel).realm;
      return appointed ? appointElder(state, "d-1", "mine").state : state;
    };
    const noMining = settleMonthly(newGame("mine-elder-1"));
    const goldenCore = settleMonthly(setup(7, true));
    const nascentSoul = settleMonthly(setup(10, true));
    // 挖矿收入 = 上缴 ×(1+加成)：金丹前期（7 级）+70% → 17 灵石；元婴前期（10 级）封顶 +100% → 20 灵石。
    assert.equal(goldenCore.result.spiritStonesDelta - noMining.result.spiritStonesDelta, 17);
    assert.equal(nascentSoul.result.spiritStonesDelta - noMining.result.spiritStonesDelta, 20);
    // 任内不历练（历练选将不选）但照常修炼（金丹前期 7 级：月真元远未到 3 万突破阈值）。
    const readyIds = new Set(
      combatReadyDisciples(goldenCore.state, goldenCore.state.currentTurn).map((entry) => entry.id),
    );
    assert.ok(!readyIds.has("d-1"));
    assert.ok(discipleOf(goldenCore.state, "d-1").zhenyuan > 0);
    // 元婴前期（10 级）修行尽头：不再积累真元（TOP_REALM_LEVEL 守卫，与占岗无关）。
    assert.equal(discipleOf(nascentSoul.state, "d-1").zhenyuan, 0);

    // 卸任：elders.mine 清空、落纪事；再月结加成消失（与同境界无长老基线一致）。
    const baseline = settleMonthly(setup(10, false));
    const boosted = setup(10, true);
    const removed = removeElder(boosted, "mine");
    assert.equal(removed.state.elders?.mine, undefined);
    assert.ok(removed.state.chronicle[0]?.text.includes("卸任灵矿长老"));
    const settledRemoved = settleMonthly(removed.state);
    assert.equal(settledRemoved.result.spiritStonesDelta, baseline.result.spiritStonesDelta);
    // 无长老在任时卸任被拒。
    assert.throws(() => removeElder(removed.state, "mine"), /elder_job_not_held/);
  });

  it("会战全军出动：岗位/长老占用者照常出战（全员按战力降序同序配对，构造占用者为全宗最强）", () => {
    let state = createGame({ seed: "war-job-exclusion", sectName: "青云门", rivalName: "玄阴宗" });
    // 任命 d-1 为长老并置为全宗最强：全军出动口径下 d-1 必列首位对位。
    state = appointElder(state, "d-1", "resource").state;
    const holder = discipleOf(state, "d-1");
    holder.realmLevel = 8;
    holder.realm = realmStageForLevel(8).realm;
    state = declareWar(state);
    const { result } = settleMonthly(state);
    assert.ok(result.war, "宣战次月应结算会战");
    const fighters = result.war.pairOutcomes.map((entry) => entry.playerFighterId);
    assert.ok(fighters.length > 0, "我方应有出战弟子");
    // 全宗 3 名内门全员出战（含长老 d-1），按战力降序 d-1 领衔。
    assert.equal(fighters[0], "d-1");
    assert.deepEqual([...fighters].sort(), ["d-1", "d-2", "d-3"]);
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
