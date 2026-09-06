// M2 红色契约（T-E00-F04-001）：历练遭遇与月结顺序 golden 红测。
// 数值锚点全部取自 docs/design/2026-09-06-小程序简化版设计.md §历练与遭遇 表格与 §月结流程 9 步顺序，
// 不从旧实现反抄。本文件只锁契约：expedition.ts（E03-F01）尚未实现 → 导入即红；
// settlement.ts 的月结顺序常量（E03-F02 契约）亦未导出。pnpm test 三次连跑退出码均非 0。
// 事件掷骰契约格式：deterministicRoll(`${state.seed}:expedition:${turn}`)，
// 区间 [0,50) 收获 / [50,65) 切磋 / [65,75) 掠夺 / [75,85) 奇遇 / [85,95) 危险 / [95,100) 丹药奇缘；
// 固定 seed 期望事件序列由 node:crypto sha256 独立对拍预计算写死（hash.test.ts 已证引擎 sha256 与之逐字节一致）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGame } from "./engine.js";
import {
  type ExpeditionEventKind,
  expeditionEventForRoll,
  injuryForRoll,
  settleExpedition,
} from "./expedition.js";
import { realmStageForLevel } from "./realms.js";
import { MONTHLY_STEP_ORDER } from "./settlement.js";
import type { Disciple } from "./state.js";

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
    role: overrides.role ?? "inner",
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
        atWar: false,
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
      assert.ok(windfall.reward.tier === 1 || windfall.reward.tier === 2);
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
    assert.ok(pill.reward.pillId === "p-yanshou" || pill.reward.pillId === "p-juling");
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

describe("月结流程 9 步顺序锚点（settlement 新增契约，E03-F02）", () => {
  it("经济→方针→真元突破→生产→历练→NPC→会战→声望胜负→年度衰老", () => {
    assert.deepEqual(MONTHLY_STEP_ORDER, [
      "economy",
      "policy",
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
    assert.ok(indexOf("production") < indexOf("expedition"));
    assert.ok(indexOf("rival") < indexOf("sectWar"));
    assert.equal(MONTHLY_STEP_ORDER[MONTHLY_STEP_ORDER.length - 1], "aging");
  });
});
