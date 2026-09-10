// M2 红色契约（T-E00-F04-001）：历练遭遇与月结顺序 golden 红测。
// 数值锚点全部取自 docs/design/2026-09-06-小程序简化版设计.md §历练与遭遇 表格与 §月结流程 9 步顺序，
// 不从旧实现反抄。本文件只锁契约：expedition.ts（E03-F01）尚未实现 → 导入即红；
// settlement.ts 的月结顺序常量（E03-F02 契约）亦未导出。pnpm test 三次连跑退出码均非 0。
// 事件掷骰契约格式：deterministicRoll(`${state.seed}:expedition:${turn}`)，
// 区间 [0,50) 收获 / [50,65) 切磋 / [65,75) 掠夺 / [75,85) 奇遇 / [85,95) 危险 / [95,100) 丹药奇缘；
// 固定 seed 期望事件序列由 node:crypto sha256 独立对拍预计算写死（hash.test.ts 已证引擎 sha256 与之逐字节一致）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTreasureById } from "./catalog.js";
import { createGame } from "./engine.js";
import {
  type ExpeditionEventKind,
  expeditionEventForRoll,
  injuryForRoll,
  settleExpedition,
} from "./expedition.js";
import { deterministicRoll } from "./hash.js";
import { realmStageForLevel } from "./realms.js";
import { MONTHLY_STEP_ORDER, settleMonthly } from "./settlement.js";
import type { Disciple, GameState } from "./state.js";

const GOLDEN_SEED_A = "expedition-golden";
const EXPECTED_A: readonly ExpeditionEventKind[] = [
  "plunder",
  "danger",
  "harvest",
  "harvest",
  "danger",
  "harvest",
  "harvest",
  "harvest",
  "spar",
  "spar",
  "harvest",
  "harvest",
];
const GOLDEN_SEED_B = "expedition-golden-2";
const EXPECTED_B: readonly ExpeditionEventKind[] = [
  "windfall",
  "windfall",
  "harvest",
  "spar",
  "plunder",
  "harvest",
];

function makeDisciple(overrides: Partial<Disciple> & Pick<Disciple, "id">): Disciple {
  const realmLevel = overrides.realmLevel ?? 1;
  return {
    id: overrides.id,
    name: overrides.name ?? `弟子${overrides.id}`,
    gender: "male",
    age: 20,
    maxLifespan: 90,
    realm: overrides.realm ?? realmStageForLevel(realmLevel).realm,
    realmLevel,
    zhenyuan: 0,
    breakthroughFailures: 0,
    rootType: "single",
    rootElements: ["metal"],
    attributes: { strength: 50, soulPower: 50, agility: 50, physique: 50, comprehension: 50 },
    talentIds: [],
  };
}

