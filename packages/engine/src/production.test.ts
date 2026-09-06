// 丹房/器坊生产切片测试：岗位 → 点数推进 → 开炉校验 → 出炉 → 旧档兼容 → 确定性。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GearTier } from "./catalog.js";
import { createGame } from "./engine.js";
import {
  ADULT_AGE,
  WORKSHOP_JOB_LIMIT,
  advanceWorkshops,
  assignWorkshopJob,
  jobsOf,
  maxForgeTierForRank,
  removeWorkshopJob,
  startGearCraft,
  startPillCraft,
  warehouseOf,
  workerMonthlyPoints,
  workshopAppointmentBlockReason,
} from "./production.js";
import { settleMonthly } from "./settlement.js";
import type { GameState } from "./state.js";

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

/** 全链路场景：任命 → 攒 9 月点数（丹房/器坊各 90 点）→ 开 2 炉丹 + 2 件装备 → 推进出炉。 */
function productionScenario(seed: string): GameState {
  let state = newGame(seed);
  state = assignWorkshopJob(state, "pill", "d-1").state;
  state = assignWorkshopJob(state, "gear", "d-2").state;
  for (let i = 0; i < 9; i++) {
    state = advanceWorkshops(state).state;
  }
  state = { ...state, spiritStones: state.spiritStones + 5000 };
  state = startPillCraft(state, "pill-yanshou").state;
  state = startPillCraft(state, "pill-juling").state;
  state = startGearCraft(state, "weapon", 1).state;
  state = startGearCraft(state, "accessory", 2).state;
  // 延寿丹 2 月周期：第 1 月未熟、第 2 月出炉；聚灵丹 1 月即熟。
  for (let i = 0; i < 2; i++) {
    state = advanceWorkshops(state).state;
  }
  return state;
}

describe("岗位模型", () => {
  it("无职成年内门弟子可任命，丹房/器坊各至多 2 岗", () => {
    let state = newGame();
    assert.equal(WORKSHOP_JOB_LIMIT, 2);
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = assignWorkshopJob(state, "pill", "d-2").state;
    assert.deepEqual(jobsOf(state).pill.workers, ["d-1", "d-2"]);
    assert.throws(() => assignWorkshopJob(state, "pill", "d-3"), /workshop_job_full/);
  });

  it("同一弟子不可兼任两车间（无职才可任命）", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    assert.throws(() => assignWorkshopJob(state, "gear", "d-1"), /disciple_job_busy/);
    state = assignWorkshopJob(state, "gear", "d-2").state;
    assert.deepEqual(jobsOf(state).gear.workers, ["d-2"]);
  });

  it("任命校验：外门 / 未成年 / 不存在弟子", () => {
    const state = newGame();
    const outer = state.disciples.find((entry) => entry.role === "outer");
    assert.ok(outer);
    assert.equal(workshopAppointmentBlockReason(state, "pill", outer.id), "disciple_not_inner");
    const inner = state.disciples.find((entry) => entry.role === "inner" && entry.age >= ADULT_AGE);
    assert.ok(inner);
    const minor = { ...structuredClone(inner), id: "d-minor", age: ADULT_AGE - 1 };
    const withMinor = { ...structuredClone(state), disciples: [minor, ...state.disciples] };
    assert.equal(
      workshopAppointmentBlockReason(withMinor, "pill", "d-minor"),
      "disciple_not_adult",
    );
    assert.equal(workshopAppointmentBlockReason(state, "pill", "d-missing"), "disciple_not_found");
  });

  it("卸任：只移除本车间在岗弟子", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = removeWorkshopJob(state, "pill", "d-1").state;
    assert.deepEqual(jobsOf(state).pill.workers, []);
    assert.throws(() => removeWorkshopJob(state, "pill", "d-1"), /workshop_job_not_held/);
  });
});

describe("点数推进", () => {
  it("1 岗 +10 点/月，丹道天赋丹师 +20% 乘算为 12", () => {
    assert.equal(workerMonthlyPoints("pill", []), 10);
    assert.equal(workerMonthlyPoints("pill", ["t-pill-talent"]), 12);
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = assignWorkshopJob(state, "gear", "d-2").state;
    assert.equal(jobsOf(state).pill.points, 0);
    assert.equal(jobsOf(state).gear.points, 0);
    state = advanceWorkshops(state).state;
    assert.equal(jobsOf(state).pill.points, 10);
    assert.equal(jobsOf(state).gear.points, 10);
    state = advanceWorkshops(state).state;
    assert.equal(jobsOf(state).pill.points, 20);
  });

  it("丹道天赋只在丹房生效（车间天赋亲和）", () => {
    let state = newGame();
    const alchemist = state.disciples.find((entry) => entry.id === "d-1");
    assert.ok(alchemist);
    alchemist.talentIds = ["t-pill-talent"];
    state = assignWorkshopJob(state, "pill", "d-2").state;
    state = assignWorkshopJob(state, "gear", "d-1").state;
    state = advanceWorkshops(state).state;
    // 丹道天赋对器坊不加成：两车间都是 10。
    assert.equal(jobsOf(state).pill.points, 10);
    assert.equal(jobsOf(state).gear.points, 10);
    state = removeWorkshopJob(state, "pill", "d-2").state;
    state = removeWorkshopJob(state, "gear", "d-1").state;
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state = advanceWorkshops(state).state;
    assert.equal(jobsOf(state).pill.points, 10 + 12);
    assert.equal(jobsOf(state).gear.points, 10);
  });

  it("坐化弟子自动离岗，不再产出点数", () => {
    let state = newGame();
    state = assignWorkshopJob(state, "pill", "d-1").state;
    state.disciples = state.disciples.filter((entry) => entry.id !== "d-1");
    state = advanceWorkshops(state).state;
    assert.deepEqual(jobsOf(state).pill.workers, []);
    assert.equal(jobsOf(state).pill.points, 0);
  });
});

