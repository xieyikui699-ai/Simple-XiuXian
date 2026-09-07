// 会话仓库：包装引擎命令与存档适配层，向 UI 暴露单一可订阅快照。
// 引擎命令全部走 @simple-xiuxian/engine 导出（UI 不复制公式）；每次变更自动写自动格。
import {
  type CraftJobKind,
  type ElderKind,
  type GameState,
  type GearSlot,
  type GearTier,
  type MonthlyPolicy,
  type SettlementResult,
  appointElder,
  assignWorkshopJob,
  canPlayerDeclareWar,
  createGame,
  declareWar,
  learnArt,
  promoteToInner,
  recruitDisciple,
  removeWorkshopJob,
  settleMonthly,
  startGearCraft,
  startPillCraft,
  upgradeSect,
  usePill,
  wearGear,
} from "@simple-xiuxian/engine";
import {
  AUTO_SLOT,
  type Difficulty,
  type SaveBackend,
  type SaveMeta,
  type SaveSlot,
  deleteSave,
  listSaves,
  readSave,
  writeCurrentSlot,
  writeSave,
} from "./save-adapter";

export type NewGameInput = {
  sectName: string;
  seed: string;
  difficulty: Difficulty;
};

export type GameSnapshot = {
  /** 当前局状态；null 表示未开局。 */
  state: GameState | null;
  /** 当前局指针（进行中会话固定写自动格）。 */
  slot: SaveSlot | null;
  /** 当前局难度（首页新局三选；NPC 难度波次接入前随存档记录）。 */
  difficulty: Difficulty;
  /** 最近一次月结结果（主界面弹层）。 */
  lastResult: SettlementResult | null;
  /** 引擎命令抛错后的用户可读提示。 */
  errorMessage: string | null;
  /** 全部存档格元信息（首页列表）。 */
  saves: SaveMeta[];
};

const ERROR_MESSAGES: Record<string, string> = {
  game_seed_invalid: "种子长度需在 1–128 个字符之间",
  game_sect_name_invalid: "宗门名需为 2–24 个字符",
  game_already_ended: "本局已终局，请开新局",
  insufficient_resource: "灵石不足",
  candidate_not_found: "招募候选已过期，请重新打开",
  disciple_not_found: "弟子不存在",
  disciple_already_inner: "该弟子已是内门弟子",
  inner_limit_reached: "内门席位已满",
  sect_rank_maxed: "宗门已是最高等级",
  disciple_not_inner: "仅内门弟子可执行此操作",
  disciple_not_adult: "弟子尚未成年",
  disciple_job_busy: "该弟子已有在身职务",
  workshop_job_full: "该车间岗位已满",
  workshop_job_not_held: "该弟子未任此岗",
  craft_points_insufficient: "车间点数不足",
  gear_invalid: "装备档位不存在",
  gear_tier_locked: "宗门等级限制可炼档位",
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
  /** 重新读取全部存档格元信息（首页挂载时调用）。 */
  refreshSaves(): void;
  /** 开新局：写入自动格并置当前局指针；失败返回 false 并置 errorMessage。 */
  newGame(input: NewGameInput): boolean;
  /** 读档进入会话（自动格继续，或手动格复制开局）。 */
  loadSlot(slot: SaveSlot): boolean;
  /** 手动保存当前局到 1–3 格。 */
  saveToSlot(slot: SaveSlot): void;
  deleteSlot(slot: SaveSlot): void;
  /** 推进一月（任何推进都会持久化到自动格）。 */
  settleMonth(policy: MonthlyPolicy): void;
  /** 自动推进定时器回调：终局后自动停摆。 */
  autoTick(policy: MonthlyPolicy): void;
  promote(discipleId: string): void;
  recruit(candidateId: string): void;
  upgrade(): void;
  /** 丹房/器坊岗位任命（E02-F03 管理命令）。 */
  assignJob(kind: CraftJobKind, discipleId: string): void;
  removeJob(kind: CraftJobKind, discipleId: string): void;
  /** 丹房开炉（灵石即扣、点数池即扣，到期自动出炉入仓库）。 */
  craftPill(pillId: string): void;
  /** 器坊开炉（点数/灵石校验通过即出炉入仓库）。 */
  craftGear(slot: GearSlot, tier: GearTier): void;
  /** 研读功法/法术（藏经阁拥有即可）。 */
  study(discipleId: string, artId: string): void;
  /** 任命长老（资源/战备各至多 1 名；旧长老自动卸任）。 */
  appointElder(discipleId: string, kind: ElderKind): void;
  /** 穿戴装备：仓库取同槽同档，原槽装备卸下回仓。 */
  wear(discipleId: string, slot: GearSlot, tier: GearTier): void;
  /** 服用丹药：延寿丹 +10 寿命；聚灵丹 12 月真元 ×1.5（刷新不叠加）。 */
  takePill(discipleId: string, pillId: string): void;
  /** 玩家宣战：来月月结第 ⑦ 步触发会战。 */
  wageWar(): void;
  clearError(): void;
  /** 关闭月结结果弹层。 */
  clearResult(): void;
};

