// 丹房/器坊生产：岗位模型、点数推进、开炉校验、出炉入仓库。
// 数值来源：设计文档 §装备系统（器坊炼制）/§丹药系统（丹房）/§月结流程第 4 步。
//
// 生产模型口径（D-008/D-009 数值表推导）：
// - 岗位每月产出点数入车间点数池：1 岗 +10 点/月，岗位弟子持对应天赋（丹道/器道）时 ×(1+20%) 乘算。
// - 开炉 = 一次性校验并扣除点数池点数 + 灵石费用（点数不足/灵石不足立即拒绝，灵石开炉即扣）。
// - 装备开炉即出炉入仓库（装备表未给在炉周期）；丹药在炉 craftMonths 月后出炉入仓库
//   （延寿丹 2 月/40 点、聚灵丹 1 月/20 点：满 2 岗时点数恰好在周期内集满）。
// - 本模块不做岗位任命命令与服用/穿戴效果（E02-F03 职责）；月结第 4 步由后续波次把
//   advanceWorkshops 接入 settleMonthly。
import {
  type CraftJobKind,
  FORGE_TIER_LIMIT_BY_RANK,
  GEAR_CRAFT_COST,
  GEAR_CRAFT_POINTS,
  GEAR_SLOT_DISPLAY_NAMES,
  type GearSlot,
  type GearTier,
  getGear,
  getPillById,
  workshopCraftYieldPct,
} from "./catalog.js";
import { CHRONICLE_LIMIT } from "./settlement.js";
import type {
  ChronicleEntry,
  FurnaceTask,
  GameState,
  SectJobs,
  WarehouseGearItem,
  WarehouseStock,
} from "./state.js";
import { CRAFT_JOB_KINDS, emptySectJobs, emptyWarehouse } from "./state.js";

/** 丹房/器坊各 1–2 岗。 */
export const WORKSHOP_JOB_LIMIT = 2;
/** 1 岗 +10 点/月。 */
export const WORKSHOP_POINTS_PER_JOB = 10;
/** 成年口径：弟子生成年龄下限（招募/开局均为 16 岁起）。 */
export const ADULT_AGE = 16;

// ─── 旧档兼容：扩展字段缺省口径 ─────────────────────────────────────────
// GameState.library / jobs / warehouse 为 M2 新增可选字段；旧档 JSON 缺字段时按空值处理。

export function jobsOf(state: Readonly<GameState>): SectJobs {
  return state.jobs ?? emptySectJobs();
}

export function warehouseOf(state: Readonly<GameState>): WarehouseStock {
  return state.warehouse ?? emptyWarehouse();
}

// ─── 岗位模型（任命/卸任命令由 E02-F03 接线，本模块提供纯函数与校验）──────

/** 岗位任命校验：无职成年内门弟子；返回拒绝原因，undefined = 可任命。 */
export function workshopAppointmentBlockReason(
  state: Readonly<GameState>,
  kind: CraftJobKind,
  discipleId: string,
): string | undefined {
  const disciple = state.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) return "disciple_not_found";
  if (disciple.role !== "inner") return "disciple_not_inner";
  if (disciple.age < ADULT_AGE) return "disciple_not_adult";
  const jobs = jobsOf(state);
  for (const other of CRAFT_JOB_KINDS) {
    if (jobs[other].workers.includes(discipleId)) return "disciple_job_busy";
  }
  if (jobs[kind].workers.length >= WORKSHOP_JOB_LIMIT) return "workshop_job_full";
  return undefined;
}

export type WorkshopAppointmentOutcome = {
  state: GameState;
  discipleId: string;
  kind: CraftJobKind;
};

export function assignWorkshopJob(
  stateInput: Readonly<GameState>,
  kind: CraftJobKind,
  discipleId: string,
): WorkshopAppointmentOutcome {
  const reason = workshopAppointmentBlockReason(stateInput, kind, discipleId);
  if (reason) throw new Error(reason);
  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  jobs[kind].workers.push(discipleId);
  return { state, discipleId, kind };
}

export function removeWorkshopJob(
  stateInput: Readonly<GameState>,
  kind: CraftJobKind,
  discipleId: string,
): WorkshopAppointmentOutcome {
  const jobs = jobsOf(stateInput);
  if (!jobs[kind].workers.includes(discipleId)) throw new Error("workshop_job_not_held");
  const state = structuredClone(stateInput) as GameState;
  const clonedJobs = state.jobs ?? emptySectJobs();
  state.jobs = clonedJobs;
  clonedJobs[kind].workers = clonedJobs[kind].workers.filter((id) => id !== discipleId);
  return { state, discipleId, kind };
}

// ─── 点数推进 ────────────────────────────────────────────────────────────

/** 岗位月产出：10 × (1 + 对应天赋 craftYieldPct)，乘算后取整。 */
export function workerMonthlyPoints(kind: CraftJobKind, talentIds: readonly string[]): number {
  return Math.round(WORKSHOP_POINTS_PER_JOB * (1 + workshopCraftYieldPct(kind, talentIds)));
}

// ─── 器坊开炉（宗门等级限档 + 点数/灵石校验，出炉即入仓库）──────────────

