// 丹房/器坊生产：外门投入制（参考完整版 crafting-v2，按简化版裁剪）。
// 数值来源：设计文档 §丹药系统/§装备系统/§月结流程第 4 步 + 完整版《修仙》crafting-v2 公式。
//
// 生产模型口径（与完整版对齐，去掉多炉制与成功率/炸炉）：
// - 每房至多 1 名主持（丹师/工匠，成年内门、不历练但修炼照常）：境界越高加成越高（每境界等级 +20%，
//   元婴前期 +200% 封顶），持丹道/器道天赋再 +20%（与境界加成合计仍封顶 200%）；无主持照常开工。
// - 投入外门弟子即自动开炉：拖动滑杆人数 ≥1 时该房自动挂默认任务（丹房炼丹 / 器坊炼法宝），
//   无图纸/档位点选。
// - 挂任务免费、不预扣灵石；月结按在册人手推进：每名外门弟子每月 +1 点（基础，受主持加成乘算），
//   并消耗月耗 1 灵石/人/月（丹房/器坊同值）。
// - 丹房不选丹方：点数统一 PILL_TASK_POINTS，满点出炉时在目录两种丹药中随机（各 50%，sha256 掷骰）。
//   器坊同理固定炼法宝：点数统一 GEAR_TASK_POINTS，满点出炉时在法宝目录十件中随机其一。
// - 点数满 → 出炉入仓库并自动连炉（进度清零续炼同任务；换任务/抽走人手即打断）。
// - 人手不足（0 人）或灵石不敷月耗 → 该房当月停摆：不推进、不扣费（workshopPauseReason 供 UI 展示）。
// - 旧档 jobs 旧结构（points/tasks 岗位点数池、pill 任务带 pillId、gear 任务带 slot/tier）读时归一迁移。
import {
  type CraftJobKind,
  PILLS,
  TREASURES,
  treasureEffectDescription,
  workshopCraftYieldPct,
} from "./catalog.js";
import { deterministicRoll } from "./hash.js";
import { effectiveOuterJobsOf, outerTotalOf } from "./outer-jobs.js";
import { CHRONICLE_LIMIT } from "./settlement.js";
import type {
  ChronicleEntry,
  GameState,
  SectJobs,
  WarehouseGearItem,
  WarehouseStock,
  WorkshopState,
  WorkshopTask,
} from "./state.js";
import { CRAFT_JOB_KINDS, emptySectJobs, emptyWarehouse } from "./state.js";

/** 每房主持（丹师/工匠）至多 1 名。 */
export const WORKSHOP_MASTER_LIMIT = 1;
/** 丹房炼制点数统一值（不选丹方：满点出炉时目录两种丹药各 50% 随机）。 */
export const PILL_TASK_POINTS = 300;
/** 器坊炼制点数统一值（不选图纸：满点出炉法宝目录十件随机其一）。 */
export const GEAR_TASK_POINTS = 500;
/** 每名投入的外门弟子每月 +1 点（基础点数，主持加成乘算其上）。 */
export const WORKSHOP_POINTS_PER_OUTER_PER_MONTH = 1;
/** 主持境界加成：每境界等级 +20%（练气前期 +20% … 元婴前期 +200% 封顶）。 */
export const WORKSHOP_BONUS_PER_REALM_LEVEL = 0.2;
/** 主持加成封顶 +200%（元婴前期；境界与天赋合计仍受此顶约束）。 */
export const WORKSHOP_MAX_MASTER_BONUS_PCT = 2;
/** 月耗：每名在炉外门弟子 1 灵石/月（丹房/器坊同值）。 */
export const PILL_COST_PER_OUTER_MONTH = 1;
export const GEAR_COST_PER_OUTER_MONTH = 1;
/** 月推进封顶占总点数比例：丹房 100%（完整版口径，人海可当月出炉）、器坊 60%。 */
export const PILL_MONTHLY_PROGRESS_CAP_RATIO = 1;
export const GEAR_MONTHLY_PROGRESS_CAP_RATIO = 0.6;
/** 单房投入外门人数上限（完整版同值；简化版外门容量 100/300/500 之下形同不约束）。 */
export const WORKSHOP_MAX_ASSIGNED_OUTER = 500;

