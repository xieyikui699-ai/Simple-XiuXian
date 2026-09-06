// 存档适配层：GameState JSON round-trip。wx.setStorage 通过 SaveBackend 注入，
// 本层保持纯净（不 import Taro），可在 node --test 下单测。
import type { GameState } from "@simple-xiuxian/engine";

export type SaveSlot = 1 | 2 | 3 | 4;

/** 手动存档 3 格 + 自动存档 1 格（设计 D-022：key simple-xiuxian-save-1..4）。 */
export const MANUAL_SLOTS: readonly SaveSlot[] = [1, 2, 3];
export const AUTO_SLOT: SaveSlot = 4;
export const ALL_SLOTS: readonly SaveSlot[] = [1, 2, 3, 4];
export const SAVE_KEY_PREFIX = "simple-xiuxian-save-";
/** 当前局指针：指向自动存档格；null 表示无进行中会话。 */
export const CURRENT_SLOT_KEY = "simple-xiuxian-current-slot";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY_DISPLAY_NAMES: Record<Difficulty, string> = {
  easy: "简单",
  normal: "标准",
  hard: "困难",
};

export type SaveBackend = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SaveSlotData = {
  version: 1;
  slot: SaveSlot;
  /** 保存时刻（UI 时钟毫秒，仅展示用，不参与引擎确定性）。 */
  savedAt: number;
  difficulty: Difficulty;
  state: GameState;
};

export type SaveMeta = {
  slot: SaveSlot;
  sectName: string;
  turn: number;
  ended: boolean;
  savedAt: number;
  difficulty: Difficulty;
};

export function saveKey(slot: SaveSlot): string {
  return `${SAVE_KEY_PREFIX}${slot}`;
}

export function createMemoryBackend(): SaveBackend {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function isSaveSlot(value: unknown): value is SaveSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

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

export function writeSave(
  backend: SaveBackend,
  slot: SaveSlot,
  state: GameState,
  difficulty: Difficulty,
  savedAt: number = Date.now(),
): void {
  const data: SaveSlotData = { version: 1, slot, savedAt, difficulty, state };
  backend.setItem(saveKey(slot), JSON.stringify(data));
}

export function readSave(backend: SaveBackend, slot: SaveSlot): SaveSlotData | null {
  const raw = backend.getItem(saveKey(slot));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1 || !isSaveSlot(candidate.slot)) return null;
  if (typeof candidate.savedAt !== "number" || !isDifficulty(candidate.difficulty)) return null;
  if (!isGameStateLike(candidate.state)) return null;
  return parsed as SaveSlotData;
}

export function readSaveMeta(backend: SaveBackend, slot: SaveSlot): SaveMeta | null {
  const data = readSave(backend, slot);
  if (!data) return null;
  const { state } = data;
  return {
    slot,
    sectName: state.sectName,
    turn: state.currentTurn,
    ended: Boolean(state.ending),
    savedAt: data.savedAt,
    difficulty: data.difficulty,
  };
}

export function listSaves(backend: SaveBackend): SaveMeta[] {
  const metas: SaveMeta[] = [];
  for (const slot of ALL_SLOTS) {
    const meta = readSaveMeta(backend, slot);
    if (meta) metas.push(meta);
  }
  return metas;
}

export function deleteSave(backend: SaveBackend, slot: SaveSlot): void {
  backend.removeItem(saveKey(slot));
}

export function writeCurrentSlot(backend: SaveBackend, slot: SaveSlot): void {
  backend.setItem(CURRENT_SLOT_KEY, String(slot));
}

export function readCurrentSlot(backend: SaveBackend): SaveSlot | null {
  const raw = backend.getItem(CURRENT_SLOT_KEY);
  if (raw === null) return null;
  const slot = Number(raw);
  return isSaveSlot(slot) ? slot : null;
}

export function clearCurrentSlot(backend: SaveBackend): void {
  backend.removeItem(CURRENT_SLOT_KEY);
}