export function maxForgeTierForRank(rank: 1 | 2 | 3): GearTier {
  return FORGE_TIER_LIMIT_BY_RANK[rank];
}

export type GearCraftOutcome = {
  state: GameState;
  gear: WarehouseGearItem;
};

export function startGearCraft(
  stateInput: Readonly<GameState>,
  slot: GearSlot,
  tier: GearTier,
): GearCraftOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  if (!getGear(slot, tier)) throw new Error("gear_invalid");
  if (tier > maxForgeTierForRank(stateInput.sectRank)) throw new Error("gear_tier_locked");
  const cost = GEAR_CRAFT_COST[tier];
  const pointsRequired = GEAR_CRAFT_POINTS[tier];
  if (stateInput.spiritStones < cost) throw new Error("insufficient_resource");
  if (jobsOf(stateInput).gear.points < pointsRequired) throw new Error("craft_points_insufficient");

  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  const warehouse = state.warehouse ?? emptyWarehouse();
  state.warehouse = warehouse;

  // 开炉校验通过：灵石费用立即扣、点数池即扣，出炉入仓库。
  state.spiritStones -= cost;
  jobs.gear.points -= pointsRequired;
  const gear: WarehouseGearItem = { slot, tier };
  warehouse.gear.push(gear);
  appendChronicle(state, {
    turn: state.currentTurn,
    kind: "normal",
    text: `器坊出炉：${GEAR_SLOT_DISPLAY_NAMES[slot]}（档${tier}）炼制完成，已存入仓库。`,
  });
  return { state, gear };
}

// ─── 丹房开炉（点数/灵石校验，在炉周期到期出炉）─────────────────────────

export type PillCraftOutcome = {
  state: GameState;
  task: FurnaceTask;
};

export function startPillCraft(stateInput: Readonly<GameState>, pillId: string): PillCraftOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  const pill = getPillById(pillId);
  if (!pill) throw new Error("pill_not_found");
  if (stateInput.spiritStones < pill.craftCost) throw new Error("insufficient_resource");
  if (jobsOf(stateInput).pill.points < pill.craftPoints)
    throw new Error("craft_points_insufficient");

  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;

  state.spiritStones -= pill.craftCost;
  jobs.pill.points -= pill.craftPoints;
  const task: FurnaceTask = { pillId: pill.id, monthsLeft: pill.craftMonths };
  jobs.pill.tasks.push(task);
  appendChronicle(state, {
    turn: state.currentTurn,
    kind: "normal",
    text: `丹房开炉：炼制${pill.name}一炉，需在炉 ${pill.craftMonths} 月。`,
  });
  return { state, task };
}

// ─── 月度生产推进（月结第 4 步：丹房/器坊点数与出炉）────────────────────

export type ProductionAdvanceResult = {
  state: GameState;
  /** 本月出炉的丹药（已入仓库）。 */
  completedPills: Array<{ pillId: string; count: number }>;
};

export function advanceWorkshops(stateInput: Readonly<GameState>): ProductionAdvanceResult {
  if (stateInput.ending) throw new Error("game_already_ended");
  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  const warehouse = state.warehouse ?? emptyWarehouse();
  state.warehouse = warehouse;

  // ① 点数推进：每在岗弟子按月产出入车间点数池（坐化弟子自动离岗）。
  for (const kind of CRAFT_JOB_KINDS) {
    const workshop = jobs[kind];
    workshop.workers = workshop.workers.filter((workerId) =>
      state.disciples.some((disciple) => disciple.id === workerId),
    );
    for (const workerId of workshop.workers) {
      const worker = state.disciples.find((disciple) => disciple.id === workerId);
      if (!worker) continue;
      workshop.points += workerMonthlyPoints(kind, worker.talentIds);
    }
  }

  // ② 丹房出炉：周期到期 → 丹药入仓库，纪事 normal。
  const completedPills: Array<{ pillId: string; count: number }> = [];
  const remaining: FurnaceTask[] = [];
  for (const task of jobs.pill.tasks) {
    const monthsLeft = task.monthsLeft - 1;
    if (monthsLeft > 0) {
      remaining.push({ pillId: task.pillId, monthsLeft });
      continue;
    }
    const pill = getPillById(task.pillId);
    if (!pill) continue;
    addPillsToWarehouse(warehouse, pill.id, 1);
    completedPills.push({ pillId: pill.id, count: 1 });
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "normal",
      text: `丹房出炉：${pill.name}炼成一炉，已存入仓库。`,
    });
  }
  jobs.pill.tasks = remaining;

  return { state, completedPills };
}

// ─── 内部工具 ────────────────────────────────────────────────────────────

function appendChronicle(state: GameState, entry: ChronicleEntry): void {
  state.chronicle.unshift(entry);
  if (state.chronicle.length > CHRONICLE_LIMIT) state.chronicle.length = CHRONICLE_LIMIT;
}

function addPillsToWarehouse(warehouse: WarehouseStock, pillId: string, count: number): void {
  const existing = warehouse.pills.find((entry) => entry.pillId === pillId);
  if (existing) {
    existing.count += count;
    return;
  }
  warehouse.pills.push({ pillId, count });
}