/** 成年口径：弟子生成年龄下限（招募/开局均为 16 岁起）。 */
export const ADULT_AGE = 16;

// ─── 车间读取（旧档兼容：岗位点数池旧结构读时归零迁移）──────────────────

/** 旧档/异常数据规整为当前车间结构：workers 取首位为主持，旧 points/tasks 岗位点数池丢弃，pill 任务剥离 pillId。 */
function normalizeWorkshop(raw: unknown): WorkshopState {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as {
    workers?: unknown;
    assignedOuter?: unknown;
    task?: unknown;
  };
  const workers = Array.isArray(source.workers)
    ? source.workers.filter((id): id is string => typeof id === "string")
    : [];
  const assignedOuter =
    typeof source.assignedOuter === "number" && Number.isFinite(source.assignedOuter)
      ? Math.max(0, Math.floor(source.assignedOuter))
      : 0;
  const task = normalizeTask(source.task);
  return { workers: workers.slice(0, WORKSHOP_MASTER_LIMIT), assignedOuter, task };
}

/** 任务规整：丹房任务剥旧档 pillId（现按统一点数随机出炉）；器坊任务剥旧档 slot/tier（现满点随机出炉法宝）。 */
function normalizeTask(raw: unknown): WorkshopTask | null {
  if (typeof raw !== "object" || raw === null) return null;
  const task = raw as { kind?: unknown; accumulatedPoints?: unknown };
  if (task.kind !== "pill" && task.kind !== "gear") return null;
  const accumulatedPoints =
    typeof task.accumulatedPoints === "number" && Number.isFinite(task.accumulatedPoints)
      ? Math.max(0, task.accumulatedPoints)
      : 0;
  return { kind: task.kind, accumulatedPoints };
}

export function jobsOf(state: Readonly<GameState>): SectJobs {
  const raw = state.jobs ?? emptySectJobs();
  return {
    pill: normalizeWorkshop(raw.pill),
    gear: normalizeWorkshop(raw.gear),
  };
}

export function warehouseOf(state: Readonly<GameState>): WarehouseStock {
  return state.warehouse ?? emptyWarehouse();
}

// ─── 主持任命（沿用 workers 字段；无职成年内门弟子，每房至多 1 名）─────────

/** 主持任命校验：返回拒绝原因，undefined = 可任命。 */
export function workshopAppointmentBlockReason(
  state: Readonly<GameState>,
  kind: CraftJobKind,
  discipleId: string,
): string | undefined {
  const disciple = state.disciples.find((entry) => entry.id === discipleId);
  if (!disciple) return "disciple_not_found";
  if (disciple.age < ADULT_AGE) return "disciple_not_adult";
  const jobs = jobsOf(state);
  for (const other of CRAFT_JOB_KINDS) {
    if (jobs[other].workers.includes(discipleId)) return "disciple_job_busy";
  }
  if (jobs[kind].workers.length >= WORKSHOP_MASTER_LIMIT) return "workshop_job_full";
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
  jobs[kind] = normalizeWorkshop(jobs[kind]);
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
  clonedJobs[kind] = normalizeWorkshop(clonedJobs[kind]);
  clonedJobs[kind].workers = clonedJobs[kind].workers.filter((id) => id !== discipleId);
  return { state, discipleId, kind };
}

/** 主持境界加成：境界等级 × 20%，元婴前期（10 级）封顶 +200%（与天赋加成合计同受此顶）。 */
export function workshopMasterBonusPct(realmLevel: number): number {
  return Math.min(
    WORKSHOP_MAX_MASTER_BONUS_PCT,
    Math.max(0, realmLevel) * WORKSHOP_BONUS_PER_REALM_LEVEL,
  );
}

/** 主持产速乘数：1 + min(+200%, 境界加成 + 对应天赋加成)；无主持恒 1（无主持照常开工）。 */
export function workshopSpeedMultiplier(state: Readonly<GameState>, kind: CraftJobKind): number {
  const jobs = jobsOf(state);
  const masterId = jobs[kind].workers[0];
  const master = masterId
    ? state.disciples.find((disciple) => disciple.id === masterId)
    : undefined;
  if (!master) return 1;
  const bonus =
    workshopMasterBonusPct(master.realmLevel) + workshopCraftYieldPct(kind, master.talentIds);
  return 1 + Math.min(WORKSHOP_MAX_MASTER_BONUS_PCT, bonus);
}