describe("历练六事件概率分布与伤势分支（expedition）", () => {
  it("事件区间：收获 50 / 切磋 15 / 掠夺 10 / 奇遇 10 / 危险 10 / 丹药奇缘 5", () => {
    assert.equal(expeditionEventForRoll(0), "harvest");
    assert.equal(expeditionEventForRoll(49.9999), "harvest");
    assert.equal(expeditionEventForRoll(50), "spar");
    assert.equal(expeditionEventForRoll(64.9999), "spar");
    assert.equal(expeditionEventForRoll(65), "plunder");
    assert.equal(expeditionEventForRoll(74.9999), "plunder");
    assert.equal(expeditionEventForRoll(75), "windfall");
    assert.equal(expeditionEventForRoll(84.9999), "windfall");
    assert.equal(expeditionEventForRoll(85), "danger");
    assert.equal(expeditionEventForRoll(94.9999), "danger");
    assert.equal(expeditionEventForRoll(95), "pill");
    assert.equal(expeditionEventForRoll(99.9999), "pill");
  });

  it("危险伤势分支：30% 轻伤 / 15% 重伤 / 其余安全", () => {
    assert.equal(injuryForRoll(0), "light");
    assert.equal(injuryForRoll(29.9999), "light");
    assert.equal(injuryForRoll(30), "heavy");
    assert.equal(injuryForRoll(44.9999), "heavy");
    assert.equal(injuryForRoll(45), "none");
    assert.equal(injuryForRoll(99.9999), "none");
  });

  it("奇遇掉落分支：功法书 10% / 法术书 33% / 法宝 57%（2026-09-10 功法由 34% 降至 10%）", () => {
    // 分支掷骰 deterministicRoll(`${seed}:expedition:${turn}:windfall`)：
    // [0,10) 功法书 / [10,43) 法术书 / [43,100) 法宝（品阶 1–2 六种随机其一）。
    const opponent = makeDisciple({ id: "opp-1" });
    const seen = { gongfa_book: 0, spell_book: 0, gear: 0 };
    for (let i = 0; i < 400; i++) {
      const seed = `windfall-branch-${i}`;
      if (expeditionEventForRoll(deterministicRoll(`${seed}:expedition:2`)) !== "windfall")
        continue;
      const branch = deterministicRoll(`${seed}:expedition:2:windfall`);
      const expected = branch < 10 ? "gongfa_book" : branch < 43 ? "spell_book" : "gear";
      if (seen[expected] > 0) continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const result = settleExpedition(game, {
        turn: 2,
        atWar: false,
        incomePct: 0,
        opponentProvider: () => opponent,
      });
      assert.ok(result.reward);
      assert.equal(result.reward.type, expected, `seed=${seed} branch=${branch}`);
      seen[expected] += 1;
      if (seen.gongfa_book > 0 && seen.spell_book > 0 && seen.gear > 0) return;
    }
    throw new Error("test_setup_windfall_branch_seed_not_found");
  });

  it("固定 seed 事件序列与设计概率表一致（seed=expedition-golden，1–12 月）", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    for (let turn = 1; turn <= 12; turn++) {
      const result = settleExpedition(game, {
        turn,
        atWar: true,
        incomePct: 0,
        opponentProvider: () => opponent,
      });
      const expected = EXPECTED_A[turn - 1];
      assert.ok(expected);
      assert.equal(result.event, expected, `turn ${turn}`);
    }
  });

  it("固定 seed 序列 B：奇遇与丹药奇缘奖励形状（seed=expedition-golden-2）", () => {
    const game = createGame({ seed: GOLDEN_SEED_B, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    for (let turn = 1; turn <= 6; turn++) {
      const result = settleExpedition(game, {
        turn,
        // 该 golden 序列为原始事件掷骰表；掠夺事件需宣战态才不被降级为切磋（D-014）。
        atWar: true,
        incomePct: 0,
        opponentProvider: () => opponent,
      });
      const expected = EXPECTED_B[turn - 1];
      assert.ok(expected);
      assert.equal(result.event, expected, `turn ${turn}`);
    }
    const windfall = settleExpedition(game, {
      turn: 1,
      atWar: false,
      incomePct: 0,
      opponentProvider: () => opponent,
    });
    assert.ok(windfall.reward);
    assert.ok(
      windfall.reward.type === "gongfa_book" ||
        windfall.reward.type === "spell_book" ||
        windfall.reward.type === "gear",
    );
    if (windfall.reward.type === "gear") {
      // 掉落池：目录十件中品阶 1–2 的六种法宝随机其一。
      const dropped = getTreasureById(windfall.reward.treasureId);
      assert.ok(dropped && dropped.tier <= 2);
    }
    const pill = settleExpedition(game, {
      turn: 14,
      atWar: false,
      incomePct: 0,
      opponentProvider: () => opponent,
    });
    assert.equal(pill.event, "pill");
    assert.ok(pill.reward);
    assert.equal(pill.reward.type, "pill");
    // 丹药 id 以已落地的 catalog.ts PILLS 目录为准（红测原稿写 p-yanshou/p-juling 与目录冲突，收绿时修正）。
    assert.ok(pill.reward.pillId === "pill-yanshou" || pill.reward.pillId === "pill-juling");
  });

  it("收获灵石 50–150，并吃 incomePct 天赋加成", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    for (const turn of [3, 4, 6, 7, 8, 11, 12]) {
      const result = settleExpedition(game, {
        turn,
        atWar: false,
        incomePct: 0,
        opponentProvider: () => opponent,
      });
      assert.equal(result.event, "harvest");
      assert.ok(
        result.spiritStonesDelta >= 50 && result.spiritStonesDelta <= 150,
        `turn ${turn} → ${result.spiritStonesDelta}`,
      );
    }
    const boosted = settleExpedition(game, {
      turn: 3,
      atWar: false,
      incomePct: 0.15,
      opponentProvider: () => opponent,
    });
    assert.ok(boosted.spiritStonesDelta >= 57 && boosted.spiritStonesDelta <= 173);
  });

  it("掠夺仅在宣战状态生效（胜 200–400 灵石），否则降级为切磋；同 seed 双状态可比", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    const provider = () => opponent;
    for (let turn = 1; turn <= 36; turn++) {
      const atWar = settleExpedition(game, {
        turn,
        atWar: true,
        incomePct: 0,
        opponentProvider: provider,
      });
      const peace = settleExpedition(game, {
        turn,
        atWar: false,
        incomePct: 0,
        opponentProvider: provider,
      });
      assert.notEqual(peace.event, "plunder");
      if (atWar.event === "plunder") {
        assert.equal(peace.event, "spar");
        assert.equal(peace.degradedFrom, "plunder");
        if (atWar.battle?.winner === "A") {
          assert.ok(
            atWar.spiritStonesDelta >= 200 && atWar.spiritStonesDelta <= 400,
            `turn ${turn} → ${atWar.spiritStonesDelta}`,
          );
        } else {
          assert.equal(atWar.spiritStonesDelta, 0);
        }
      } else {
        assert.equal(peace.event, atWar.event);
      }
    }
  });

  it("切磋奖惩：胜声望 +2 士气 +1、败 −1/−1、平 0/0；对手弟子由 opponentProvider 注入", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    let opponentCalls = 0;
    for (const turn of [9, 10]) {
      const result = settleExpedition(game, {
        turn,
        atWar: false,
        incomePct: 0,
        opponentProvider: () => {
          opponentCalls += 1;
          return opponent;
        },
      });
      assert.equal(result.event, "spar");
      assert.ok(result.battle);
      if (result.battle.winner === "A") {
        assert.deepEqual([result.prestigeDelta, result.moraleDelta], [2, 1]);
      } else if (result.battle.winner === "B") {
        assert.deepEqual([result.prestigeDelta, result.moraleDelta], [-1, -1]);
      } else {
        assert.deepEqual([result.prestigeDelta, result.moraleDelta], [0, 0]);
      }
    }
    assert.equal(opponentCalls, 2);
  });

  it("危险事件伤势落到出战弟子（fighterProvider 可注入）", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    const myFighter = makeDisciple({ id: "me-1", realmLevel: 2 });
    for (const turn of [2, 5]) {
      const result = settleExpedition(game, {
        turn,
        atWar: false,
        incomePct: 0,
        opponentProvider: () => opponent,
        fighterProvider: () => myFighter,
      });
      assert.equal(result.event, "danger");
      if (result.injury) {
        assert.equal(result.injury.discipleId, "me-1");
        assert.ok(result.injury.kind === "light" || result.injury.kind === "heavy");
      }
    }
  });

  it("确定性：同 seed 同输入双跑 deepEqual（禁 Math.random）", () => {
    const game = createGame({ seed: GOLDEN_SEED_A, sectName: "历练宗" });
    const opponent = makeDisciple({ id: "opp-1" });
    const myFighter = makeDisciple({ id: "me-1", realmLevel: 2 });
    const run = () =>
      settleExpedition(game, {
        turn: 1,
        atWar: true,
        incomePct: 0.15,
        opponentProvider: () => opponent,
        fighterProvider: () => myFighter,
      });
    assert.deepEqual(run(), run());
  });
});

