// 会话仓库单测：开局/读档续玩/推进/招募/管理命令 action 与会战三战报回放数据。
// 持久化（自动档）在 UI 层 use-game，本层只验证内存快照与引擎命令接线。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deterministicRoll,
  expeditionEventForRoll,
  listRecruitCandidates,
} from "@simple-xiuxian/engine";
import { createGameStore } from "./game-store.js";

describe("会话仓库冒烟", () => {
  it("创建游戏→推进 3 月→回合数前进", () => {
    const store = createGameStore();
    assert.equal(store.getState().state, null);
    assert.equal(
      store.newGame({ sectName: "测试宗门", seed: "seed-001", difficulty: "normal" }),
      true,
    );
    assert.equal(store.getState().state?.currentTurn, 1);
    for (let i = 0; i < 3; i++) store.settleMonth();
    assert.equal(store.getState().state?.currentTurn, 4);
  });

  it("非法宗门名被拒绝并给出可读错误", () => {
    const store = createGameStore();
    assert.equal(store.newGame({ sectName: "门", seed: "seed-003", difficulty: "easy" }), false);
    assert.ok(store.getState().errorMessage);
  });

  it("招募弟子走引擎命令（直入内门，外门只是数字）", () => {
    const store = createGameStore();
    store.newGame({ sectName: "招募宗门", seed: "seed-004", difficulty: "normal" });
    const before = store.getState().state;
    assert.ok(before);
    const first = listRecruitCandidates(before)[0];
    assert.ok(first);
    store.recruit(first.candidateId);
    const after = store.getState().state;
    assert.ok(after);
    assert.equal(after.disciples.length, before.disciples.length + 1);
    assert.equal(after.spiritStones, before.spiritStones - 300);
  });

  it("120 月推进冒烟：终局即停摆，否则回合数走满", () => {
    const store = createGameStore();
    store.newGame({ sectName: "长跑宗门", seed: "size-001", difficulty: "normal" });
    for (let i = 0; i < 120; i++) store.settleMonth();
    const state = store.getState().state;
    assert.ok(state);
    assert.ok(state.ending !== null || state.currentTurn === 121);
  });

  it("loadGame 读档续玩：以存档状态与难度替换会话，清空弹层/报错", () => {
    // 先跑一局并推进数月，取出状态作为"存档"。
    const origin = createGameStore();
    assert.equal(
      origin.newGame({ sectName: "存档宗门", seed: "load-001", difficulty: "hard" }),
      true,
    );
    for (let i = 0; i < 3; i++) origin.settleMonth();
    const savedState = origin.getState().state;
    assert.ok(savedState);
    const savedTurn = savedState.currentTurn;
    const savedStones = savedState.spiritStones;

    // 模拟刷新后新建会话：无状态，读档恢复。
    const store = createGameStore();
    assert.equal(store.getState().state, null);
    store.loadGame(savedState, "hard");

    const state = store.getState().state;
    assert.ok(state);
    assert.equal(state.currentTurn, savedTurn);
    assert.equal(state.spiritStones, savedStones);
    assert.equal(state.sectName, "存档宗门");
    assert.equal(store.getState().difficulty, "hard");
    assert.equal(store.getState().lastResult, null);
    assert.equal(store.getState().errorMessage, null);
  });
});