// ─── 外门投入（滑杆人数；两房合计 ≤ 外门总数）────────────────────────────

export type WorkshopStaffOutcome = {
  state: GameState;
  kind: CraftJobKind;
  assignedOuter: number;
};

/** 投入外门弟子（拖动滑杆）：人数即时生效；两房与挖矿/练气在编合计超出外门总数即拒绝。 */
export function setWorkshopStaff(
  stateInput: Readonly<GameState>,
  kind: CraftJobKind,
  amount: number,
): WorkshopStaffOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  if (!Number.isInteger(amount) || amount < 0) throw new Error("workshop_staff_invalid");
  if (amount > WORKSHOP_MAX_ASSIGNED_OUTER) throw new Error("workshop_staff_over_cap");
  const other =
    kind === "pill"
      ? (stateInput.jobs?.gear?.assignedOuter ?? 0)
      : (stateInput.jobs?.pill?.assignedOuter ?? 0);
  // 挖矿/练气在编同样占用外门人数（外门分工合计 ≤ 外门总数；取生效口径防超编配置双重计数）。
  const outerJobs = effectiveOuterJobsOf(stateInput);
  if (other + outerJobs.mining + outerJobs.qi + amount > outerTotalOf(stateInput)) {
    throw new Error("workshop_outer_insufficient");
  }

  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  jobs[kind] = normalizeWorkshop(jobs[kind]);
  jobs[kind].assignedOuter = amount;
  ensureAutoTask(kind, jobs[kind]);
  return { state, kind, assignedOuter: amount };
}

// ─── 自动开炉（投入外门弟子即开工，无需点选任务、无需主持）────────────────

/** 自动开炉默认任务：丹房即炼丹；器坊即炼法宝（无图纸点选，满点随机出炉目录十件其一）。 */
function autoTaskFor(kind: CraftJobKind): WorkshopTask {
  return kind === "pill"
    ? { kind: "pill", accumulatedPoints: 0 }
    : { kind: "gear", accumulatedPoints: 0 };
}

/** 投入人数 ≥1 且空闲时自动挂默认任务（滑杆投入与月结推进共用同一推导）。 */
function ensureAutoTask(kind: CraftJobKind, workshop: WorkshopState): void {
  if (workshop.assignedOuter >= 1 && workshop.task === null) workshop.task = autoTaskFor(kind);
}

// ─── 在炉任务（挂任务免费，月结推进；换任务进度作废）────────────────────

export type PillTaskSpec = { kind: "pill" };
export type GearTaskSpec = { kind: "gear" };
export type WorkshopTaskSpec = PillTaskSpec | GearTaskSpec;

export type WorkshopTaskOutcome = {
  state: GameState;
  task: WorkshopTask;
};

/** 任务总点数（丹房/器坊各自统一点数）。 */
export function workshopTaskTotalPoints(task: WorkshopTask): number {
  if (task.kind === "pill") return PILL_TASK_POINTS;
  return GEAR_TASK_POINTS;
}

/** 挂任务/换任务：不校验灵石不扣费（月结按月扣月耗）；同任务幂等，换任务进度作废。 */
export function startWorkshopTask(
  stateInput: Readonly<GameState>,
  kind: CraftJobKind,
  spec: WorkshopTaskSpec,
): WorkshopTaskOutcome {
  if (stateInput.ending) throw new Error("game_already_ended");
  if (spec.kind !== kind) throw new Error("workshop_task_mismatch");
  let task: WorkshopTask;
  if (spec.kind === "pill") {
    task = { kind: "pill", accumulatedPoints: 0 };
  } else {
    task = { kind: "gear", accumulatedPoints: 0 };
  }

  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  const workshop = normalizeWorkshop(jobs[kind]);
  jobs[kind] = workshop;
  const previous = workshop.task;
  const sameTask = previous !== null && previous.kind === task.kind;
  if (sameTask) {
    return { state, task: previous };
  }
  workshop.task = task;
  const title =
    task.kind === "pill"
      ? `丹房开始炼制丹药（出炉随机：${PILLS.map((pill) => pill.name).join("/")}各半）。`
      : `器坊开始炼制法宝（出炉随机：${TREASURES.length} 种法宝其一，共需 ${workshopTaskTotalPoints(task)} 点）。`;
  appendChronicle(state, {
    turn: state.currentTurn,
    kind: "normal",
    text: `${title}${previous === null ? "" : "原任务进度作废。"}`,
  });
  return { state, task };
}