export function createGameStore(backend: SaveBackend, now: () => number = Date.now): GameStore {
  let snapshot: GameSnapshot = {
    state: null,
    slot: null,
    difficulty: "normal",
    lastResult: null,
    errorMessage: null,
    saves: listSaves(backend),
  };
  const listeners = new Set<() => void>();

  function commit(patch: Partial<GameSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  /** 会话内任何状态变更后同步写自动格（自动存档 1 格语义）。 */
  function persistAuto(): void {
    if (!snapshot.state) return;
    writeSave(backend, AUTO_SLOT, snapshot.state, snapshot.difficulty, now());
    writeCurrentSlot(backend, AUTO_SLOT);
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
    refreshSaves() {
      commit({ saves: listSaves(backend) });
    },
    newGame(input) {
      try {
        const state = createGame({ seed: input.seed, sectName: input.sectName });
        commit({
          state,
          slot: AUTO_SLOT,
          difficulty: input.difficulty,
          lastResult: null,
          errorMessage: null,
        });
        persistAuto();
        commit({ saves: listSaves(backend) });
        return true;
      } catch (error) {
        commit({ errorMessage: describeError(error) });
        return false;
      }
    },
    loadSlot(slot) {
      const data = readSave(backend, slot);
      if (!data) {
        commit({ errorMessage: "存档为空或已损坏" });
        return false;
      }
      commit({
        state: data.state,
        slot: AUTO_SLOT,
        difficulty: data.difficulty,
        lastResult: null,
        errorMessage: null,
      });
      persistAuto();
      return true;
    },
    saveToSlot(slot) {
      runEngineCommand(() => {
        if (slot === AUTO_SLOT) throw new Error("candidate_not_found");
        if (!snapshot.state) throw new Error("disciple_not_found");
        writeSave(backend, slot, snapshot.state, snapshot.difficulty, now());
        commit({ saves: listSaves(backend) });
      });
    },
    deleteSlot(slot) {
      deleteSave(backend, slot);
      commit({ saves: listSaves(backend) });
    },
    settleMonth(policy) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = settleMonthly(snapshot.state, policy);
        commit({ state: outcome.state, lastResult: outcome.result });
        persistAuto();
      });
    },
    autoTick(policy) {
      if (!snapshot.state || snapshot.state.ending) return;
      store.settleMonth(policy);
    },
    promote(discipleId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = promoteToInner(snapshot.state, discipleId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    recruit(candidateId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = recruitDisciple(snapshot.state, candidateId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    upgrade() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = upgradeSect(snapshot.state);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    assignJob(kind, discipleId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = assignWorkshopJob(snapshot.state, kind, discipleId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    removeJob(kind, discipleId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = removeWorkshopJob(snapshot.state, kind, discipleId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    craftPill(pillId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = startPillCraft(snapshot.state, pillId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    craftGear(slot, tier) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = startGearCraft(snapshot.state, slot, tier);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    study(discipleId, artId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = learnArt(snapshot.state, discipleId, artId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    appointElder(discipleId, kind) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = appointElder(snapshot.state, discipleId, kind);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    wear(discipleId, slot, tier) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = wearGear(snapshot.state, discipleId, slot, tier);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    takePill(discipleId, pillId) {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        const outcome = usePill(snapshot.state, discipleId, pillId);
        commit({ state: outcome.state });
        persistAuto();
      });
    },
    wageWar() {
      runEngineCommand(() => {
        if (!snapshot.state) throw new Error("disciple_not_found");
        if (!canPlayerDeclareWar(snapshot.state)) throw new Error("war_cooldown_active");
        commit({ state: declareWar(snapshot.state) });
        persistAuto();
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