describe("管理命令 action（引擎命令接线）", () => {
  it("主持任命/卸任 + 丹房挂任务免费、外门投入校验", () => {
    const store = createGameStore();
    store.newGame({ sectName: "丹房宗门", seed: "mng-001", difficulty: "normal" });
    const inner = store.getState().state?.disciples.find((d) => d.id === "d-1");
    assert.ok(inner);
    store.assignJob("pill", inner.id);
    assert.deepEqual(store.getState().state?.jobs?.pill.workers, [inner.id]);
    // 挂任务免费：灵石不动、任务即挂（不选丹方，统一点数）。
    const beforeStones = store.getState().state?.spiritStones ?? 0;
    store.setPillTask();
    assert.equal(store.getState().state?.spiritStones, beforeStones);
    assert.deepEqual(store.getState().state?.jobs?.pill.task, {
      kind: "pill",
      accumulatedPoints: 0,
    });
    // 投入人数超出上限（各岗合计 > 100）→ 拒绝并给出可读错误。
    store.setStaff("pill", 60);
    store.setStaff("gear", 50);
    assert.ok(store.getState().errorMessage?.includes("人手不足"));
    store.clearError();
    store.setStaff("gear", 40);
    assert.equal(store.getState().state?.jobs?.gear.assignedOuter, 40);
    store.removeJob("pill", inner.id);
    assert.deepEqual(store.getState().state?.jobs?.pill.workers, []);
  });

  it("宣战 → 来月全军会战 → 三份战报可回放（开局我方 3 人全员出战，逐回合记录）", () => {
    // 选定首月历练为「收获」的 seed：历练月无战斗无伤势，保证开局 3v4 全员成阵（对手 4 人取前 3 配对）。
    let seed: string | undefined;
    for (let i = 0; i < 500 && !seed; i++) {
      const candidate = `war-${String(i).padStart(3, "0")}`;
      if (expeditionEventForRoll(deterministicRoll(`${candidate}:expedition:2`)) === "harvest") {
        seed = candidate;
      }
    }
    assert.ok(seed, "test_setup_harvest_seed_not_found");
    const store = createGameStore();
    store.newGame({ sectName: "会战宗门", seed, difficulty: "normal" });
    store.wageWar();
    assert.equal(store.getState().state?.warWithRival, true);
    store.settleMonth();
    const state = store.getState().state;
    assert.ok(state);
    assert.equal(state.warWithRival, false);
    assert.equal((state.sectWars ?? []).length, 1);
    const record = (state.sectWars ?? [])[0];
    assert.ok(record);
    assert.equal(record.pairOutcomes.length, 3);
    assert.ok(state.battles);
    assert.ok(state.battles.length >= 3, "会战三份战报入 state.battles");
    // 回放数据同源：战报含逐回合 action、终局生命与会战来源标记。
    for (const report of state.battles.slice(0, 3)) {
      assert.ok(report.actions.length > 0);
      assert.ok(report.finalHp.A >= 0 && report.finalHp.B >= 0);
      assert.equal(report.source, "sect-war");
      assert.equal(report.turn, state.currentTurn);
    }
  });

  it("研读/服丹负路径可读 + 长老任命走引擎", () => {
    const store = createGameStore();
    // 藏经阁为空 → 研读被拒；仓库无丹药 → 服丹被拒（错误文案可读）。
    store.newGame({ sectName: "命令宗门", seed: "mng-002", difficulty: "normal" });
    const disciple = store.getState().state?.disciples.find((d) => d.id === "d-1");
    assert.ok(disciple);
    store.study(disciple.id, "tech-hunyuan");
    assert.ok(store.getState().errorMessage?.includes("藏经阁"));
    store.clearError();
    store.takePill(disciple.id, "pill-yanshou");
    assert.ok(store.getState().errorMessage?.includes("仓库"));
    store.clearError();
    store.appointElder(disciple.id, "resource");
    assert.equal(store.getState().state?.elders?.resource, disciple.id);
  });

  it("自动服用丹药开关：走引擎落档，关断后字段置空", () => {
    const store = createGameStore();
    store.newGame({ sectName: "自动服药宗门", seed: "mng-003", difficulty: "normal" });
    const disciple = store.getState().state?.disciples.find((d) => d.id === "d-1");
    assert.ok(disciple);
    store.setAutoPill(disciple.id, "pill-yanshou", true);
    store.setAutoPill(disciple.id, "pill-juling", true);
    const autoOn = store.getState().state?.disciples.find((d) => d.id === disciple.id);
    assert.equal(autoOn?.autoPillYanshou, true);
    assert.equal(autoOn?.autoPillJuling, true);
    store.setAutoPill(disciple.id, "pill-yanshou", false);
    const autoOff = store.getState().state?.disciples.find((d) => d.id === disciple.id);
    assert.equal(autoOff?.autoPillYanshou, undefined);
    assert.equal(store.getState().errorMessage, null);
    // 非法丹药 id 走可读错误。
    store.setAutoPill(disciple.id, "pill-unknown", true);
    assert.ok(store.getState().errorMessage?.includes("丹药"));
  });
});