describe("月结流程 8 步顺序锚点（settlement 契约）", () => {
  it("经济→真元突破→生产→历练→NPC→会战→声望胜负→年度衰老", () => {
    assert.deepEqual(MONTHLY_STEP_ORDER, [
      "economy",
      "breakthrough",
      "production",
      "expedition",
      "rival",
      "sectWar",
      "verdict",
      "aging",
    ]);
    const indexOf = (step: string) => {
      const index = MONTHLY_STEP_ORDER.indexOf(step);
      assert.ok(index >= 0, step);
      return index;
    };
    assert.ok(indexOf("economy") < indexOf("breakthrough"));
    assert.ok(indexOf("production") < indexOf("expedition"));
    assert.ok(indexOf("rival") < indexOf("sectWar"));
    assert.equal(MONTHLY_STEP_ORDER[MONTHLY_STEP_ORDER.length - 1], "aging");
  });
});

// ─── 月结历练接线与伤势恢复（T-E03-F02-001 验收）────────────────────────

function discipleOf(state: GameState, id: string): Disciple {
  const found = state.disciples.find((entry) => entry.id === id);
  if (!found) throw new Error(`test_setup_disciple_missing:${id}`);
  return found;
}

describe("月结历练接线与伤势恢复（E03-F02）", () => {
  const opponent = makeDisciple({ id: "opp-1" });

  function eventAt(seed: string, turn: number): ExpeditionEventKind {
    return expeditionEventForRoll(deterministicRoll(`${seed}:expedition:${turn}`));
  }

  it("历练月报告落 result.expedition，灵石与纪事落账（收获月）", () => {
    for (let i = 0; i < 300; i++) {
      const seed = `wire-harvest-${i}`;
      if (eventAt(seed, 2) !== "harvest") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const { state, result } = settleMonthly(game);
      assert.ok(result.expedition);
      assert.equal(result.expedition.event, "harvest");
      assert.ok(
        result.expedition.spiritStonesDelta >= 50 && result.expedition.spiritStonesDelta <= 150,
      );
      // 供奉已删除（新局未分岗无挖矿收入）：仅 − 俸禄 30，另加历练收获。
      assert.equal(state.spiritStones, 2000 - 30 + result.expedition.spiritStonesDelta);
      assert.ok(
        state.chronicle.some((entry) => entry.kind === "normal" && entry.text.includes("外出历练")),
      );
      return;
    }
    throw new Error("test_setup_harvest_seed_not_found");
  });

  it("incomePct 天赋接线：福缘深厚弟子使收获 ×1.15", () => {
    for (let i = 0; i < 300; i++) {
      const seed = `wire-income-${i}`;
      if (eventAt(seed, 2) !== "harvest") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const plain = settleExpedition(game, {
        turn: 2,
        atWar: false,
        incomePct: 0,
        opponentProvider: () => opponent,
      });
      discipleOf(game, "d-1").talentIds = ["t-deep-fortune"];
      const boosted = settleMonthly(game);
      assert.equal(boosted.result.expedition?.event, "harvest");
      assert.equal(
        boosted.result.expedition?.spiritStonesDelta,
        Math.round(plain.spiritStonesDelta * 1.15),
      );
      return;
    }
    throw new Error("test_setup_income_seed_not_found");
  });

  it("切磋接线：战报入 state.battles，声望/士气按胜负落账", () => {
    for (let i = 0; i < 300; i++) {
      const seed = `wire-spar-${i}`;
      if (eventAt(seed, 2) !== "spar") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const { state, result } = settleMonthly(game, {
        opponentProvider: () => opponent,
      });
      const report = result.expedition;
      assert.ok(report?.battle);
      assert.equal(state.battles?.length, 1);
      assert.equal(state.battles?.[0]?.source, "expedition");
      const sparPrestige = report.battle.winner === "A" ? 2 : report.battle.winner === "B" ? -1 : 0;
      const sparMorale = report.battle.winner === "A" ? 1 : report.battle.winner === "B" ? -1 : 0;
      assert.equal(result.prestigeDelta, sparPrestige);
      assert.equal(result.moraleDelta, sparMorale + 1);
      return;
    }
    throw new Error("test_setup_spar_seed_not_found");
  });

  it("危险伤势落账：injury 写入弟子（untilTurn = 当月 + 禁战月数），纪事 warning", () => {
    for (let i = 0; i < 300; i++) {
      const seed = `wire-danger-${i}`;
      if (eventAt(seed, 2) !== "danger") continue;
      const branch = injuryForRoll(deterministicRoll(`${seed}:expedition:2:danger`));
      if (branch === "none") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const { state, result } = settleMonthly(game);
      const injuredId = result.expedition?.injury?.discipleId;
      assert.ok(injuredId);
      const months = result.expedition?.injury?.months ?? 0;
      const injured = state.disciples.find((entry) => entry.id === injuredId);
      assert.ok(injured?.injury);
      assert.equal(injured.injury.untilTurn, 2 + months);
      assert.equal(injured.injury.kind, branch === "heavy" ? "severe" : "light");
      assert.ok(state.chronicle.some((entry) => entry.kind === "warning"));
      return;
    }
    throw new Error("test_setup_danger_injury_seed_not_found");
  });

  it("伤势禁战：负伤弟子不再被默认选为出战弟子", () => {
    for (let i = 0; i < 400; i++) {
      const seed = `wire-banned-${i}`;
      if (eventAt(seed, 2) !== "danger") continue;
      if (injuryForRoll(deterministicRoll(`${seed}:expedition:2:danger`)) === "none") continue;
      if (eventAt(seed, 3) !== "spar") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const first = settleMonthly(game, { opponentProvider: () => opponent });
      const injuredId = first.result.expedition?.injury?.discipleId;
      assert.ok(injuredId);
      const second = settleMonthly(first.state, { opponentProvider: () => opponent });
      assert.ok(second.result.expedition?.battle);
      assert.notEqual(second.result.expedition.participantId, injuredId);
      return;
    }
    throw new Error("test_setup_banned_seed_not_found");
  });

  it("伤势按回目自然恢复：月结不回退 untilTurn（到期次月可出战）", () => {
    const game = createGame({ seed: "wire-rest", sectName: "接线宗" });
    discipleOf(game, "d-1").injury = { kind: "severe", untilTurn: 5 };
    const { state } = settleMonthly(game);
    assert.equal(state.currentTurn, 2);
    assert.equal(discipleOf(state, "d-1").injury?.untilTurn, 5);
    const { state: after2 } = settleMonthly(state);
    assert.equal(discipleOf(after2, "d-1").injury?.untilTurn, 5);
  });

  it("奇遇掉落接线：书入藏经阁、法宝（品阶 1–2 六种）与丹药入仓库", () => {
    for (let i = 0; i < 400; i++) {
      const seed = `wire-windfall-${i}`;
      if (eventAt(seed, 2) !== "windfall") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const { state, result } = settleMonthly(game);
      const reward = result.expedition?.reward;
      assert.ok(reward);
      if (reward.type === "gongfa_book") {
        assert.ok(state.library?.techniqueIds.includes(reward.techniqueId));
      } else if (reward.type === "spell_book") {
        assert.ok(state.library?.spellIds.includes(reward.spellId));
      } else if (reward.type === "gear") {
        const dropped = getTreasureById(reward.treasureId);
        assert.ok(dropped && dropped.tier <= 2);
        assert.ok(
          state.warehouse?.gear.some(
            (item) => item.slot === reward.slot && item.treasureId === reward.treasureId,
          ),
        );
      } else {
        assert.ok(
          state.warehouse?.pills.some(
            (entry) => entry.pillId === reward.pillId && entry.count === 1,
          ),
        );
      }
      return;
    }
    throw new Error("test_setup_windfall_seed_not_found");
  });

  it("丹药奇缘接线：随机丹药入仓库", () => {
    for (let i = 0; i < 400; i++) {
      const seed = `wire-pill-${i}`;
      if (eventAt(seed, 2) !== "pill") continue;
      const game = createGame({ seed, sectName: "接线宗" });
      const { state, result } = settleMonthly(game);
      const reward = result.expedition?.reward;
      assert.ok(reward?.type === "pill");
      assert.ok(
        state.warehouse?.pills.some((entry) => entry.pillId === reward.pillId && entry.count === 1),
      );
      return;
    }
    throw new Error("test_setup_pill_seed_not_found");
  });

  it("资源危机月停摆：不触发遭遇事件、声望不增", () => {
    const game = createGame({ seed: "wire-crisis", sectName: "接线宗" });
    const poor = structuredClone(game);
    // 无供奉收入（新局未分岗无挖矿）：内门膨胀到 53 人（俸禄 530）且灵石归零 → 危机。
    poor.spiritStones = 0;
    const template = poor.disciples[0];
    assert.ok(template);
    for (let i = 0; i < 50; i++) {
      poor.disciples.push({ ...template, id: `extra-${i}` });
    }
    const { state, result } = settleMonthly(poor);
    assert.equal(result.crisis, true);
    assert.equal(result.expedition, undefined);
    assert.equal(state.prestige, game.prestige);
  });
});
