// 会话仓库：包装引擎命令，向 UI 暴露单一可订阅快照。
// 引擎命令全部走 @simple-xiuxian/engine 导出（UI 不复制公式）；持久化由 UI 层自动档完成（use-game），本层保持纯净。
import {
  type CraftJobKind,
  type ElderKind,
  type GameState,
  type GearSlot,
  type OuterJobsInput,
  type SettlementResult,
  appointElder,
  assignOuterJobs,
  assignWorkshopJob,
  canPlayerDeclareWar,
  createGame,
  declareWar,
  learnArt,
  migrateGameState,
  recruitDisciple,
  removeElder,
  removeWorkshopJob,
  setWorkshopStaff,
  settleMonthly,
  startWorkshopTask,
  upgradeSect,
  usePill,
  wearGear,
} from "@simple-xiuxian/engine";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY_DISPLAY_NAMES: Record<Difficulty, string> = {
  easy: "简单",
  normal: "标准",
  hard: "困难",
};

export type NewGameInput = {
  sectName: string;
  seed: string;
  difficulty: Difficulty;
};

/** UI 难度档 → NPC 发展速度倍率（设计 §NPC 对手宗门 三档）。 */
const RIVAL_DIFFICULTY_BY_TIER: Record<Difficulty, number> = {
  easy: 0.8,
  normal: 1,
  hard: 1.2,
};

export type GameSnapshot = {
  /** 当前局状态；null 表示未开局。 */
  state: GameState | null;
  /** 当前局难度（首页新局三选）。 */
  difficulty: Difficulty;
  /** 最近一次月结结果（主界面弹层）。 */
  lastResult: SettlementResult | null;
  /** 引擎命令抛错后的用户可读提示。 */
  errorMessage: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  game_seed_invalid: "种子长度需在 1–128 个字符之间",
  game_sect_name_invalid: "宗门名需为 2–24 个字符",
  game_already_ended: "本局已终局，请开新局",
  insufficient_resource: "灵石不足",
  candidate_not_found: "招募候选已过期，请重新打开",
  disciple_not_found: "弟子不存在",
  inner_limit_reached: "内门席位已满",
  sect_rank_maxed: "宗门已是最高等级",
  sect_upgrade_realm_not_met: "升阶条件未满足：需至少 1 名筑基及以上弟子",
  sect_upgrade_golden_core_not_met: "升阶条件未满足：需至少 1 名金丹及以上弟子",
  disciple_not_inner: "仅内门弟子可执行此操作",
  disciple_not_adult: "弟子尚未成年",
  disciple_job_busy: "该弟子已有在身职务",
  elder_job_not_held: "该职暂无长老在任",
  workshop_job_full: "该车间主持已满",
  workshop_job_not_held: "该弟子未任此岗",
  workshop_staff_invalid: "投入人数不合法",
  workshop_staff_over_cap: "单房投入人数已达上限",
  workshop_outer_insufficient: "人手不足：各岗投入合计不能超过人手总数",
  outer_jobs_invalid: "分工人数不合法",
  outer_jobs_over_capacity: "人手不足：各岗投入合计不能超过人手总数",
  workshop_task_mismatch: "任务与车间不匹配",
  gear_invalid: "法宝不存在",
  gear_not_in_warehouse: "仓库中没有此法宝",
  pill_not_found: "丹药不存在",
  pill_not_in_warehouse: "仓库中没有此丹药",
  art_not_found: "不存在此功法或法术",
  art_not_in_library: "藏经阁尚无此书，历练奇遇可得",
  technique_limit_reached: "每弟子限修一门功法",
  spell_limit_reached: "每弟子限修两门法术",
  spell_already_learned: "该法术已在修",
  war_already_declared: "已处于宣战状态",
  war_cooldown_active: "会战冷却中，暂不可宣战",
  rival_missing: "对手宗门不存在",
};

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ERROR_MESSAGES[message] ?? `操作失败：${message}`;
}

