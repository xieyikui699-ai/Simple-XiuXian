// 自动存档适配层：GameState JSON round-trip（单格自动档）。
// 存储后端（Taro 的 setStorageSync / getStorageSync）由 UI 层接线，本层保持纯净，可在 node --test 下单测。
// 约定：存档只保留"可续的局"——终局（state.ending）由写入方删档，本层不做终局判断。
import type { GameState } from "@simple-xiuxian/engine";
import type { Difficulty } from "./game-store.js";

/** 单格自动存档 key。 */
export const SAVE_KEY = "simple-xiuxian-autosave";

export type AutoSaveData = {
  version: 1;
  /** 保存时刻（UI 时钟毫秒，仅展示用，不参与引擎确定性）。 */
  savedAt: number;
  difficulty: Difficulty;
  state: GameState;
};

export type AutoSaveMeta = {
  sectName: string;
  turn: number;
  savedAt: number;
  difficulty: Difficulty;
};

function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

function isGameStateLike(value: unknown): value is GameState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.seed === "string" &&
    typeof candidate.sectName === "string" &&
    typeof candidate.currentTurn === "number" &&
    Array.isArray(candidate.disciples)
  );
}

export function serializeAutoSave(data: AutoSaveData): string {
  return JSON.stringify(data);
}

/** 解析存档；格式不符或损坏一律返回 null（按无档处理）。 */
export function parseAutoSave(raw: string | null): AutoSaveData | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.savedAt !== "number") return null;
  if (!isDifficulty(candidate.difficulty)) return null;
  if (!isGameStateLike(candidate.state)) return null;
  return parsed as AutoSaveData;
}

export function autoSaveMeta(data: AutoSaveData): AutoSaveMeta {
  return {
    sectName: data.state.sectName,
    turn: data.state.currentTurn,
    savedAt: data.savedAt,
    difficulty: data.difficulty,
  };
}
