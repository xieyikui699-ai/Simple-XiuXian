// 丹房/器坊生产切片测试：主持任命 → 外门投入（滑杆）→ 挂任务 → 月结推进（月耗/加速/封顶）
// → 出炉连炉（丹方随机各半、法宝十选一随机）→ 超编裁剪 → 旧档兼容（旧点数池/旧 pill/gear 任务迁移）→ 确定性。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURES } from "./catalog.js";
import { createGame } from "./engine.js";
import { deterministicRoll } from "./hash.js";
import {
  ADULT_AGE,
  GEAR_MONTHLY_PROGRESS_CAP_RATIO,
  GEAR_TASK_POINTS,
  PILL_COST_PER_OUTER_MONTH,
  PILL_TASK_POINTS,
  WORKSHOP_MASTER_LIMIT,
  advanceWorkshops,
  assignWorkshopJob,
  estimateCraftMonths,
  jobsOf,
  removeWorkshopJob,
  rollCraftTreasure,
  setWorkshopStaff,
  startWorkshopTask,
  warehouseOf,
  workshopAppointmentBlockReason,
  workshopPauseReason,
  workshopSpeedMultiplier,
  workshopTaskTotalPoints,
} from "./production.js";
import { settleMonthly } from "./settlement.js";
import type { GameState } from "./state.js";

/** 出炉法宝掷骰对拍：引擎导出的 rollCraftTreasure（`${seed}:gear-craft:${turn}` 十等分取目录）。 */
function expectedTreasureId(seed: string, turn: number): string {
  return rollCraftTreasure(seed, turn).id;
}

function newGame(seed = "prod-seed-1"): GameState {
  return createGame({ seed, sectName: "青云门" });
}

