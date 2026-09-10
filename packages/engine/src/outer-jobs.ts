import { jobsOf } from "./production.js";
import { sectLimitsFor } from "./sect.js";
// 外门分工（挖矿/练气）：外门恒按宗门等级上限满员（100/300/500），玩家按人数分岗——
// 丹房/器坊投入走 production.setWorkshopStaff（车间 assignedOuter），本模块管挖矿与练气：
// - 挖矿：每名在岗外门弟子每月上缴灵石（月结第 ① 步并入收入，参与危机判定；灵矿长老按境界加成上缴）。
// - 练气：递补入内门时，按在岗练气人数给新弟子携带初始真元（月结第 ⑧ 步）。
// 主页「外门 X/Y」的 X = 四类在岗合计、Y = 外门上限；外门总数与分工调整在弟子殿分工面板。
import { CHRONICLE_LIMIT } from "./settlement.js";
import type { GameState, OuterJobsState } from "./state.js";
import { emptyOuterJobs } from "./state.js";

/** 外门总数：恒等于当前宗门等级的外门上限（1/2/3 级 = 100/300/500），开局满员、升阶扩容。 */
export function outerTotalOf(state: Readonly<GameState>): number {
  return sectLimitsFor(state.sectRank).outerLimit;
}

/** 挖矿：每名在岗外门弟子每月上缴灵石。 */
export const OUTER_MINING_STONES_PER_MONTH = 1;
/** 练气：递补入内门时，每名在岗练气外门为新弟子带来的初始真元。 */
export const OUTER_QI_ZHENYUAN_PER_WORKER = 20;

export type OuterJobsInput = Partial<Pick<OuterJobsState, "mining" | "qi">>;

/** 外门分工配置（旧档缺省/异常数据归零 = 未分岗）。 */
export function outerJobsOf(state: Readonly<GameState>): OuterJobsState {
  const raw = state.outerJobs;
  return {
    mining: raw && Number.isFinite(raw.mining) ? Math.max(0, Math.floor(raw.mining)) : 0,
    qi: raw && Number.isFinite(raw.qi) ? Math.max(0, Math.floor(raw.qi)) : 0,
  };
}

/** 车间（丹房 + 器坊）已投入的外门人数。 */
export function workshopStaffedOuterCount(state: Readonly<GameState>): number {
  const jobs = jobsOf(state);
  return jobs.pill.assignedOuter + jobs.gear.assignedOuter;
}

/**
 * 生效挖矿/练气人数：配置若因异常数据超过剩余容量（外门总数 − 车间投入）则按 挖矿→练气 钳制；
 * 只读钳制不改配置。外门总数恒满员，正常游玩下配置即生效。
 */
export function effectiveOuterJobsOf(state: Readonly<GameState>): OuterJobsState {
  const configured = outerJobsOf(state);
  const total = outerTotalOf(state);
  const staffed = Math.min(workshopStaffedOuterCount(state), total);
  const room = Math.max(0, total - staffed);
  const mining = Math.min(configured.mining, room);
  const qi = Math.min(configured.qi, room - mining);
  return { mining, qi };
}

/** 在岗外门总数 = 丹房 + 器坊 + 挖矿 + 练气（主页「外门 X/Y」的 X、弟子殿分工面板在岗口径，恒 ≤ 外门总数）。 */
export function workingOuterCountOf(state: Readonly<GameState>): number {
  const staffed = Math.min(workshopStaffedOuterCount(state), outerTotalOf(state));
  const effective = effectiveOuterJobsOf(state);
  return staffed + effective.mining + effective.qi;
}

export type AssignOuterJobsOutcome = {
  state: GameState;
  jobs: OuterJobsState;
};

/** 外门分工调整：挖矿/练气与车间投入合计不得超过外门总数；非法数值即拒绝；无变化不落纪事。 */
export function assignOuterJobs(
  stateInput: Readonly<GameState>,
  input: OuterJobsInput,
): AssignOuterJobsOutcome {
  const jobs = emptyOuterJobs();
  for (const key of ["mining", "qi"] as const) {
    const value = input[key] ?? 0;
    if (!Number.isInteger(value) || value < 0) throw new Error("outer_jobs_invalid");
    jobs[key] = value;
  }
  if (workshopStaffedOuterCount(stateInput) + jobs.mining + jobs.qi > outerTotalOf(stateInput)) {
    throw new Error("outer_jobs_over_capacity");
  }
  const state = structuredClone(stateInput) as GameState;
  state.outerJobs = jobs;
  const previous = outerJobsOf(stateInput);
  if (previous.mining !== jobs.mining || previous.qi !== jobs.qi) {
    state.chronicle.unshift({
      turn: state.currentTurn,
      kind: "normal",
      text: `外门分工调整：挖矿 ${jobs.mining} 人、练气 ${jobs.qi} 人，其余未分岗。`,
    });
    if (state.chronicle.length > CHRONICLE_LIMIT) state.chronicle.length = CHRONICLE_LIMIT;
  }
  return { state, jobs };
}
