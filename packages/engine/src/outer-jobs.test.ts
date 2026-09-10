// 外门分工切片测试：配置校验 → 容量约束（含车间投入合计）→ 生效钳制 → 在岗口径
// → 经济对照（挖矿月入）→ 递补对照（练气携真元）→ 旧档兼容 → 确定性。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGame } from "./engine.js";
import {
  OUTER_MINING_STONES_PER_MONTH,
  OUTER_QI_ZHENYUAN_PER_WORKER,
  assignOuterJobs,
  effectiveOuterJobsOf,
  outerJobsOf,
  outerTotalOf,
  workingOuterCountOf,
  workshopStaffedOuterCount,
} from "./outer-jobs.js";
import { setWorkshopStaff } from "./production.js";
import { settleMonthly } from "./settlement.js";
import type { GameState } from "./state.js";

function newGame(seed = "outer-seed-1"): GameState {
  return createGame({ seed, sectName: "青云门" });
}

describe("外门分工配置", () => {
  it("外门总数恒等于宗门等级上限；新局无分工配置 = 未分岗", () => {
    const state = newGame();
    assert.equal(outerTotalOf(state), 100);
    assert.deepEqual(outerJobsOf(state), { mining: 0, qi: 0 });
    assert.equal(workshopStaffedOuterCount(state), 0);
    assert.equal(workingOuterCountOf(state), 0);
  });

  it("非法人数拒绝：负数 / 非整数", () => {
    const state = newGame();
    assert.throws(() => assignOuterJobs(state, { mining: -1 }), /outer_jobs_invalid/);
    assert.throws(() => assignOuterJobs(state, { qi: 1.5 }), /outer_jobs_invalid/);
  });

  it("配置落 state 并落纪事；无变化不落纪事", () => {
    let state = newGame();
    const before = state.chronicle.length;
    const outcome = assignOuterJobs(state, { mining: 10, qi: 5 });
    state = outcome.state;
    assert.deepEqual(outcome.jobs, { mining: 10, qi: 5 });
    assert.deepEqual(state.outerJobs, { mining: 10, qi: 5 });
    assert.equal(state.chronicle.length, before + 1);
    assert.ok(state.chronicle[0]?.text.includes("外门分工调整"));
    // 同配置幂等：不重复落纪事。
    const again = assignOuterJobs(state, { mining: 10, qi: 5 });
    assert.equal(again.state.chronicle.length, before + 1);
  });

  it("容量约束：挖矿/练气与车间投入合计不得超过外门总数", () => {
    let state = newGame();
    // 本次请求各岗合计 > 外门总数即拒绝。
    assert.throws(() => assignOuterJobs(state, { mining: 100, qi: 1 }), /outer_jobs_over_capacity/);
    state = assignOuterJobs(state, { mining: 100 }).state;
    // 车间投入计入同一容量：丹房 60 人后，挖矿+练气至多 40。
    state = setWorkshopStaff(newGame(), "pill", 60).state;
    assert.throws(() => assignOuterJobs(state, { mining: 40, qi: 1 }), /outer_jobs_over_capacity/);
    const ok = assignOuterJobs(state, { mining: 40, qi: 0 });
    assert.deepEqual(ok.jobs, { mining: 40, qi: 0 });
  });
});

describe("生效钳制与在岗口径", () => {
  it("异常超编按 挖矿→练气 钳制（只读，不改配置）", () => {
    // 入口校验拒绝超编，异常数据只能经直写 state 构造（旧档兼容路径）。
    const state = setWorkshopStaff(newGame(), "pill", 20).state;
    state.outerJobs = { mining: 80, qi: 30 };
    // 剩余容量 = 100 − 20 = 80：挖矿 80 全保留、练气钳到 0。
    assert.deepEqual(effectiveOuterJobsOf(state), { mining: 80, qi: 0 });
    // 配置本身不被改动。
    assert.deepEqual(outerJobsOf(state), { mining: 80, qi: 30 });
    // 在岗合计 = 车间 20 + 挖矿 80 + 练气 0 = 100（恒 ≤ 外门总数）。
    assert.equal(workingOuterCountOf(state), 100);
  });

  it("正常配置即生效；车间投入计入在岗合计", () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 30).state;
    state = setWorkshopStaff(state, "gear", 20).state;
    state = assignOuterJobs(state, { mining: 25, qi: 15 }).state;
    assert.equal(workshopStaffedOuterCount(state), 50);
    assert.deepEqual(effectiveOuterJobsOf(state), { mining: 25, qi: 15 });
    assert.equal(workingOuterCountOf(state), 90);
  });
});

describe("经济对照（挖矿月入）与递补对照（练气携真元）", () => {
  it("挖矿在编每人每月上缴 1 灵石（月结收入对照，其余口径同 seed 恒同）", () => {
    const base = newGame("outer-econ");
    const withMining = assignOuterJobs(base, { mining: 10 }).state;
    const plain = settleMonthly(base);
    const mined = settleMonthly(withMining);
    assert.equal(
      mined.result.spiritStonesDelta - plain.result.spiritStonesDelta,
      10 * OUTER_MINING_STONES_PER_MONTH,
    );
  });

  it("练气在编为递补弟子带来初始真元（每人 20 点，年审坐化递补对照）", () => {
    const setup = (qi: number): GameState => {
      // seed 沿用 engine.test 坐化用例：d-1 将在第 12 月坐化（19 + 1 ≥ 有效坐化年龄 20）。
      let state = newGame("slice-seed-1");
      if (qi > 0) state = assignOuterJobs(state, { qi }).state;
      const dying = state.disciples.find((entry) => entry.id === "d-1");
      assert.ok(dying);
      dying.maxLifespan = 20;
      dying.age = 19;
      for (let i = 0; i < 12; i++) state = settleMonthly(state).state;
      const promoted = state.disciples.find((entry) => !["d-1", "d-2", "d-3"].includes(entry.id));
      assert.ok(promoted, "坐化递补应生成新弟子");
      return state;
    };
    const without = setup(0);
    const withFive = setup(5);
    const fresh = without.disciples.find((entry) => !["d-1", "d-2", "d-3"].includes(entry.id));
    const promoted = withFive.disciples.find((entry) => !["d-1", "d-2", "d-3"].includes(entry.id));
    assert.ok(fresh && promoted);
    assert.equal(promoted.zhenyuan - fresh.zhenyuan, 5 * OUTER_QI_ZHENYUAN_PER_WORKER);
    assert.ok(withFive.chronicle.some((entry) => entry.text.includes("携练气真元 100 点")));
  });
});

describe("旧档兼容与确定性", () => {
  it("旧档缺 outerJobs 字段：按未分岗口径工作，月结照常", () => {
    const state = newGame();
    assert.equal(state.outerJobs, undefined);
    const { state: after } = settleMonthly(state);
    assert.equal(after.currentTurn, 2);
    assert.deepEqual(outerJobsOf(after), { mining: 0, qi: 0 });
  });

  it("同 seed 双跑 deepEqual", () => {
    const run = (): GameState => {
      let state = newGame("outer-det");
      state = setWorkshopStaff(state, "pill", 40).state;
      state = assignOuterJobs(state, { mining: 30, qi: 20 }).state;
      state = settleMonthly(state).state;
      return state;
    };
    assert.deepEqual(run(), run());
  });
});