export type GameStore = {
  getState(): GameSnapshot;
  subscribe(listener: () => void): () => void;
  /** 开新局；失败返回 false 并置 errorMessage。 */
  newGame(input: NewGameInput): boolean;
  /** 读档续玩：以存档状态与难度替换当前会话（首页"继续修仙"）。 */
  loadGame(state: GameState, difficulty: Difficulty): void;
  /** 推进一月。 */
  settleMonth(): void;
  /** 自动推进定时器回调：终局后自动停摆。 */
  autoTick(): void;
  recruit(candidateId: string): void;
  upgrade(): void;
  /** 丹房/器坊主持任命（无职成年内门，每房至多 1 名；不历练，修炼照常）。 */
  assignJob(kind: CraftJobKind, discipleId: string): void;
  removeJob(kind: CraftJobKind, discipleId: string): void;
  /** 丹房/器坊投入外门弟子（滑杆人数；两房合计 ≤ 外门总数）。 */
  setStaff(kind: CraftJobKind, amount: number): void;
  /** 外门分工（挖矿/练气在编人数；与车间投入合计 ≤ 外门总数）。 */
  assignOuterJobs(jobs: OuterJobsInput): void;
  /** 丹房挂炼制任务（不选丹方：统一 300 点，出炉随机两种丹各半；投入外门弟子亦会自动开炉）。 */
  setPillTask(): void;
  /** 研读功法/法术（藏经阁拥有即可）。 */
  study(discipleId: string, artId: string): void;
  /** 任命长老（资源/战备/灵矿各至多 1 名；旧长老自动卸任）。 */
  appointElder(discipleId: string, kind: ElderKind): void;
  /** 长老卸任。 */
  removeElder(kind: ElderKind): void;
  /** 穿戴法宝：仓库取同槽同件，原槽法宝卸下回仓。 */
  wear(discipleId: string, slot: GearSlot, treasureId: string): void;
  /** 服用丹药：延寿丹 +30 寿命；聚灵丹 12 月真元 ×1.5（时长累加、倍率不叠加）。 */
  takePill(discipleId: string, pillId: string): void;
  /** 玩家宣战：来月月结第 ⑦ 步触发会战。 */
  wageWar(): void;
  clearError(): void;
  /** 关闭月结结果弹层。 */
  clearResult(): void;
};

export function createGameStore(): GameStore {
  let snapshot: GameSnapshot = {
    state: null,
    difficulty: "normal",
    lastResult: null,
    errorMessage: null,
  };
  const listeners = new Set<() => void>();

  function commit(patch: Partial<GameSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function runEngineCommand(action: () => void): void {
    try {
      action();
    } catch (error) {
      commit({ errorMessage: describeError(error) });
    }
  }

  const store: GameStore = {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    newGame(input) {
      try {
        const state = createGame({
          seed: input.seed,
          sectName: input.sectName,
          rivalDifficulty: RIVAL_DIFFICULTY_BY_TIER[input.difficulty],
        });
        commit({
          state,
          difficulty: input.difficulty,
          lastResult: null,
          errorMessage: null,
        });
        return true;
      } catch (error) {
        commit({ errorMessage: describeError(error) });
        return false;
      }
    },
    loadGame(state, difficulty) {
      // 旧档先过引擎迁移（装备法宝化等），再入会话。
      commit({ state: migrateGameState(state), difficulty, lastResult: null, errorMessage: null });
    },
    settleMonth() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = settleMonthly(snapshot.state);
        commit({ state: outcome.state, lastResult: outcome.result });
      });
    },
    autoTick() {
      if (!snapshot.state || snapshot.state.ending) return;
      store.settleMonth();
    },
    recruit(candidateId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = recruitDisciple(snapshot.state, candidateId);
        commit({ state: outcome.state });
      });
    },
    upgrade() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = upgradeSect(snapshot.state);
        commit({ state: outcome.state });
      });
    },
    assignJob(kind, discipleId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = assignWorkshopJob(snapshot.state, kind, discipleId);
        commit({ state: outcome.state });
      });
    },
    removeJob(kind, discipleId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = removeWorkshopJob(snapshot.state, kind, discipleId);
        commit({ state: outcome.state });
      });
    },
    setStaff(kind, amount) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = setWorkshopStaff(snapshot.state, kind, amount);
        commit({ state: outcome.state });
      });
    },
    assignOuterJobs(jobs) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = assignOuterJobs(snapshot.state, jobs);
        commit({ state: outcome.state });
      });
    },
    setPillTask() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = startWorkshopTask(snapshot.state, "pill", { kind: "pill" });
        commit({ state: outcome.state });
      });
    },
    study(discipleId, artId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = learnArt(snapshot.state, discipleId, artId);
        commit({ state: outcome.state });
      });
    },
    appointElder(discipleId, kind) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = appointElder(snapshot.state, discipleId, kind);
        commit({ state: outcome.state });
      });
    },
    removeElder(kind) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = removeElder(snapshot.state, kind);
        commit({ state: outcome.state });
      });
    },
    wear(discipleId, slot, treasureId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = wearGear(snapshot.state, discipleId, slot, treasureId);
        commit({ state: outcome.state });
      });
    },
    takePill(discipleId, pillId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = usePill(snapshot.state, discipleId, pillId);
        commit({ state: outcome.state });
      });
    },
    wageWar() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        if (!canPlayerDeclareWar(snapshot.state)) throw new Error("war_cooldown_active");
        commit({ state: declareWar(snapshot.state) });
      });
    },
    clearError() {
      commit({ errorMessage: null });
    },
    clearResult() {
      commit({ lastResult: null });
    },
  };
  return store;
}