describe("器坊开炉", () => {
  it("宗门等级限档：1 级只可炼档 1–2，3 级档 1–4", () => {
    assert.equal(maxForgeTierForRank(1), 2);
    assert.equal(maxForgeTierForRank(2), 3);
    assert.equal(maxForgeTierForRank(3), 4);
    let state = newGame();
    state = {
      ...state,
      spiritStones: 10000,
      jobs: { ...jobsOf(state), gear: { workers: [], points: 600, tasks: [] } },
    };
    assert.throws(() => startGearCraft(state, "weapon", 3), /gear_tier_locked/);
    const rank3 = { ...structuredClone(state), sectRank: 3 as const };
    const { state: after } = startGearCraft(rank3, "weapon", 4);
    assert.deepEqual(warehouseOf(after).gear.at(-1), { slot: "weapon", tier: 4 });
  });

  it("开炉校验：灵石费用立即扣、点数池扣点、出炉入仓库、纪事 normal", () => {
    let state = newGame();
    state = {
      ...state,
      spiritStones: 2000,
      jobs: { ...jobsOf(state), gear: { workers: [], points: 300, tasks: [] } },
    };
    const { state: after, gear } = startGearCraft(state, "weapon", 1);
    assert.deepEqual(gear, { slot: "weapon", tier: 1 });
    assert.equal(after.spiritStones, 2000 - 200);
    assert.equal(jobsOf(after).gear.points, 300 - 20);
    assert.deepEqual(warehouseOf(after).gear, [{ slot: "weapon", tier: 1 }]);
    const entry = after.chronicle[0];
    assert.ok(entry);
    assert.equal(entry.kind, "normal");
    assert.ok(entry.text.includes("器坊出炉"));
    // 状态只读：原状态未被修改
    assert.equal(jobsOf(state).gear.points, 300);
    assert.deepEqual(warehouseOf(state).gear, []);
  });

  it("点数不足 / 灵石不足 / 非法槽档 拒绝开炉", () => {
    let state = newGame();
    state = {
      ...state,
      spiritStones: 2000,
      jobs: { ...jobsOf(state), gear: { workers: [], points: 19, tasks: [] } },
    };
    assert.throws(() => startGearCraft(state, "weapon", 1), /craft_points_insufficient/);
    const poor = {
      ...structuredClone(state),
      spiritStones: 100,
      jobs: {
        pill: { workers: [], points: 0, tasks: [] },
        gear: { workers: [], points: 300, tasks: [] },
      },
    };
    assert.throws(() => startGearCraft(poor, "weapon", 2), /insufficient_resource/);
    assert.throws(
      () => startGearCraft({ ...poor, spiritStones: 100000 }, "weapon", 5 as GearTier),
      /gear_invalid/,
    );
  });
});

