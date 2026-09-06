// 会话仓库：包装引擎命令与存档适配层，向 UI 暴露单一可订阅快照。
// 引擎命令全部走 @simple-xiuxian/engine 导出（UI 不复制公式）；每次变更自动写自动格。
import {
  type GameState,
  type MonthlyPolicy,
  type SettlementResult,
  createGame,
  promoteToInner,
  recruitDisciple,
  settleMonthly,
  upgradeSect,
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
    clearError() {
      commit({ errorMessage: null });
    },
    clearResult() {
      commit({ lastResult: null });
    },
  };
  return store;
}