// ─── 停摆判定与出炉预估（UI 与月结共用同一推导）─────────────────────────

export type WorkshopPauseReason = "no_staff" | "no_funds";

/** 当月停摆原因：无人 / 灵石不敷月耗；undefined = 正常运转（或空闲无任务）。 */
export function workshopPauseReason(
  state: Readonly<GameState>,
  kind: CraftJobKind,
): WorkshopPauseReason | undefined {
  const jobs = jobsOf(state);
  if (!jobs[kind].task) return undefined;
  if (jobs[kind].assignedOuter < 1) return "no_staff";
  const monthlyCost = Math.round(jobs[kind].assignedOuter * monthlyCostPerOuter(kind));
  if (state.spiritStones < monthlyCost) return "no_funds";
  return undefined;
}

function monthlyCostPerOuter(kind: CraftJobKind): number {
  return kind === "pill" ? PILL_COST_PER_OUTER_MONTH : GEAR_COST_PER_OUTER_MONTH;
}

function monthlyProgressCapRatio(kind: CraftJobKind): number {
  return kind === "pill" ? PILL_MONTHLY_PROGRESS_CAP_RATIO : GEAR_MONTHLY_PROGRESS_CAP_RATIO;
}

/** 预计出炉月数（按当前投入与加速）：无人或空闲返回 undefined。 */
export function estimateCraftMonths(
  state: Readonly<GameState>,
  kind: CraftJobKind,
): number | undefined {
  const jobs = jobsOf(state);
  const task = jobs[kind].task;
  if (!task || jobs[kind].assignedOuter < 1) return undefined;
  const total = workshopTaskTotalPoints(task);
  const remaining = Math.max(0, total - task.accumulatedPoints);
  if (remaining <= 0) return 0;
  const advance = Math.min(
    total * monthlyProgressCapRatio(kind),
    jobs[kind].assignedOuter *
      WORKSHOP_POINTS_PER_OUTER_PER_MONTH *
      workshopSpeedMultiplier(state, kind),
  );
  if (advance <= 0) return undefined;
  return Math.max(1, Math.ceil(remaining / advance));
}

// ─── 月度生产推进（月结第 ④ 步：超编裁剪 → 月耗与点数 → 出炉/连炉）───────

export type ProductionAdvanceResult = {
  state: GameState;
  /** 本月出炉的丹药（已入仓库）。 */
  completedPills: Array<{ pillId: string; count: number }>;
  /** 本月出炉的装备（已入仓库）。 */
  completedGear: WarehouseGearItem[];
};

/** 出炉法宝掷骰：目录十件随机其一（均匀十等分；命名空间 `${seed}:gear-craft:${turn}` 确定性可对拍）。 */
export function rollCraftTreasure(seed: string, turn: number): (typeof TREASURES)[number] {
  const roll = deterministicRoll(`${seed}:gear-craft:${turn}`);
  const treasure = TREASURES[Math.floor((roll / 100) * TREASURES.length)] ?? TREASURES[0];
  if (!treasure) throw new Error("treasure_catalog_empty");
  return treasure;
}

