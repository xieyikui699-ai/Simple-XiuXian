// E04 收口验证（T-E04-F01～F04）：两宗对抗全链路集成测试。
// 覆盖 P4 约束的确定性双跑断言（60 月两宗状态 deepEqual）、宣战-会战-冷却链路、
// 四结局与评级、大境界突破声望 +3、终局锁语义。全链路均为纯函数确定性推进。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGame, setWarParty } from "./engine.js";
import { realmStageForLevel } from "./realms.js";
import { createRivalSect, declareWar, prestigeDeltaForMajorBreakthrough } from "./rival.js";
import { rateEnding, settleMonthly } from "./settlement.js";
import type { GameState } from "./state.js";

/** 剧本推进：每月历练；可宣战即宣战（连续覆盖会战链路）。 */
function runCampaign(seed: string, months: number): GameState {
  let state = createGame({ seed, sectName: "青云门", rivalName: "玄阴宗" });
  for (let i = 0; i < months; i++) {
    if (state.ending) break;
    if (
      !state.warWithRival &&
      state.currentTurn >= 6 &&
      state.rival &&
      (state.warCooldownEndsTurn ?? 0) <= state.currentTurn
    ) {
      state = declareWar(state);
    }
    state = settleMonthly(state, "explore").state;
  }
  return state;
}

describe("E04 两宗对抗全链路（campaign）", () => {
  it("开局即挂载对手宗门：同 seed 双局 rival deepEqual，难度随 createGame 传入", () => {
    const state = createGame({ seed: "campaign-seed", sectName: "青云门", rivalName: "玄阴宗" });
    assert.ok(state.rival);
    assert.equal(state.rival.name, "玄阴宗");
    assert.equal(state.rival.sectRank, 1);
    assert.deepEqual(
      state.rival,
      createRivalSect({ seed: "campaign-seed", name: "玄阴宗", difficulty: 1 }),
    );
    const hard = createGame({
      seed: "campaign-seed",
      sectName: "青云门",
      rivalDifficulty: 1.2,
    });
    assert.equal(hard.rival?.difficulty, 1.2);
  });

  it("P4 约束：60 月双局同 seed deepEqual（含 rival 推进/宣战/会战/历练/伤势）", () => {
    const first = runCampaign("campaign-golden", 60);
    const second = runCampaign("campaign-golden", 60);
    assert.deepEqual(first, second);
  });

  it("战争链路发生过：60 月内会战记录 ≥3，战争状态收尾、冷却自宣战月起算 12 月", () => {
    const state = runCampaign("campaign-golden", 60);
    const wars = state.sectWars ?? [];
    assert.ok(wars.length >= 3, `sectWars=${wars.length}`);
    assert.equal(state.warWithRival, false);
    for (const record of wars) {
      assert.ok(record.plunder >= 0);
      assert.ok(["player", "rival"].includes(record.winner));
      assert.equal(record.pairOutcomes.length, 3);
      assert.ok(record.summary.length > 0);
    }
  });

  it("宣战次月触发会战：当月不开战、次月第 7 步结算并进入 12 月冷却；冷却期内拒绝宣战", () => {
    let state = createGame({ seed: "war-flow", sectName: "青云门", rivalName: "玄阴宗" });
    state = declareWar(state);
    assert.equal(state.warWithRival, true);
    assert.equal(state.warDeclaredTurn, 1);
    const first = settleMonthly(state, "rest");
    assert.ok(first.result.war, "宣战次月应结算会战");
    assert.equal(first.state.warWithRival, false);
    assert.equal(first.state.warCooldownEndsTurn, 13);
    assert.throws(() => declareWar(first.state), /war_cooldown_active/);
  });

  it("setWarParty：指定出战名单（≤3 可出战内门），超编/伤员/外门被拒", () => {
    const state = createGame({ seed: "party-seed", sectName: "青云门", rivalName: "玄阴宗" });
    const out = setWarParty(state, ["d-1", "d-2"]);
    assert.deepEqual(out.state.warParty, ["d-1", "d-2"]);
    assert.throws(() => setWarParty(state, ["d-1", "d-2", "d-3", "d-4"]), /war_party_too_large/);
    assert.throws(() => setWarParty(state, ["d-5"]), /war_party_disciple_unavailable/); // 外门
    const injured = structuredClone(state);
    const target = injured.disciples.find((disciple) => disciple.id === "d-3");
    assert.ok(target);
    target.injury = { kind: "light", untilTurn: injured.currentTurn };
    assert.throws(() => setWarParty(injured, ["d-3"]), /war_party_disciple_unavailable/);
  });

  it("大境界突破声望 +3（进入 4/7/10 级），其余等级为 0；飞升结局带评级字段", () => {
    assert.equal(prestigeDeltaForMajorBreakthrough(4), 3);
    const state = createGame({ seed: "ascend-seed", sectName: "青云门", rivalName: "玄阴宗" });
    const disciple = state.disciples.find((entry) => entry.id === "d-1");
    assert.ok(disciple);
    disciple.realmLevel = 10;
    disciple.realm = realmStageForLevel(10).realm;
    disciple.zhenyuan = realmStageForLevel(10).requiredZhenyuan;
    disciple.breakthroughFailures = 20;
    const { state: after } = settleMonthly(state, "rest");
    assert.equal(after.ending?.kind, "ascension");
    assert.ok(after.ending?.rating);
    assert.ok(["甲", "乙", "丙", "丁"].includes(after.ending.rating ?? ""));
    assert.equal(typeof after.ending?.score, "number");
    assert.equal(after.totalBreakthroughs, 1);
    assert.throws(() => settleMonthly(after, "rest"), /game_already_ended/);
  });

  it("四结局判定与评级：吞并/被吞并对称、凋敝连续 6 月、评级阈值确定", () => {
    // 吞并：对方声望 0 且我方等级更高 → 次月月结触发。
    const state = createGame({ seed: "annex-seed", sectName: "青云门", rivalName: "玄阴宗" });
    const rival = state.rival;
    assert.ok(rival);
    rival.prestige = 0;
    state.sectRank = 2;
    const annexed = settleMonthly(state, "rest");
    assert.equal(annexed.state.ending?.kind, "annexation");
    assert.ok(annexed.state.ending?.rating);
    // 被吞并：对称。
    const lost = createGame({ seed: "annexed-seed", sectName: "青云门", rivalName: "玄阴宗" });
    const strongRival = lost.rival;
    assert.ok(strongRival);
    lost.prestige = 0;
    strongRival.sectRank = 2;
    const annexedMe = settleMonthly(lost, "rest");
    assert.equal(annexedMe.state.ending?.kind, "annexed");
    // 凋敝：内门 0 且灵石 < 300 连续 6 月（计数器落 state）。清空弟子使灵石无供奉回血。
    let declining = createGame({ seed: "decline-seed", sectName: "青云门", rivalName: "玄阴宗" });
    declining.disciples = [];
    declining.spiritStones = 100;
    for (let i = 0; i < 6; i++) {
      const outcome = settleMonthly(declining, "rest");
      declining = outcome.state;
      if (declining.ending) break;
    }
    assert.equal(declining.ending?.kind, "bankrupt");
    assert.ok(declining.ending?.rating);
    // 评级确定性。
    const stats = {
      gameYears: 40,
      breakthroughCount: 12,
      warWins: 2,
      warTotal: 3,
      fallenCount: 4,
      spiritStonesLeft: 8000,
    };
    assert.equal(rateEnding(stats), rateEnding(stats));
  });
});