describe("丹房开炉与出炉", () => {
  it("开炉即扣灵石与点数，延寿丹 2 月后出炉入仓库", () => {
    let state = newGame();
    state = {
      ...state,
      spiritStones: 2000,
      jobs: { ...jobsOf(state), pill: { workers: [], points: 100, tasks: [] } },
    };
    const { state: opened, task } = startPillCraft(state, "pill-yanshou");
    assert.deepEqual(task, { pillId: "pill-yanshou", monthsLeft: 2 });
    assert.equal(opened.spiritStones, 2000 - 500);
    assert.equal(jobsOf(opened).pill.points, 100 - 40);
    assert.ok(opened.chronicle[0]?.text.includes("丹房开炉"));

    let advanced = advanceWorkshops(opened);
    assert.deepEqual(advanced.completedPills, []);
    assert.deepEqual(jobsOf(advanced.state).pill.tasks, [
      { pillId: "pill-yanshou", monthsLeft: 1 },
    ]);
    advanced = advanceWorkshops(advanced.state);
    assert.deepEqual(advanced.completedPills, [{ pillId: "pill-yanshou", count: 1 }]);
    assert.deepEqual(jobsOf(advanced.state).pill.tasks, []);
    assert.deepEqual(warehouseOf(advanced.state).pills, [{ pillId: "pill-yanshou", count: 1 }]);
    const done = advanced.state.chronicle[0];
    assert.ok(done);
    assert.equal(done.kind, "normal");
    assert.ok(done.text.includes("丹房出炉"));
  });

  it("多炉并行：聚灵丹 1 月先熟，两炉丹药分别入仓库", () => {
    let state = newGame();
    state = {
      ...state,
      spiritStones: 5000,
      jobs: { ...jobsOf(state), pill: { workers: [], points: 200, tasks: [] } },
    };
    state = startPillCraft(state, "pill-yanshou").state;
    state = startPillCraft(state, "pill-juling").state;
    let advanced = advanceWorkshops(state);
    assert.deepEqual(advanced.completedPills, [{ pillId: "pill-juling", count: 1 }]);
    advanced = advanceWorkshops(advanced.state);
    assert.deepEqual(advanced.completedPills, [{ pillId: "pill-yanshou", count: 1 }]);
    assert.deepEqual(warehouseOf(advanced.state).pills, [
      { pillId: "pill-juling", count: 1 },
      { pillId: "pill-yanshou", count: 1 },
    ]);
  });

  it("点数不足 / 灵石不足 / 未知丹药 拒绝开炉", () => {
    let state = newGame();
    state = {
      ...state,
      spiritStones: 2000,
      jobs: { ...jobsOf(state), pill: { workers: [], points: 19, tasks: [] } },
    };
    assert.throws(() => startPillCraft(state, "pill-juling"), /craft_points_insufficient/);
    assert.throws(
      () => startPillCraft({ ...state, spiritStones: 100 }, "pill-juling"),
      /insufficient_resource/,
    );
    assert.throws(() => startPillCraft(state, "pill-none"), /pill_not_found/);
  });
});

describe("旧档兼容（扩展字段缺省）", () => {
  it("旧档缺 library/jobs/warehouse：按空值口径工作", () => {
    const legacy = stripM2Fields(newGame());
    assert.deepEqual(jobsOf(legacy), {
      pill: { workers: [], points: 0, tasks: [] },
      gear: { workers: [], points: 0, tasks: [] },
    });
    assert.deepEqual(warehouseOf(legacy), { gear: [], pills: [] });
    // 空车间可推进（无人无炉 → 无变化），且首次推进物化扩展字段。
    const advanced = advanceWorkshops(legacy);
    assert.deepEqual(jobsOf(advanced.state).pill.workers, []);
    assert.ok(advanced.state.jobs);
    assert.ok(advanced.state.warehouse);
    // 旧档可直接任命 / 开炉校验走缺省点数池。
    const assigned = assignWorkshopJob(advanced.state, "gear", "d-1").state;
    assert.deepEqual(jobsOf(assigned).gear.workers, ["d-1"]);
    assert.throws(() => startGearCraft(assigned, "weapon", 1), /craft_points_insufficient/);
  });

  it("旧档 M1 月结不回归：JSON 往返后月结照常", () => {
    const legacy = stripM2Fields(newGame());
    const restored = JSON.parse(JSON.stringify(legacy)) as GameState;
    const { state } = settleMonthly(restored, "rest");
    assert.equal(state.currentTurn, 2);
    assert.equal(state.jobs, undefined);
  });

  it("新档初始即带空扩展字段", () => {
    const state = newGame();
    assert.deepEqual(state.jobs, {
      pill: { workers: [], points: 0, tasks: [] },
      gear: { workers: [], points: 0, tasks: [] },
    });
    assert.deepEqual(state.warehouse, { gear: [], pills: [] });
    assert.deepEqual(state.library, { techniqueIds: [], spellIds: [] });
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

  it("生产全链路终态：装备与丹药入仓库、在炉清空、纪事齐备", () => {
    const state = productionScenario("prod-scenario-check");
    assert.deepEqual(warehouseOf(state).gear, [
      { slot: "weapon", tier: 1 },
      { slot: "accessory", tier: 2 },
    ]);
    assert.deepEqual(warehouseOf(state).pills, [
      { pillId: "pill-juling", count: 1 },
      { pillId: "pill-yanshou", count: 1 },
    ]);
    assert.deepEqual(jobsOf(state).pill.tasks, []);
    // 攒 9 月各 90 点：丹房 −60 后 +20 推进 = 50；器坊 −80 后 +20 推进 = 30。
    assert.equal(jobsOf(state).pill.points, 50);
    assert.equal(jobsOf(state).gear.points, 30);
    assert.ok(state.chronicle.some((entry) => entry.text.includes("器坊出炉")));
    assert.ok(state.chronicle.some((entry) => entry.text.includes("丹房出炉")));
  });
});