export function advanceWorkshops(stateInput: Readonly<GameState>): ProductionAdvanceResult {
  if (stateInput.ending) throw new Error("game_already_ended");
  const state = structuredClone(stateInput) as GameState;
  const jobs = state.jobs ?? emptySectJobs();
  state.jobs = jobs;
  for (const kind of CRAFT_JOB_KINDS) jobs[kind] = normalizeWorkshop(jobs[kind]);
  const warehouse = state.warehouse ?? emptyWarehouse();
  state.warehouse = warehouse;

  // ⓪ 坐化弟子自动离岗（主持在册校验）。
  for (const kind of CRAFT_JOB_KINDS) {
    jobs[kind].workers = jobs[kind].workers.filter((workerId) =>
      state.disciples.some((disciple) => disciple.id === workerId),
    );
  }

  // ① 超编防御：异常数据可致两房合计 > 外门总数（外门恒满员，正常游玩不可达）；保丹房裁器坊。
  const overflow = jobs.pill.assignedOuter + jobs.gear.assignedOuter - outerTotalOf(state);
  if (overflow > 0) {
    const gearTrim = Math.min(jobs.gear.assignedOuter, overflow);
    jobs.gear.assignedOuter -= gearTrim;
    const pillTrim = Math.min(jobs.pill.assignedOuter, overflow - gearTrim);
    jobs.pill.assignedOuter -= pillTrim;
    appendChronicle(state, {
      turn: state.currentTurn,
      kind: "warning",
      text: `外门人手吃紧，丹房/器坊投入合计裁去 ${pillTrim + gearTrim} 人（丹房优先保全）。`,
    });
  }

  const completedPills: Array<{ pillId: string; count: number }> = [];
  const completedGear: WarehouseGearItem[] = [];

  // ② 逐房推进：自动开炉 → 扣月耗 → 加点（主持加速乘算、月推进封顶）→ 满点出炉并连炉。
  for (const kind of CRAFT_JOB_KINDS) {
    const workshop = jobs[kind];
    ensureAutoTask(kind, workshop);
    if (!workshop.task) continue;
    if (workshopPauseReason(state, kind)) continue;
    const staffed = workshop.assignedOuter;
    state.spiritStones -= Math.round(staffed * monthlyCostPerOuter(kind));
    const total = workshopTaskTotalPoints(workshop.task);
    const advance = Math.min(
      total * monthlyProgressCapRatio(kind),
      staffed * WORKSHOP_POINTS_PER_OUTER_PER_MONTH * workshopSpeedMultiplier(state, kind),
    );
    const accumulated = workshop.task.accumulatedPoints + advance;
    if (accumulated < total) {
      workshop.task = { ...workshop.task, accumulatedPoints: accumulated };
      continue;
    }
    // 满点出炉：丹房随机丹方（各 50%）、装备入仓库，纪事 normal；连炉清零续炼同任务。
    if (workshop.task.kind === "pill") {
      // 出炉丹方掷骰：每月至多出炉一炉，命名空间 `${seed}:pill-craft:${turn}` 确定性可对拍。
      const roll = deterministicRoll(`${state.seed}:pill-craft:${state.currentTurn}`);
      const pill = PILLS[roll < 50 ? 0 : 1] ?? PILLS[0];
      if (!pill) {
        workshop.task = null;
        continue;
      }
      const stock = warehouse.pills.find((entry) => entry.pillId === pill.id);
      if (stock) stock.count += 1;
      else warehouse.pills.push({ pillId: pill.id, count: 1 });
      completedPills.push({ pillId: pill.id, count: 1 });
      appendChronicle(state, {
        turn: state.currentTurn,
        kind: "normal",
        text: `丹房出炉：丹成${pill.name}一炉（随机丹方），已存入仓库（连炉续炼）。`,
      });
      workshop.task = { kind: "pill", accumulatedPoints: 0 };
    } else {
      // 满点出炉：法宝目录十件随机其一（确定性掷骰可对拍）。
      const treasure = rollCraftTreasure(state.seed, state.currentTurn);
      const gear: WarehouseGearItem = { slot: "talisman", treasureId: treasure.id };
      warehouse.gear.push(gear);
      completedGear.push(gear);
      appendChronicle(state, {
        turn: state.currentTurn,
        kind: "normal",
        text: `器坊出炉：炼成法宝「${treasure.name}」（${treasureEffectDescription(treasure)}），已存入仓库（连炉续炼）。`,
      });
      workshop.task = { kind: "gear", accumulatedPoints: 0 };
    }
  }

  return { state, completedPills, completedGear };
}

// ─── 内部工具 ────────────────────────────────────────────────────────────

function appendChronicle(state: GameState, entry: ChronicleEntry): void {
  state.chronicle.unshift(entry);
  if (state.chronicle.length > CHRONICLE_LIMIT) state.chronicle.length = CHRONICLE_LIMIT;
}