/** 模拟 M2 之前的旧档快照：剥掉所有扩展字段。 */
function stripM2Fields(state: GameState): GameState {
  const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  const { library: _library, jobs: _jobs, warehouse: _warehouse, ...legacy } = raw;
  const disciples = (legacy.disciples as Record<string, unknown>[]).map((disciple) => {
    const { techniqueId: _t, spellIds: _s, equippedGear: _e, ...rest } = disciple;
    return rest;
  });
  return { ...legacy, disciples } as unknown as GameState;
}

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} ≈ ${expected} (±${epsilon})`,
  );
}

function taskProgress(state: GameState, kind: "pill" | "gear"): number {
  const task = jobsOf(state)[kind].task;
  return task ? task.accumulatedPoints : -1;
}

/** 全链路场景：任命两房主持 → 投入外门（投入即自动开炉）→ 推进 4 月（丹/器各出炉 ≥1）。 */
function productionScenario(seed: string): GameState {
  let state = newGame(seed);
  state = assignWorkshopJob(state, "pill", "d-1").state;
  state = assignWorkshopJob(state, "gear", "d-2").state;
  // 3 级宗门外门 500：器坊 420（×1.2 触 60% 封顶 300 点/月）第 2/4 月各出炉一炉；
  // 丹房 80（96 点/月）第 4 月出炉。
  state = { ...state, sectRank: 3 };
  state = setWorkshopStaff(state, "pill", 80).state;
  state = setWorkshopStaff(state, "gear", 420).state;
  state = startWorkshopTask(state, "pill", { kind: "pill" }).state;
  state = startWorkshopTask(state, "gear", { kind: "gear" }).state;
  for (let i = 0; i < 4; i++) {
    state = advanceWorkshops(state).state;
  }
  return state;
}

describe("主持任命", () => {
  it("无职成年弟子可任命，每房至多 1 名主持", () => {
    let state = newGame();
    assert.equal(WORKSHOP_MASTER_LIMIT, 1);
    state = assignWorkshopJob(state, "pill", "d-1").state;
    assert.deepEqual(jobsOf(state).pill.workers, ["d-1"]);
    assert.throws(() => assignWorkshopJob(state, "pill", "d-2"), /workshop_job_full/);
  });

  it("同一弟子不可兼任两房主持（长老互斥同口径）", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    assert.throws(() => assignWorkshopJob(state, "gear", "d-1"), /disciple_job_busy/);
    state = assignWorkshopJob(state, "gear", "d-2").state;
    assert.deepEqual(jobsOf(state).gear.workers, ["d-2"]);
  });

  it("任命校验：未成年 / 不存在弟子（名册全员内门）", () => {
    const state = newGame();
    const inner = state.disciples.find((entry) => entry.age >= ADULT_AGE);
    assert.ok(inner);
    const minor = { ...structuredClone(inner), id: "d-minor", age: ADULT_AGE - 1 };
    const withMinor = { ...structuredClone(state), disciples: [minor, ...state.disciples] };
    assert.equal(
      workshopAppointmentBlockReason(withMinor, "pill", "d-minor"),
      "disciple_not_adult",
    );
    assert.equal(workshopAppointmentBlockReason(state, "pill", "d-missing"), "disciple_not_found");
  });

  it("卸任：只移除本房主持", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = removeWorkshopJob(state, "pill", "d-1").state;
    assert.deepEqual(jobsOf(state).pill.workers, []);
    assert.throws(() => removeWorkshopJob(state, "pill", "d-1"), /workshop_job_not_held/);
  });

  it("主持产速乘数：境界加成每级 +20%（元婴 +200% 封顶）、丹道天赋再 +20%、无主持恒 1", () => {
    let state = newGame();
    assert.equal(workshopSpeedMultiplier(state, "pill"), 1);
    state = assignWorkshopJob(state, "pill", "d-1").state;
    // 练气前期（1 级）：境界加成 +20%。
    assert.ok(Math.abs(workshopSpeedMultiplier(state, "pill") - 1.2) < 1e-9);
    const alchemist = state.disciples.find((entry) => entry.id === "d-1");
    assert.ok(alchemist);
    alchemist.talentIds = ["t-pill-talent"];
    assert.ok(Math.abs(workshopSpeedMultiplier(state, "pill") - 1.4) < 1e-9);
    // 元婴前期（10 级）：境界加成 +200% 封顶（天赋加成合计也挤不破顶）。
    alchemist.realmLevel = 10;
    assert.ok(Math.abs(workshopSpeedMultiplier(state, "pill") - 3) < 1e-9);
    // 天赋不跨房：器坊无主持恒 1。
    assert.equal(workshopSpeedMultiplier(state, "gear"), 1);
  });
});

describe("外门投入（滑杆）", () => {
  it("投入人数即时生效；两房合计不得超过外门总数", () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 60).state;
    assert.equal(jobsOf(state).pill.assignedOuter, 60);
    state = setWorkshopStaff(state, "gear", 40).state;
    assert.equal(jobsOf(state).gear.assignedOuter, 40);
    // 60 + 41 > 100 → 拒绝。
    assert.throws(() => setWorkshopStaff(state, "pill", 61), /workshop_outer_insufficient/);
    // 上调时另一房投入计入约束：外门 100 已占满（60+40），器坊加 1 即越界。
    assert.throws(() => setWorkshopStaff(state, "gear", 41), /workshop_outer_insufficient/);
  });

  it("非法人数：负数 / 非整数 / 超单房上限", () => {
    const state = newGame();
    assert.throws(() => setWorkshopStaff(state, "pill", -1), /workshop_staff_invalid/);
    assert.throws(() => setWorkshopStaff(state, "pill", 1.5), /workshop_staff_invalid/);
    assert.throws(() => setWorkshopStaff(state, "pill", 501), /workshop_staff_over_cap/);
  });
});

describe("在炉任务（挂任务免费，换任务进度作废）", () => {
  it("挂炼丹任务不选丹方、不扣灵石（统一点数）；器坊挂法宝任务同样免费；房间不匹配拒绝", () => {
    const state = { ...newGame(), spiritStones: 2000 };
    const { state: after } = startWorkshopTask(state, "pill", { kind: "pill" });
    assert.equal(after.spiritStones, 2000);
    assert.deepEqual(jobsOf(after).pill.task, { kind: "pill", accumulatedPoints: 0 });
    assert.equal(after.chronicle[0]?.text.includes("出炉随机"), true);
    assert.throws(
      () => startWorkshopTask(state, "pill", { kind: "gear" }),
      /workshop_task_mismatch/,
    );
    // 器坊：无图纸点选，挂任务即炼法宝（出炉随机目录十件其一）。
    const { state: gearState } = startWorkshopTask(state, "gear", { kind: "gear" });
    assert.deepEqual(jobsOf(gearState).gear.task, { kind: "gear", accumulatedPoints: 0 });
    assert.ok(gearState.chronicle[0]?.text.includes("10 种法宝其一"));
  });

  it("同任务幂等（进度保留）：丹房/器坊重复挂任务均幂等", () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 10).state;
    state = startWorkshopTask(state, "pill", { kind: "pill" }).state;
    state = advanceWorkshops(state).state;
    const progress = taskProgress(state, "pill");
    assert.ok(progress > 0);
    // 丹房重复挂任务：恒为同任务，幂等，进度保留。
    const { state: same } = startWorkshopTask(state, "pill", { kind: "pill" });
    closeTo(taskProgress(same, "pill"), progress);
    // 器坊同理：法宝任务无目标可选，重复挂任务幂等。
    state = setWorkshopStaff(state, "gear", 5).state;
    state = startWorkshopTask(state, "gear", { kind: "gear" }).state;
    state = advanceWorkshops(state).state;
    const gearProgress = taskProgress(state, "gear");
    assert.ok(gearProgress > 0);
    const { state: sameGear } = startWorkshopTask(state, "gear", { kind: "gear" });
    closeTo(taskProgress(sameGear, "gear"), gearProgress);
  });
});

describe("月结推进（月耗 / 加速 / 封顶 / 出炉连炉）", () => {
  it("投入即自动开炉（无需主持/无需点选）；抽走人手停摆（不推进不扣费），回填人手续炼", () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 10).state;
    assert.deepEqual(
      jobsOf(state).pill.task,
      { kind: "pill", accumulatedPoints: 0 },
      "投入即自动开炉",
    );
    assert.equal(workshopPauseReason(state, "pill"), undefined, "有任务有人正常运转");
    state = setWorkshopStaff(state, "pill", 0).state;
    assert.equal(workshopPauseReason(state, "pill"), "no_staff");
    const { state: paused } = advanceWorkshops(state);
    assert.equal(taskProgress(paused, "pill"), 0, "无人不推进");
    assert.equal(paused.spiritStones, state.spiritStones, "无人不扣月耗");
    const { state: resumed } = advanceWorkshops(setWorkshopStaff(paused, "pill", 10).state);
    closeTo(taskProgress(resumed, "pill"), 10); // 回填人手后恢复推进
  });

  it(`20 人炼丹（无主持）：每月 +20 点扣 20 灵石，15 月出炉连炉（统一点数 ${PILL_TASK_POINTS}）`, () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 20).state;
    let result = advanceWorkshops(state);
    closeTo(taskProgress(result.state, "pill"), 20);
    assert.equal(result.state.spiritStones, 2000 - 20 * PILL_COST_PER_OUTER_MONTH);
    assert.deepEqual(result.completedPills, []);
    for (let i = 1; i < 14; i++) result = advanceWorkshops(result.state);
    closeTo(taskProgress(result.state, "pill"), 280);
    result = advanceWorkshops(result.state);
    // 第 15 月满点出炉：丹方由确定性掷骰 `${seed}:pill-craft:${turn}` 决定（本测试直推未月结，turn 恒 1）。
    const expectedPillId =
      deterministicRoll("prod-seed-1:pill-craft:1") < 50 ? "pill-yanshou" : "pill-juling";
    assert.deepEqual(result.completedPills, [{ pillId: expectedPillId, count: 1 }]);
    assert.deepEqual(warehouseOf(result.state).pills, [{ pillId: expectedPillId, count: 1 }]);
    assert.ok(result.state.chronicle.some((entry) => entry.text.includes("丹房出炉")));
    // 连炉：进度清零续炼同任务（不选丹方）。
    assert.deepEqual(jobsOf(result.state).pill.task, { kind: "pill", accumulatedPoints: 0 });
  });

  it("主持境界加成 +20%（练气前期）、丹道天赋再 +20%；主持离册自动失效退化为 1", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = setWorkshopStaff(state, "pill", 10).state;
    const { state: after } = advanceWorkshops(state);
    closeTo(taskProgress(after, "pill"), 12, 1e-9);
    // 丹道天赋：12 → 14。
    const alchemist = state.disciples.find((entry) => entry.id === "d-1");
    assert.ok(alchemist);
    alchemist.talentIds = ["t-pill-talent"];
    const { state: talented } = advanceWorkshops(state);
    closeTo(taskProgress(talented, "pill"), 14, 1e-9);
    // 主持离册：退化为无加成 10，且自动离岗。
    state.disciples = state.disciples.filter((entry) => entry.id !== "d-1");
    const { state: masterGone } = advanceWorkshops(state);
    closeTo(taskProgress(masterGone, "pill"), 10);
    assert.deepEqual(jobsOf(masterGone).pill.workers, [], "离册主持自动离岗");
  });

  it(`器坊月推进封顶 60%：500 人炼法宝（${GEAR_TASK_POINTS} 点）单月至多 300 点，2 月出炉`, () => {
    let state = newGame();
    state = { ...state, sectRank: 3 };
    state = setWorkshopStaff(state, "gear", 500).state;
    state = startWorkshopTask(state, "gear", { kind: "gear" }).state;
    assert.equal(GEAR_MONTHLY_PROGRESS_CAP_RATIO, 0.6);
    let result = advanceWorkshops(state);
    closeTo(taskProgress(result.state, "gear"), 300);
    assert.deepEqual(result.completedGear, []);
    result = advanceWorkshops(result.state);
    // 出炉法宝由确定性掷骰 `${seed}:gear-craft:${turn}` 十选一（直推未月结，turn 恒 1）。
    const expectedGear = {
      slot: "talisman" as const,
      treasureId: expectedTreasureId("prod-seed-1", 1),
    };
    assert.deepEqual(result.completedGear, [expectedGear]);
    assert.deepEqual(warehouseOf(result.state).gear, [expectedGear]);
    assert.ok(result.state.chronicle.some((entry) => entry.text.includes("器坊出炉")));
    assert.deepEqual(jobsOf(result.state).gear.task, { kind: "gear", accumulatedPoints: 0 });
  });

  it("灵石不敷月耗：当月停摆（no_funds），不推进不扣费；回血后恢复", () => {
    let state = newGame();
    state = setWorkshopStaff(state, "pill", 20).state;
    state = { ...state, spiritStones: 19 };
    assert.equal(workshopPauseReason(state, "pill"), "no_funds");
    const { state: after } = advanceWorkshops(state);
    assert.equal(after.spiritStones, 19);
    closeTo(taskProgress(after, "pill"), 0);
    const { state: resumed } = advanceWorkshops({ ...after, spiritStones: 20 });
    closeTo(taskProgress(resumed, "pill"), 20);
  });

  it("出炉预估与停摆推导、任务点数表（UI 展示口径）", () => {
    let state = newGame();
    assert.equal(estimateCraftMonths(state, "pill"), undefined, "空闲无预估");
    state = setWorkshopStaff(state, "pill", 20).state;
    assert.equal(estimateCraftMonths(state, "pill"), 15);
    state = setWorkshopStaff(state, "pill", 0).state;
    assert.equal(estimateCraftMonths(state, "pill"), undefined);
    assert.equal(workshopPauseReason(state, "pill"), "no_staff");
    assert.equal(PILL_TASK_POINTS, 300);
    assert.equal(GEAR_TASK_POINTS, 500);
    assert.equal(workshopTaskTotalPoints({ kind: "pill", accumulatedPoints: 0 }), PILL_TASK_POINTS);
    assert.equal(workshopTaskTotalPoints({ kind: "gear", accumulatedPoints: 0 }), GEAR_TASK_POINTS);
  });
});

describe("月结接线与旧档兼容", () => {
  it("月结第 ④ 步推进生产：当月出炉、月耗并入当月灵石", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    const master = state.disciples.find((entry) => entry.id === "d-1");
    assert.ok(master);
    master.realmLevel = 10; // 元婴前期：境界加成 +200% → 100 人 × 3 = 300 点，当月满点出炉
    state = setWorkshopStaff(state, "pill", 100).state;
    const { state: after, result } = settleMonthly(state);
    // 月结在生产步前先推进 currentTurn：出炉掷骰命名空间取结算月（turn = 2）。
    const expectedPillId =
      deterministicRoll("prod-seed-1:pill-craft:2") < 50 ? "pill-yanshou" : "pill-juling";
    assert.deepEqual(warehouseOf(after).pills, [{ pillId: expectedPillId, count: 1 }]);
    // 经济：月结 delta（挖矿 − 俸禄 ± 历练）之外，生产月耗 100 灵石直接结算。
    assert.equal(
      after.spiritStones,
      state.spiritStones + result.spiritStonesDelta - 100 * PILL_COST_PER_OUTER_MONTH,
    );
  });

  it("出炉丹方各 50%：同 seed 确定性、长跑分布接近对半", () => {
    const runDistribution = (): Record<string, number> => {
      let state: GameState = {
        ...newGame("pill-dist"),
        spiritStones: 1_000_000,
      };
      state = setWorkshopStaff(state, "pill", 30).state;
      state = startWorkshopTask(state, "pill", { kind: "pill" }).state;
      const counts: Record<string, number> = {};
      for (let turn = 2; turn <= 1002; turn++) {
        // 直推月度生产并按月翻新掷骰游标（月结真实顺序：先 +1 再推进生产）。
        const { state: after, completedPills } = advanceWorkshops({
          ...state,
          currentTurn: turn,
        });
        state = after;
        for (const entry of completedPills) {
          counts[entry.pillId] = (counts[entry.pillId] ?? 0) + 1;
        }
      }
      return counts;
    };
    const counts = runDistribution();
    assert.deepEqual(counts, runDistribution(), "同 seed 双跑分布完全一致");
    const total = (counts["pill-yanshou"] ?? 0) + (counts["pill-juling"] ?? 0);
    assert.equal(total, 100, "30 人每 10 月出炉一炉：1001 月共 100 炉");
    assert.ok((counts["pill-yanshou"] ?? 0) > 0, "延寿丹应出过炉");
    assert.ok((counts["pill-juling"] ?? 0) > 0, "聚灵丹应出过炉");
    const yanshouPct = ((counts["pill-yanshou"] ?? 0) / total) * 100;
    assert.ok(
      yanshouPct > 30 && yanshouPct < 70,
      `延寿丹占比 ${yanshouPct.toFixed(1)}% 应接近 50%`,
    );
  });

  it("旧档缺 jobs/warehouse：按空值口径工作，advanceWorkshops 物化扩展字段", () => {
    const legacy = stripM2Fields(newGame());
    assert.deepEqual(jobsOf(legacy), {
      pill: { workers: [], assignedOuter: 0, task: null },
      gear: { workers: [], assignedOuter: 0, task: null },
    });
    assert.deepEqual(warehouseOf(legacy), { gear: [], pills: [] });
    const advanced = advanceWorkshops(legacy);
    assert.ok(advanced.state.jobs);
    assert.ok(advanced.state.warehouse);
  });

  it("旧档 pill 任务带 pillId：读时剥离，进度保留", () => {
    const legacy = newGame();
    legacy.jobs = {
      pill: {
        workers: ["d-1"],
        assignedOuter: 10,
        task: { kind: "pill", pillId: "pill-juling", accumulatedPoints: 25 },
      } as never,
      gear: { workers: [], assignedOuter: 0, task: null },
    };
    assert.deepEqual(jobsOf(legacy).pill, {
      workers: ["d-1"],
      assignedOuter: 10,
      task: { kind: "pill", accumulatedPoints: 25 },
    });
  });

  it("旧档 gear 任务带 slot/tier：读时剥离，进度保留（出炉改十件随机其一）", () => {
    const legacy = newGame();
    legacy.jobs = {
      pill: { workers: [], assignedOuter: 0, task: null },
      gear: {
        workers: [],
        assignedOuter: 10,
        task: { kind: "gear", slot: "talisman", tier: 2, accumulatedPoints: 120 },
      } as never,
    };
    assert.deepEqual(jobsOf(legacy).gear, {
      workers: [],
      assignedOuter: 10,
      task: { kind: "gear", accumulatedPoints: 120 },
    });
  });

  it("旧档岗位点数池结构（points/tasks）读时归零迁移：主持保首位、其余丢弃", () => {
    const legacy = newGame();
    legacy.jobs = {
      pill: {
        workers: ["d-1", "d-2"],
        points: 90,
        tasks: [{ pillId: "pill-juling", monthsLeft: 1 }],
      } as never,
      gear: { workers: [], points: 30, tasks: [] } as never,
    };
    assert.deepEqual(jobsOf(legacy).pill, { workers: ["d-1"], assignedOuter: 0, task: null });
    assert.deepEqual(jobsOf(legacy).gear, { workers: [], assignedOuter: 0, task: null });
    const { state } = settleMonthly(legacy);
    assert.ok(state.jobs);
  });

  it("新档初始即带空扩展字段", () => {
    const state = newGame();
    assert.deepEqual(state.jobs, {
      pill: { workers: [], assignedOuter: 0, task: null },
      gear: { workers: [], assignedOuter: 0, task: null },
    });
    assert.deepEqual(state.warehouse, { gear: [], pills: [] });
  });

  it("旧档 M1 月结不回归：JSON 往返后月结照常", () => {
    const legacy = stripM2Fields(newGame());
    const restored = JSON.parse(JSON.stringify(legacy)) as GameState;
    const { state } = settleMonthly(restored);
    assert.equal(state.currentTurn, 2);
    assert.equal(state.jobs, undefined);
  });
});

describe("生产确定性", () => {
  it("同 seed 双跑 deepEqual，不同 seed 不同", () => {
    const a = productionScenario("prod-long-run");
    const b = productionScenario("prod-long-run");
    assert.deepEqual(a, b);
    const c = productionScenario("prod-other");
    assert.notDeepEqual(a, c);
  });

  it("生产全链路终态：丹药与法宝入仓库、纪事齐备、连炉归零", () => {
    const state = productionScenario("prod-scenario-check");
    // 器坊法宝 500 点、月推进封顶 300 点（420 人 ×1.2 触顶）：第 2/4 月各出炉一炉（连炉两轮）。
    // 直推未月结 turn 恒 1，两炉掷骰同命名空间 → 同一法宝出炉两次。
    const expectedGear = {
      slot: "talisman" as const,
      treasureId: expectedTreasureId("prod-scenario-check", 1),
    };
    assert.deepEqual(warehouseOf(state).gear, [expectedGear, expectedGear]);
    // 丹房第 4 月出炉（主持练气前期 ×1.2：96/月 → 384 ≥ 300）：丹方由确定性掷骰决定（直推未月结，turn 恒 1）。
    const expectedPillId =
      deterministicRoll("prod-scenario-check:pill-craft:1") < 50 ? "pill-yanshou" : "pill-juling";
    assert.deepEqual(warehouseOf(state).pills, [{ pillId: expectedPillId, count: 1 }]);
    assert.ok(state.chronicle.some((entry) => entry.text.includes("丹房出炉")));
    assert.ok(state.chronicle.some((entry) => entry.text.includes("器坊出炉")));
    // 双双出炉归零、当月超出点数不结转。
    closeTo(taskProgress(state, "pill"), 0, 1e-9);
    closeTo(taskProgress(state, "gear"), 0, 1e-9);
  });

  it("出炉法宝十选一：同 seed 确定性、长跑十种全出现过且分布近似均匀", () => {
    const runDistribution = (): Record<string, number> => {
      let state: GameState = {
        ...newGame("gear-dist"),
        sectRank: 3,
        spiritStones: 1_000_000,
      };
      state = setWorkshopStaff(state, "gear", 500).state;
      state = startWorkshopTask(state, "gear", { kind: "gear" }).state;
      const counts: Record<string, number> = {};
      for (let turn = 2; turn <= 1002; turn++) {
        // 直推月度生产并按月翻新掷骰游标（月结真实顺序：先 +1 再推进生产）。
        const { state: after, completedGear } = advanceWorkshops({
          ...state,
          currentTurn: turn,
        });
        state = after;
        for (const entry of completedGear) {
          counts[entry.treasureId] = (counts[entry.treasureId] ?? 0) + 1;
        }
      }
      return counts;
    };
    const counts = runDistribution();
    assert.deepEqual(counts, runDistribution(), "同 seed 双跑分布完全一致");
    const total = TREASURES.reduce((sum, treasure) => sum + (counts[treasure.id] ?? 0), 0);
    // 500 人触 60% 封顶 300 点/月：约每 2 月出炉一炉，1001 月共约 500 炉。
    assert.ok(total > 400, `出炉总数 ${total} 应在 400+`);
    for (const treasure of TREASURES) {
      const share = (counts[treasure.id] ?? 0) / total;
      assert.ok(
        (counts[treasure.id] ?? 0) > 0 && share > 0.02 && share < 0.2,
        `${treasure.name} 占比 ${(share * 100).toFixed(1)}% 应接近 10%`,
      );
    }
  });
});
